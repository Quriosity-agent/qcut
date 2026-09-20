"""Recover hash-pinned FP32 vision networks and record full-output native evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from bytenn_oracle import LIBRARY, PRIVATE, predict
from classifier_export import compare_outputs
from container_scan import decode_graph, runtime_graph_table
from model_containers import bytenn_sections, inspect_container
from ocr_torch import widen_fp16
from vision_batch_profiles import execution_profile, input_shapes as profile_input_shapes, ordered_execution
from vision_batch_torch import (EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256,
                                VisionGraph, digest, load_model, parse_graph, state_digest)

RUNTIMES = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"


def fresh_directory(*, path):
    path = Path(path).resolve()
    if path == PRIVATE.resolve() or not path.is_relative_to(PRIVATE.resolve()):
        raise ValueError("vision artifacts must remain beneath private ignored directory")
    if path.exists() and any(path.iterdir()):
        raise ValueError("fresh empty vision directory required")
    path.mkdir(parents=True, exist_ok=True)
    return path


def recover(*, profile, out):
    spec = PROFILES[profile]
    source = RUNTIMES / "JianyingFilter/current/Models" / spec["source_filename"]
    data = source.read_bytes()
    if digest(data=data) != spec["source_sha256"]:
        raise ValueError("source hash mismatch")
    candidates = [f for f in inspect_container(data=data)["findings"] if f["kind"] == "bytenn-bm"]
    if len(candidates) != 1:
        raise ValueError("expected exactly one bounded network")
    part = candidates[0]
    bm = data[part["offset"]:part["offset"] + part["bytes"]]
    if digest(data=bm) != spec["bm_sha256"]:
        raise ValueError("embedded network hash mismatch")
    text, details = decode_graph(data=bm, offset=0, table=runtime_graph_table(path=LIBRARY))
    if digest(data=text.encode()) != spec["graph_sha256"] or details["layer_count"] != spec["layer_count"]:
        raise ValueError("decoded graph identity mismatch")
    section = bytenn_sections(data=bm, offset=0)["sections"][1]
    arena = bm[section["offset"]:section["offset"] + section["bytes"]]
    nodes = parse_graph(text=text)
    oracle_text, oracle_arena = text, arena
    if spec.get("arena") == "fp16":
        # Header-E arena: half-precision weights plus the uint32 graph stamp. CreateNet does
        # not take an E graph directly; the runtime's CheckFp16AndConvertModel removes the E
        # prefix and widens only the payload, keeping the stamp. widen_fp16 replicates that
        # converter bit for bit (OCR fp16_decoder_proof), so the oracle runs the same D graph
        # the runtime would, and the PyTorch copy shares the widened weights.
        if not text.startswith("E\\n\n") or len(arena) != VisionGraph(nodes=nodes).parameter_count * 2 + 4:
            raise ValueError("unsupported FP16 arena byte count")
        weights = widen_fp16(bits=np.frombuffer(arena[:-4], dtype="<u2"))
        oracle_text, oracle_arena = text[4:], weights.astype("<f4").tobytes() + arena[-4:]
    else:
        if len(arena) < 8 or len(arena) % 4:
            raise ValueError("unsupported FP32 arena byte count")
        weights = np.frombuffer(arena[:-4], dtype="<f4").copy()
    model = VisionGraph(nodes=nodes, weights=weights, ordered=ordered_execution(profile=spec)).eval()
    if model.input_shapes != profile_input_shapes(profile=spec) or model.output_shapes != {k: tuple(v) for k, v in spec["outputs"].items()}:
        raise ValueError("recovered schema differs from audited dimensions")
    (out / "network.private.bm").write_bytes(bm)
    (out / "graph.private.txt").write_text(oracle_text)
    (out / "arena.private.bin").write_bytes(oracle_arena)
    if oracle_text is not text:
        (out / "graph.original.private.txt").write_text(text)
        (out / "arena.original.private.bin").write_bytes(arena)
    return source, model, text, details, digest(data=arena)


def synthetic_cases(*, shape, seed_offset=0):
    """One recipe per input; `seed_offset` keeps a second input's random tensors distinct."""
    cases = {"zeros": np.zeros(shape, np.float32), "ones": np.ones(shape, np.float32),
             "negative-ones": -np.ones(shape, np.float32),
             "ramp": np.linspace(-1, 1, np.prod(shape), dtype=np.float32).reshape(shape)}
    for seed in (17, 41):
        cases[f"random-{seed}"] = np.random.default_rng(seed + seed_offset).uniform(-1, 1, shape).astype(np.float32)
    for seed in (509, 1709, 20260919):
        cases[f"holdout-normal-{seed}"] = np.random.default_rng(seed + seed_offset).normal(0, 0.5, shape).astype(np.float32)
    edge = np.zeros(shape, np.float32)
    edge[0, 0, 0, -1], edge[0, 1, -1, 0], edge[0, 2, shape[2] // 2, shape[3] // 3] = 1, -1, 0.5
    cases["holdout-asymmetric-impulse"] = edge
    return cases


def synthetic_input_cases(*, shapes):
    """Per-case input dicts covering every declared input of the network."""
    per_input = {name: synthetic_cases(shape=shape, seed_offset=1000 * index)
                 for index, (name, shape) in enumerate(shapes.items())}
    names = next(iter(per_input.values()))
    return {case: {name: per_input[name][case] for name in shapes} for case in names}


def image_input(*, shapes):
    """The spatial input real frames feed; other inputs are condition vectors."""
    name = max(shapes, key=lambda key: shapes[key][2] * shapes[key][3])
    if shapes[name][2] * shapes[name][3] < 2:
        raise ValueError("network has no spatial image input for media cases")
    return name


def media_cases(*, videos, shapes, out):
    cases, records = {}, []
    image = image_input(shapes=shapes)
    _, _, h, w = shapes[image]
    # Research-only: condition inputs get a fixed mid-range value; product semantics are unverified.
    conditions = {name: np.full(shape, 0.5, np.float32) for name, shape in shapes.items() if name != image}
    for index, video in enumerate(videos):
        video = Path(video).resolve()
        if not video.is_file():
            raise ValueError("missing real reference video")
        raw = out / f"video-{index}.rgb24"
        command = ["/opt/homebrew/bin/ffmpeg", "-v", "error", "-i", str(video), "-vf",
                   f"fps=2,scale={w}:{h}:flags=bilinear", "-frames:v", "4", "-pix_fmt", "rgb24", "-f", "rawvideo", str(raw)]
        subprocess.run(command, check=True, capture_output=True, timeout=120)
        values = np.fromfile(raw, np.uint8)
        if values.size != 4 * h * w * 3:
            raise ValueError("reference video has fewer than four requested frames")
        values = values.reshape(4, h, w, 3)
        hashes = [digest(data=frame.tobytes()) for frame in values]
        if len(set(hashes)) < 2:
            raise ValueError("reference frames are identical")
        with video.open("rb") as stream:
            source_sha = hashlib.file_digest(stream, "sha256").hexdigest()
        records.append({"path": str(video), "sha256": source_sha, "command": command,
                        "raw_sha256": digest(data=raw.read_bytes()), "frame_hashes": hashes,
                        "preprocessing": "research-only RGB bilinear resize / 255; product preprocessing unverified",
                        "condition_inputs": {name: 0.5 for name in conditions}})
        for frame, value in enumerate(values):
            cases[f"holdout-video-{index}-frame-{frame}"] = {
                image: value.transpose(2, 0, 1)[None].astype(np.float32) / 255, **conditions}
    return cases, records


def run_case(*, name, values, model, clone, out, oracle):
    directory = out / f"case-{name}"
    directory.mkdir()
    inputs = {name: torch.from_numpy(value) for name, value in values.items()}
    np.savez(directory / "inputs.npz", **values)
    with torch.inference_mode():
        actual = model(inputs)
        replay = clone(inputs)
    np.savez(directory / "pytorch.npz", **{k: v.numpy() for k, v in actual.items()})
    record = {"case": name, "holdout": name.startswith("holdout-"), "passed": False,
              "input_npz": str(directory / "inputs.npz"),
              "input_sha256": digest(data=b"".join(values[name].tobytes() for name in sorted(values))),
              "roundtrip_exact": all(torch.equal(actual[k], replay[k]) for k in actual),
              "native": {"status": "not-run"}}
    if oracle:
        try:
            native = predict(graph=out / "graph.private.txt", arena=out / "arena.private.bin",
                             inputs=inputs, output_shapes=model.output_shapes, out=directory / "native", timeout=180)
            np.savez(directory / "native.npz", **{k: v.numpy() for k, v in native.items()})
            record.update(compare_outputs(expected=native, actual=actual))
            record["native"] = {"status": "native-executed", "forced_cpu": True, "forward_type": 0,
                                "input_echo_exact": True, "all_declared_outputs_compared": True}
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            record["native"] = {"status": "native-failed", "reason": str(error)}
    record["passed"] = record["passed"] and record["roundtrip_exact"]
    return record


def export(*, profile, out, oracle, videos=()):
    out = fresh_directory(path=out)
    source, model, text, details, arena_sha = recover(profile=profile, out=out)
    spec = PROFILES[profile]
    bundle = {"format": FORMAT, "local_only": True, "profile": profile, "graph_text": text,
              "execution_profile": execution_profile(profile=spec), "runtime_sha256": RUNTIME_SHA256,
              "state_dict": model.state_dict(), "state_sha256": state_digest(state=model.state_dict()),
              "verification_status": "candidate-native-unverified",
              **{key: spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")}}
    artifact = out / f"{profile}.pt"
    torch.save(bundle, artifact)
    clone = load_model(path=artifact, allow_unverified=True)
    exact = all(torch.equal(value, clone.state_dict()[k]) for k, value in model.state_dict().items())
    shapes = profile_input_shapes(profile=spec)
    cases = synthetic_input_cases(shapes=shapes)
    media, media_evidence = media_cases(videos=videos, shapes=shapes, out=out)
    cases.update(media)
    records = []
    report = {"format": FORMAT, "profile": profile, "status": "running", "source": str(source),
              **{key: spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")},
              "runtime_sha256": RUNTIME_SHA256, "arena_sha256": arena_sha,
              "state_sha256": bundle["state_sha256"], "state_roundtrip_exact": exact,
              "parameter_count": model.parameter_count, "graph_recovery": details,
              "scope": "original-fixed-shape-full-terminal-tensor-comparison",
              "execution_profile": execution_profile(profile=spec),
              "backend": "ByteNN enforced CPU / PyTorch CPU float32",
              "original_graph_unchanged": spec.get("arena") != "fp16", "original_arena_unchanged": spec.get("arena") != "fp16",
              "graph_transform": ("native CheckFp16AndConvertModel recipe: remove E-prefix, widen payload, retain stamp"
                                  if spec.get("arena") == "fp16" else None),
              "weight_decoding": "fp16 widened with the pinned ARM64 four-lane rule" if spec.get("arena") == "fp16" else "fp32 as stored",
              "schema": {"inputs": model.input_shapes, "outputs": model.output_shapes,
                         "layout": "NCHW", "dtype": "float32", "execution_memory": "contiguous NCHW"},
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "media": media_evidence,
              "product_preprocessing_verified": False, "product_semantics_verified": False,
              "authored_code_sha256": {name: digest(data=Path(__file__).with_name(name).read_bytes())
                                       for name in ("vision_batch_torch.py", "vision_batch_profiles.py", "vision_batch_export.py", "bytenn_oracle.py", "bytenn_oracle.mm")},
              "cases": records}
    for name, values in cases.items():
        record = run_case(name=name, values=values, model=model, clone=clone, out=out, oracle=oracle)
        records.append(record)
        print(json.dumps({"profile": profile, "case": name, "passed": record["passed"],
                          "outputs": record.get("outputs", {}), "native": record["native"]}), flush=True)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    parity = exact and bool(records) and all(r["passed"] for r in records)
    report["status"] = "native-parity-passed" if parity else "verification-failed" if oracle else "recovered-native-unverified"
    bundle["verification_status"] = report["status"]
    torch.save(bundle, artifact)
    report.update(artifact=str(artifact), artifact_sha256=digest(data=artifact.read_bytes()),
                  all_declared_outputs_verified=parity)
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(PROFILES), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("--video", type=Path, action="append", default=[])
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = export(profile=args.profile, out=args.out, oracle=args.oracle, videos=args.video)
    print(json.dumps({key: result[key] for key in ("profile", "status", "artifact", "artifact_sha256", "parameter_count")}))
    return int(result["status"] == "verification-failed")


if __name__ == "__main__":
    raise SystemExit(main())
