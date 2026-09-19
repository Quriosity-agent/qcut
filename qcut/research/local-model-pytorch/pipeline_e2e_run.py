#!/usr/bin/env python3
"""Private video -> verified tensor model -> visualization -> encoded video E2E."""
import argparse
import hashlib
import json
import math
import pathlib
import platform
import resource
import signal
import statistics
import time

import numpy as np
import torch

from espresso_archive import sha256
from infer import load_predictor
from pipeline_e2e_media import decode, encode_and_verify, probe
from pipeline_e2e_profiles import (PROFILES, compare_outputs, initial_state, next_state,
                                   prepare_inputs, preprocessing_description,
                                   validate_outputs, visualization)

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
FORMATS = {
    "skin": "qcut-private-espresso-pytorch", "video-object": "qcut-private-espresso-pytorch",
    "skeleton": "qcut-private-espresso-pytorch", "shot": "qcut-private-shot-pytorch",
    "legacy-shot": "qcut-private-legacy-shot-pytorch", "tflite": "qcut-bounded-tflite-pytorch",
    "denoise": "qcut-private-denoise-pytorch-v1", "c73": "qcut-private-classifier-pytorch-v1",
    "dance": "qcut-private-classifier-pytorch-v1", "ocr-det": "qcut-private-ocr-detector-pytorch-v1",
    "tracking-backbone": "qcut-private-tracking-pytorch-v1",
    "clip2m": "qcut-private-vision-batch-pytorch-v1", "clip30m": "qcut-private-vision-batch-pytorch-v1",
    "normal": "qcut-private-vision-batch-pytorch-v1",
}


class Cancelled(Exception):
    pass


def cancelled(signum, frame):
    raise Cancelled(f"received signal {signum}")


def write_report(*, output, report):
    temporary = output / "report.pending.json"
    temporary.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    temporary.replace(output / "report.json")


def private_output(*, path):
    output = path.resolve()
    if output == PRIVATE.resolve() or not output.is_relative_to(PRIVATE.resolve()):
        raise ValueError("outputs must remain beneath the private ignored model directory")
    output.mkdir(parents=True, exist_ok=False)
    return output


def verified_artifact(*, model, ledger):
    if not model.resolve().is_relative_to(PRIVATE.resolve()) or not model.is_file():
        raise ValueError("model must be an existing private artifact")
    digest = sha256(path=model)
    data = json.loads(ledger.read_text())
    evidence = []
    for network in data.get("networks", []):
        for item in network.get("history", []):
            artifact = item.get("artifact") or {}
            if (item.get("verified") is True and item.get("status") in
                    {"native-parity-passed", "recorded-native-parity-passed"}
                    and artifact.get("artifact_sha256") == digest and item.get("native_checks", 0) > 0
                    and item.get("failed_native_checks") == 0):
                source_report = pathlib.Path(item["report"])
                if sha256(path=source_report) != item["report_sha256"]:
                    raise ValueError("native validation report changed since ledger creation")
                evidence.append({"source_sha256": network["source_sha256"],
                                 "network_id": network["network_id"], "native_report": str(source_report),
                                 "native_report_sha256": item["report_sha256"], "status": item["status"]})
    if not evidence:
        raise ValueError("artifact has no passing native evidence in supplied ledger")
    return {"artifact_sha256": digest, "ledger_sha256": sha256(path=ledger), "evidence": evidence}


def torch_backend(*, model, profile):
    predictor, kind = load_predictor(path=model, network=profile.network)
    if kind != FORMATS[profile.name]:
        raise ValueError("model format does not match selected video profile")

    def predict(inputs):
        tensors = {name: torch.from_numpy(value.copy()) for name, value in inputs.items()}
        with torch.inference_mode():
            outputs = predictor(tensors)
        return {name: value.detach().cpu().numpy().copy() for name, value in outputs.items()}

    return predict


def verify_profile_identity(*, profile, validation):
    if profile.name not in {"clip2m", "clip30m", "normal"}:
        return
    from vision_batch_profiles import PROFILES as VISION_PROFILES
    source = VISION_PROFILES[profile.name]["source_sha256"]
    if {item["source_sha256"] for item in validation["evidence"]} != {source}:
        raise ValueError("vision profile does not match validated source identity")


def backend_predictor(*, backend, model, profile, contract, threads):
    if backend == "pytorch":
        if contract is not None:
            raise ValueError("ONNX contract cannot be silently ignored by PyTorch")
        return torch_backend(model=model, profile=profile)
    if backend != "onnx" or contract is None:
        raise ValueError("ONNX backend requires an approved contract")
    from onnx_infer import ONNXModel
    predictor = ONNXModel(contract_path=contract, threads=threads)
    if (predictor.metadata["source_bundle_sha256"] != sha256(path=model)
            or predictor.metadata.get("network") != profile.network):
        raise ValueError("ONNX contract belongs to a different bundle or subnetwork")
    return predictor


