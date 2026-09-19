"""Fresh forced-CPU matting comparisons, confined to the ignored private root."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess

import numpy as np
import torch

from matting_cpu_math import CPU_SOFTMAX
from ocr_torch import widen_fp16
from matting_torch import (CPU_FORMAT, ORDERED_CPU_FORMAT, CPU_RUNTIME_SHA256, INPUT_SHAPES, LOADED_SHA256, OUTPUTS, OUTPUT_SHAPES, SOURCE_PATH,
                           SOURCE_SHA256, MattingGraph, load_model, parse_graph)

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
EVIDENCE = PRIVATE / "matting-native-cwd-20260919/engine-0"
LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingTransition/current/Frameworks/libbytenn.dylib"
RUNTIME_SHA256 = CPU_RUNTIME_SHA256
FEEDBACK = dict(zip(("data1", "data2", "data3"), OUTPUTS[1:]))


def digest(*, data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fresh_directory(*, path: Path) -> Path:
    target = path.resolve()
    if target == PRIVATE.resolve() or not target.is_relative_to(PRIVATE.resolve()):
        raise ValueError("output must be beneath the private ignored root")
    if target.exists() and any(target.iterdir()):
        raise ValueError("fresh empty evidence directory required")
    target.mkdir(parents=True, exist_ok=True)
    return target


def write_schema(*, path: Path, shapes: dict[str, tuple[int, ...]]) -> None:
    path.write_text("".join(f"{name}\t{n}\t{w}\t{h}\t{c}\n" for name, (n, c, h, w) in shapes.items()))


def write_tensor(*, path: Path, value: torch.Tensor) -> None:
    value.detach().permute(0, 2, 3, 1).contiguous().numpy().astype("<f4").tofile(path)


def read_tensor(*, path: Path, shape: tuple[int, ...]) -> torch.Tensor:
    if path.stat().st_size != int(np.prod(shape)) * 4:
        raise ValueError(f"wrong float32 byte count: {path.name}")
    n, c, h, w = shape
    value = torch.from_numpy(np.fromfile(path, dtype="<f4").reshape(n, h, w, c).transpose(0, 3, 1, 2).copy())
    if not torch.isfinite(value).all():
        raise ValueError(f"nonfinite tensor: {path.name}")
    return value


def compare(*, actual: torch.Tensor, expected: torch.Tensor) -> dict[str, object]:
    if actual.shape != expected.shape or actual.dtype != torch.float32 or expected.dtype != torch.float32:
        return {"passed": False, "reason": "tensor schema mismatch"}
    if not torch.isfinite(actual).all() or not torch.isfinite(expected).all():
        return {"passed": False, "reason": "nonfinite tensor"}
    error = (actual.double() - expected.double()).abs()
    bounds = 1e-4 + 1e-4 * expected.double().abs()
    return {"passed": bool((error <= bounds).all()), "max_abs": float(error.max()),
            "mean_abs": float(error.mean()), "failing_values": int((error > bounds).sum()),
            "shape": list(actual.shape)}


def compile_oracle(*, out: Path) -> Path:
    binary = out / "matting-cpu-oracle"
    command = ["/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2",
               "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
               f"-Wl,-rpath,{LIBRARY.parent}", str(Path(__file__).with_name("matting_cpu_oracle.mm")),
               "-o", str(binary)]
    with (out / "compile.log").open("w") as log:
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=90)
    return binary


def run_oracle(*, binary: Path, graph: Path, arena: Path, out: Path, backend: str = "cpu") -> dict[str, object]:
    if digest(data=LIBRARY.read_bytes()) != RUNTIME_SHA256:
        raise ValueError("native runtime changed since verification")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DYLD_")}
    environment["DYLD_LIBRARY_PATH"] = str(LIBRARY.parent)
    native: dict[str, object] = {"requested_backend": backend, "status": "unverified", "runtime_sha256": RUNTIME_SHA256,
                                "oracle_sha256": digest(data=binary.read_bytes()), "graph_sha256": digest(data=graph.read_bytes()),
                                "arena_sha256": digest(data=arena.read_bytes())}
    try:
        with (out / "oracle.log").open("w") as log:
            result = subprocess.run([str(binary), str(LIBRARY), str(graph), str(arena), str(out), backend],
                                    cwd=out, env=environment, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        native["returncode"] = result.returncode
        runtime = json.loads((out / "native-runtime.json").read_text())
        native.update(runtime)
        if result.returncode or backend == "cpu" and runtime != {"forced_cpu": True, "forward_type": 0}:
            native["reason"] = "native failed or requested backend was not selected"
        else:
            native["status"] = "completed"
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        native["reason"] = str(error)
    return native


def synthetic_cases() -> dict[str, dict[str, torch.Tensor]]:
    cases = {"zeros": {name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}}
    for seed in (17, 41, 303, 509):
        generator = torch.Generator().manual_seed(seed)
        name = f"{'holdout-' if seed > 100 else ''}random-{seed}"
        cases[name] = {key: torch.rand(shape, generator=generator) * 2 - 1 for key, shape in INPUT_SHAPES.items()}
    cases["holdout-ramp"] = {name: torch.linspace(-1, 1, int(np.prod(shape))).reshape(shape) for name, shape in INPUT_SHAPES.items()}
    return cases


def verify_fp16(*, binary: Path, raw_arena: Path, out: Path) -> tuple[np.ndarray, dict[str, object]]:
    raw = raw_arena.read_bytes()
    bits = np.frombuffer(raw[:-4], dtype="<u2")
    weights = widen_fp16(bits=bits)
    native_path = out / "native-expanded-weights.f32"
    with (out / "native-expand.log").open("w") as log:
        subprocess.run([str(binary), "--expand-fp16", str(LIBRARY), str(raw_arena), str(native_path)],
                       check=True, stdout=log, stderr=subprocess.STDOUT, cwd=out, timeout=60)
    exact = weights.astype("<f4").tobytes() == native_path.read_bytes()
    standard = bits.view(np.float16).astype(np.float32)
    proof = {"passed": exact, "runtime_sha256": RUNTIME_SHA256,
             "profile": "arm64-four-lane-xor-subnormal-standard-tail",
             "helper": "ocr_torch.widen_fp16", "count": len(weights),
             "numpy_differing_values": int(np.count_nonzero(weights.view(np.uint32) != standard.view(np.uint32))),
             "numpy_max_abs": float(np.max(np.abs(weights - standard))),
             "original_fp16_sha256": digest(data=raw), "expanded_fp32_sha256": digest(data=weights.tobytes()),
             "native_expanded_file": str(native_path)}
    if not exact:
        raise ValueError("actual original FP16 arena disagrees with pinned native expansion")
    return weights, proof


def verify_case(*, path: Path, actual: dict[str, torch.Tensor], supplied: dict[str, torch.Tensor]) -> dict[str, object]:
    result: dict[str, object] = {"case": path.name, "passed": False}
    try:
        rows = [row.split("\t") for row in (path / "native-descriptors.tsv").read_text().splitlines()]
        descriptors = {}
        for row in rows:
            if len(row) != 8 or tuple(row[:2]) in descriptors:
                raise ValueError("invalid or duplicate native descriptor")
            kind, name = row[:2]
            schema = INPUT_SHAPES if kind == "input" else OUTPUT_SHAPES if kind == "output" else {}
            if name not in schema:
                raise ValueError("unknown native tensor")
            n, c, h, w = schema[name]
            if list(map(int, row[2:6])) != [n, w, h, c] or int(row[6]) != 4:
                raise ValueError("native NWHC shape mismatch")
            descriptors[kind, name] = row
        if len(descriptors) != 8:
            raise ValueError("all four inputs and all four outputs required")
        echoes = {}
        for name, shape in INPUT_SHAPES.items():
            applied = read_tensor(path=path / f"applied-{name}.f32", shape=shape)
            echoed = read_tensor(path=path / f"echo-{name}.f32", shape=shape)
            echoes[name] = bool(torch.equal(applied, echoed))
            if supplied and not torch.equal(supplied[name], applied):
                raise ValueError("applied native tensor differs from supplied tensor")
        outputs = {name: compare(actual=actual[name], expected=read_tensor(path=path / f"out-{name}.f32", shape=shape))
                   for name, shape in OUTPUT_SHAPES.items()}
        result.update(input_echo_exact=echoes, outputs=outputs,
                      passed=all(echoes.values()) and all(item["passed"] for item in outputs.values()))
    except (OSError, ValueError, KeyError) as error:
        result["reason"] = str(error)
    return result


def export(*, out: Path, ordered: bool = False) -> dict[str, object]:
    if type(ordered) is not bool:
        raise ValueError("ordered must be an explicit boolean")
    out = fresh_directory(path=out)
    source = SOURCE_PATH.read_bytes()
    bm = (EVIDENCE / "loaded-buffer.bin").read_bytes()
    graph_text = (EVIDENCE / "graph-32.txt").read_text()
    if digest(data=source) != SOURCE_SHA256 or digest(data=bm) != LOADED_SHA256:
        raise ValueError("unrecognized original source or recovered BM")
    if source.count(bm) != 1:
        raise ValueError("recovered BM must match an exact original source range")
    if digest(data=LIBRARY.read_bytes()) != RUNTIME_SHA256:
        raise ValueError("unrecognized native runtime")
    graph = out / "graph.private.txt"
    graph.write_text(graph_text)
    header = struct.unpack_from("<9I", bm)
    raw_arena = bm[header[6]:header[6] + header[5]]
    original_arena = out / "arena-fp16.private.bin"
    original_arena.write_bytes(raw_arena)
    binary = compile_oracle(out=out)
    weights, fp16_proof = verify_fp16(binary=binary, raw_arena=original_arena, out=out)
    arena = out / "arena-fp32.private.bin"
    # The recovered graph has already lost its outer E (FP16-arena) marker.
    arena.write_bytes(weights.astype("<f4").tobytes() + raw_arena[-4:])
    graph_type = MattingGraph
    arithmetic_profile = "torch"
    if ordered:
        from matting_phase5_torch import ORDERED_PROFILE, OrderedMattingGraph
        graph_type, arithmetic_profile = OrderedMattingGraph, ORDERED_PROFILE
    model = graph_type(nodes=parse_graph(text=graph_text), weights=weights, softmax_profile=CPU_SOFTMAX).eval()
    bundle = {"format": ORDERED_CPU_FORMAT if ordered else CPU_FORMAT, "nodes": model.nodes, "state_dict": model.state_dict(),
              "source_asset": {"path": str(SOURCE_PATH), "sha256": SOURCE_SHA256},
              "loaded_buffer": {"sha256": LOADED_SHA256}, "local_only": True,
              "runtime_sha256": RUNTIME_SHA256, "resize_profile": "half-pixel-zero-border", "softmax_profile": CPU_SOFTMAX,
              "input_schema": INPUT_SHAPES, "output_schema": OUTPUT_SHAPES,
              "fp16_decoder_profile": fp16_proof["profile"],
              "validation_status": "candidate-native-unverified"}
    if ordered:
        bundle["arithmetic_profile"] = arithmetic_profile
    artifact = out / "matting-gru.pt"
    torch.save(bundle, artifact)
    restored = load_model(path=artifact, allow_unverified=True)
    state_equal = all(torch.equal(value, restored.state_dict()[name]) for name, value in model.state_dict().items())
    write_schema(path=out / "inputs.tsv", shapes=INPUT_SHAPES)
    write_schema(path=out / "outputs.tsv", shapes=OUTPUT_SHAPES)
    cases = synthetic_cases()
    if ordered:
        from matting_phase5_cases import holdout_cases
        cases.update(holdout_cases())
    forward_equal = True
    actuals = {}
    with torch.inference_mode():
        for index, (name, inputs) in enumerate(cases.items()):
            path = out / f"case-{index:03d}-{name}"
            path.mkdir()
            for key, value in inputs.items():
                write_tensor(path=path / f"in-{key}.f32", value=value)
            actual = model(inputs)
            cloned = restored(inputs)
            forward_equal = forward_equal and all(torch.equal(actual[key], cloned[key]) for key in OUTPUTS)
            actuals[path] = actual
            for key, value in actual.items():
                write_tensor(path=path / f"pytorch-{key}.f32", value=value)
    native = run_oracle(binary=binary, graph=graph, arena=arena, out=out)
    results = [verify_case(path=path, actual=actual, supplied=inputs)
               for (path, actual), inputs in zip(actuals.items(), cases.values())]
    passed = state_equal and forward_equal and native["status"] == "completed" and bool(results) and all(case["passed"] for case in results)
    report = {"status": "native-parity-passed" if passed else "native-parity-failed" if native["status"] == "completed" else "native-unverified",
              "source_path": str(SOURCE_PATH), "source_sha256": SOURCE_SHA256, "bm_sha256": LOADED_SHA256,
              "source_bm_offset": source.index(bm), "runtime_sha256": RUNTIME_SHA256,
              "graph_sha256": digest(data=graph_text.encode()), "arena_sha256": digest(data=arena.read_bytes()),
              "artifact": str(artifact), "artifact_sha256": digest(data=artifact.read_bytes()),
              "arithmetic_profile": arithmetic_profile,
              "backend": "bytenn_cpu::Thrustor forced CPU", "native": native,
              "verification_scope": "forced CPU Thrustor forward_type=0; original FP16 arena expansion bit-exact against pinned native function; explicit retained four-output NWHC/NHWC tensors",
              "scope": "original-size network tensors; not product GPU/preprocessing/mask parity",
              "input_schema": INPUT_SHAPES, "output_schema": OUTPUT_SHAPES,
              "weights": "original FP16 parameters widened with verified native subnormal semantics", "fp16_decoder_proof": fp16_proof, "cases": results,
              "original_arena_sha256": digest(data=raw_arena),
              "roundtrip": {"state_equal": state_equal, "forward_equal": forward_equal},
              "tolerances": {"atol": 1e-4, "rtol": 1e-4}, "temporal_scope": "not-run",
              "legacy_session_evidence": str(PRIVATE / "matting-candidate-20260919/report.json")}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ordered", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(out=args.out, ordered=args.ordered)
    print(json.dumps({"status": report["status"], "artifact": report["artifact"], "native": report["native"],
                      "case_passes": [case["passed"] for case in report["cases"]]}, indent=2))
    return 0 if report["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
