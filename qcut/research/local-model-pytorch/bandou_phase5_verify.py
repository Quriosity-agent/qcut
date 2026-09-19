"""Fresh full-graph CPU validation; failed historical reports are never rewritten."""
import argparse
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import torch

from bandou_phase5_candidate import substitute
from bandou_phase5_probe import pinned_candidate, read_tensors
from bytenn_oracle import sha256
from vision_batch_export import fresh_directory, recover, run_case, synthetic_cases
from vision_batch_profiles import PROFILES, RUNTIME_SHA256
from vision_batch_torch import digest, state_digest

CANDIDATE_FORMAT = "qcut-private-bandou-phase5-diagnostic-v1"
FRESH_SEEDS = (104729, 130363, 155921)


def baseline_cases(*, run):
    report = json.loads((run / "report.json").read_text())
    required = set(synthetic_cases(shape=PROFILES["bandou"]["input_shape"])) | {
        f"holdout-video-{video}-frame-{frame}" for video in range(2) for frame in range(4)}
    if len(report["cases"]) != 18 or {item["case"] for item in report["cases"]} != required:
        raise ValueError("all eighteen unique baseline cases required")
    cases = {}
    for item in report["cases"]:
        tensors = read_tensors(path=run / f"case-{item['case']}" / "inputs.npz")
        if set(tensors) != {"data"} or list(tensors["data"].shape) != PROFILES["bandou"]["input_shape"]:
            raise ValueError("baseline input schema mismatch")
        value = tensors["data"].numpy()
        if digest(data=value.tobytes()) != item["input_sha256"]:
            raise ValueError("baseline input hash changed")
        cases[item["case"]] = value
    return cases


def fresh_cases(*, shape):
    cases = {}
    for seed in FRESH_SEEDS:
        cases[f"holdout-phase5-uniform-{seed}"] = np.random.default_rng(seed).uniform(-2, 2, shape).astype(np.float32)
        cases[f"holdout-phase5-normal-{seed}"] = np.random.default_rng(seed).normal(0, 0.75, shape).astype(np.float32)
    return cases


def fresh_frames(*, videos, out):
    if len(videos) != 2 or len({Path(path).resolve() for path in videos}) != 2:
        raise ValueError("two distinct real reference videos required")
    cases, records = {}, []
    _, _, height, width = PROFILES["bandou"]["input_shape"]
    for index, video in enumerate(videos):
        video = Path(video).resolve()
        video_sha = sha256(path=video)
        for ordinal, second in enumerate((2.25, 3.75, 5.25)):
            raw = out / f"fresh-video-{index}-{ordinal}.rgb24"
            command = ["/opt/homebrew/bin/ffmpeg", "-v", "error", "-ss", str(second), "-i", str(video),
                       "-vf", f"scale={width}:{height}:flags=bilinear", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", str(raw)]
            subprocess.run(command, capture_output=True, timeout=30, check=True)
            values = np.fromfile(raw, dtype=np.uint8)
            if values.size != height * width * 3 or sha256(path=video) != video_sha:
                raise ValueError("video frame unavailable or source changed")
            name = f"holdout-phase5-video-{index}-frame-{ordinal}"
            cases[name] = values.reshape(height, width, 3).transpose(2, 0, 1)[None].astype(np.float32) / 255
            records.append({"case": name, "video": str(video), "video_sha256": video_sha, "second": second,
                            "command": command, "frame_sha256": sha256(path=raw),
                            "preprocessing": "research-only RGB bilinear resize / 255; product semantics unverified"})
    return cases, records


def verify(*, run, out, videos):
    run = Path(run).resolve()
    _, provenance = pinned_candidate(run=run)
    cases = baseline_cases(run=run)
    out = fresh_directory(path=out)
    source, original, text, details, arena_sha = recover(profile="bandou", out=out)
    model = substitute(model=original, ordered_resize=True)
    spec = PROFILES["bandou"]
    if state_digest(state=model.state_dict()) != spec["state_sha256"]:
        raise ValueError("candidate substitution changed weights")
    bundle = {"format": CANDIDATE_FORMAT, "local_only": True, "verification_status": "candidate-native-unverified",
              "state_dict": model.state_dict(), "state_sha256": spec["state_sha256"], "graph_text": text}
    artifact = out / "bandou-candidate.pt"
    torch.save(bundle, artifact)
    loaded = torch.load(artifact, map_location="cpu", weights_only=True)
    if loaded["format"] != CANDIDATE_FORMAT or state_digest(state=loaded["state_dict"]) != spec["state_sha256"]:
        raise ValueError("candidate roundtrip state mismatch")
    clone = substitute(model=original, ordered_resize=True)
    clone.load_state_dict(loaded["state_dict"], strict=True)
    cases.update(fresh_cases(shape=spec["input_shape"]))
    frames, media = fresh_frames(videos=videos, out=out)
    cases.update(frames)
    if len(cases) != 30 or len({digest(data=value.tobytes()) for value in cases.values()}) != 30:
        raise ValueError("thirty distinct original-shape cases required")
    report = {"format": CANDIDATE_FORMAT, "profile": "bandou", "status": "running", "candidate_enabled": False,
              "source": str(source), **{key: spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256")},
              "runtime_sha256": RUNTIME_SHA256, "arena_sha256": arena_sha, "parameter_count": model.parameter_count,
              "scope": "original-fixed-shape-full-terminal-tensor-comparison", "original_graph_unchanged": True,
              "original_arena_unchanged": True, "backend": "ByteNN forced CPU / PyTorch CPU FP32 ordered arithmetic",
              "schema": {"inputs": model.input_shapes, "outputs": model.output_shapes, "dtype": "float32", "layout": "NCHW"},
              "artifact": str(artifact), "artifact_sha256": sha256(path=artifact), "baseline_provenance": provenance,
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "required_cases": list(cases), "baseline_cases": 18,
              "fresh_random_cases": 6, "fresh_video_frames": 6, "media": media, "graph_recovery": details,
              "product_preprocessing_verified": False, "product_semantics_verified": False,
              "authored_code_sha256": {name: sha256(path=Path(__file__).with_name(name)) for name in (
                  "bandou_phase5_candidate.py", "bandou_phase5_numeric.py", "bandou_phase5_verify.py", "ocr_rec_numeric.py",
                  "vision_batch_torch.py", "vision_batch_export.py", "bytenn_oracle.py", "bytenn_oracle.mm")},
              "cases": []}
    try:
        for name, values in cases.items():
            started = time.monotonic()
            record = run_case(name=name, values=values, model=model, clone=clone, out=out, oracle=True)
            record["seconds_including_roundtrip_and_native"] = time.monotonic() - started
            directory = out / f"case-{name}"
            record["files_sha256"] = {file.name: sha256(path=file) for file in directory.glob("*.npz")}
            report["cases"].append(record)
            print(json.dumps({"case": name, "passed": record["passed"], "outputs": record.get("outputs")}), flush=True)
            (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        if any(sha256(path=path) != expected for path, expected in provenance["files_sha256"].items()):
            raise ValueError("source evidence changed during full validation")
        passed = len(report["cases"]) == 30 and all(item["passed"] for item in report["cases"])
        report.update(status="native-parity-passed" if passed else "verification-failed", all_declared_outputs_verified=passed)
    except Exception as error:
        report.update(status="verification-failed", error=f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--video", type=Path, action="append", required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = verify(run=args.run, out=args.out, videos=args.video)
    return 0 if result["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