def output_summary(*, outputs):
    return {name: {"shape": list(value.shape), "dtype": str(value.dtype),
                   "min": float(value.min()), "max": float(value.max()), "mean": float(value.mean()),
                   "sha256": hashlib.sha256(value.tobytes()).hexdigest()}
            for name, value in outputs.items()}


def run_sequence(*, frames, profile, predictor, output, report, reset_policy="midpoint"):
    state = initial_state(profile=profile)
    if reset_policy not in {"midpoint", "start-only"}:
        raise ValueError("unsupported reset policy")
    reset_indices = [0] if reset_policy == "start-only" else sorted({0, len(frames) // 2})
    schema = None
    responses, timings = [], []
    report["cases"] = []
    for index in range(len(frames)):
        if index in reset_indices:
            state = initial_state(profile=profile)
        inputs = prepare_inputs(profile=profile, frames=frames, index=index, state=state)
        before = time.perf_counter()
        outputs = predictor(inputs)
        timings.append((time.perf_counter() - before) * 1000)
        schema = validate_outputs(outputs=outputs, schema=schema)
        response, projection = visualization(profile=profile, outputs=outputs)
        responses.append(response)
        state = next_state(profile=profile, inputs=inputs, outputs=outputs)
        np.savez_compressed(output / f"outputs-{index:04d}.npz", **outputs)
        if index in reset_indices:
            np.savez_compressed(output / f"inputs-{index:04d}.npz", **inputs)
        report["cases"].append({"frame": index, "reset": index in reset_indices,
                                "outputs": output_summary(outputs=outputs), "inference_ms": timings[-1]})
        report.update(stage="inference", completed_frames=index + 1)
        write_report(output=output, report=report)
    report.update(output_schema=schema, visualization=projection, reset_indices=reset_indices,
                  inference_median_ms=statistics.median(timings), inference_max_ms=max(timings))
    return np.stack(responses)


def replay(*, frames, profile, predictor, output, reset_indices):
    comparisons = []
    for start in reset_indices:
        stop = next((point for point in reset_indices if point > start), len(frames))
        state = initial_state(profile=profile)
        for index in range(start, stop):
            inputs = prepare_inputs(profile=profile, frames=frames, index=index, state=state)
            actual = predictor(inputs)
            with np.load(output / f"outputs-{index:04d}.npz", allow_pickle=False) as archive:
                expected = {name: archive[name] for name in archive.files}
            compared = compare_outputs(actual=actual, expected=expected)
            comparisons.append({"frame": index, "reset_segment_start": start, "outputs": compared})
            state = next_state(profile=profile, inputs=inputs, outputs=actual)
    return {"passed": all(item["exact"] for case in comparisons for item in case["outputs"].values()),
            "scope": "separate replay with its own zero-initialized feedback; every terminal output must be bit exact",
            "cases": comparisons}


def compare_run(*, reference, output, report):
    baseline = json.loads((reference / "report.json").read_text())
    if baseline.get("passed") is not True:
        raise ValueError("cross-backend reference did not pass its media pipeline")
    keys = ("video_sha256", "profile", "fps", "requested_frames", "start_s", "decoded_frames", "preprocessing", "reset_indices")
    if any(baseline[key] != report[key] for key in keys):
        raise ValueError("cross-backend reference media or preprocessing mismatch")
    if baseline["validation"]["artifact_sha256"] != report["validation"]["artifact_sha256"]:
        raise ValueError("cross-backend reference model mismatch")
    comparisons = []
    for index in range(report["decoded_frames"]):
        with np.load(reference / f"outputs-{index:04d}.npz", allow_pickle=False) as archive:
            expected = {name: archive[name] for name in archive.files}
        with np.load(output / f"outputs-{index:04d}.npz", allow_pickle=False) as archive:
            actual = {name: archive[name] for name in archive.files}
        comparisons.append({"frame": index, "outputs": compare_outputs(actual=actual, expected=expected)})
    return {"passed": all(item["passed"] for case in comparisons for item in case["outputs"].values()),
            "reference": str(reference.resolve()), "reference_report_sha256": sha256(path=reference / "report.json"),
            "independent_feedback": True, "cases": comparisons}


def run(*, model, ledger, video, output, profile_name, fps=4, frames=24, start=0, threads=2,
        backend="pytorch", contract=None, reference=None, reset_policy="midpoint"):
    directory = private_output(path=output)
    report = {"format": "qcut-model-video-pipeline-e2e-v1", "status": "running", "passed": False,
              "stage": "validation", "backend": backend + "-cpu", "profile": profile_name,
              "video": str(video.resolve()), "model": str(model.resolve()), "fps": fps if math.isfinite(fps) else str(fps),
              "requested_frames": frames, "start_s": start if math.isfinite(start) else str(start), "product_editor_e2e": False,
              "scope": "decoded media/model/visualization/encode chain; not semantic accuracy or product parity",
              "native_oracle_rerun": False, "tolerance": {"atol": 1e-4, "rtol": 1e-4},
              "reset_policy": reset_policy,
              "platform": platform.platform(), "python": platform.python_version(), "torch": torch.__version__,
              "script_hashes": {name: sha256(path=pathlib.Path(__file__).with_name(name)) for name in
                                ("pipeline_e2e_run.py", "pipeline_e2e_profiles.py", "pipeline_e2e_media.py")}}
    write_report(output=directory, report=report)
    try:
        if not 1 <= threads <= 32 or profile_name not in PROFILES:
            raise ValueError("invalid thread count or video profile")
        profile = PROFILES[profile_name]
        report["validation"] = verified_artifact(model=model, ledger=ledger)
        verify_profile_identity(profile=profile, validation=report["validation"])
        if contract is not None:
            report["onnx_contract_sha256"] = sha256(path=contract)
        report["video_sha256"] = sha256(path=video)
        report["source_probe"] = probe(video=video, log=directory / "source-probe-command.json")
        torch.set_num_threads(threads)
        decoded = decode(video=video, width=profile.width, height=profile.height, fps=fps, frames=frames,
                         start=start, log=directory / "source-decode.json")
        original = decode(video=video, width=320, height=180, fps=fps, frames=frames,
                          start=start, log=directory / "preview-decode.json")
        if len(decoded) != len(original) or len(decoded) != frames:
            raise ValueError(f"expected {frames} frames, decoded {len(decoded)}")
        report.update(decoded_frames=len(decoded), preprocessing=preprocessing_description(profile=profile),
                      stage="inference")
        write_report(output=directory, report=report)
        predictor = backend_predictor(backend=backend, model=model, profile=profile, contract=contract, threads=threads)
        if backend == "onnx":
            import onnxruntime
            report["onnxruntime"] = onnxruntime.__version__
            report["providers"] = predictor.session.get_providers()
        responses = run_sequence(frames=decoded, profile=profile, predictor=predictor, output=directory,
                                 report=report, reset_policy=reset_policy)
        report.update(stage="replay")
        write_report(output=directory, report=report)
        report["reset_replay"] = replay(frames=decoded, profile=profile,
                                        predictor=backend_predictor(backend=backend, model=model, profile=profile,
                                                                    contract=contract, threads=threads), output=directory,
                                        reset_indices=report["reset_indices"])
        report["seek"] = verify_seek(video=video, directory=directory, profile=profile, decoded=decoded,
                                     fps=fps, start=start)
        report.update(stage="encode")
        write_report(output=directory, report=report)
        report["media"] = encode_and_verify(original=original, response=responses, fps=fps, output=directory)
        report["passed"] = all((report["reset_replay"]["passed"], report["seek"]["passed"], report["media"]["passed"]))
        if reference is not None:
            report["cross_backend"] = compare_run(reference=reference, output=directory, report=report)
            report["passed"] = report["passed"] and report["cross_backend"]["passed"]
        report.update(status="passed" if report["passed"] else "failed", stage="complete")
    except (Cancelled, KeyboardInterrupt) as error:
        report.update(status="cancelled", error=str(error), passed=False)
    except Exception as error:
        report.update(status="failed", error=f"{type(error).__name__}: {error}", passed=False)
    raw_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report["memory"] = {"self_peak_rss_bytes": int(raw_rss if platform.system() == "Darwin" else raw_rss * 1024),
                        "source": "getrusage(RUSAGE_SELF); excludes child FFmpeg processes",
                        "decode_per_array_limit_bytes": 256 * 1024 * 1024}
    write_report(output=directory, report=report)
    return report


def verify_seek(*, video, directory, profile, decoded, fps, start):
    index = len(decoded) // 2
    count = min(3, len(decoded) - index)
    sought = decode(video=video, width=profile.width, height=profile.height, fps=fps, frames=count,
                    start=start + index / fps, log=directory / "seek-decode.json")
    exact = np.array_equal(sought, decoded[index:index + count])
    return {"passed": bool(exact), "decoded_frames_exact": bool(exact), "index": index, "frames": count,
            "scope": "output-side accurate seek at resampled frame boundary plus independently reset replay"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("model", "ledger", "video", "out"):
        parser.add_argument(f"--{name}", type=pathlib.Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--fps", type=float, default=4)
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--backend", choices=("pytorch", "onnx"), default="pytorch")
    parser.add_argument("--contract", type=pathlib.Path)
    parser.add_argument("--compare-run", type=pathlib.Path)
    parser.add_argument("--reset-policy", choices=("midpoint", "start-only"), default="midpoint")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, cancelled)
    result = run(model=args.model, ledger=args.ledger, video=args.video, output=args.out,
                 profile_name=args.profile, fps=args.fps, frames=args.frames, start=args.start, threads=args.threads,
                 backend=args.backend, contract=args.contract, reference=args.compare_run, reset_policy=args.reset_policy)
    print(json.dumps({key: result.get(key) for key in ("status", "passed", "error", "completed_frames")}), flush=True)
    return 130 if result["status"] == "cancelled" else int(not result["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
