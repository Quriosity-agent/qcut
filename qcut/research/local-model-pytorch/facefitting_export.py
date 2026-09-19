"""Generate a private face-fitting bundle and optional native same-input cases."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import torch

from container_scan import RUNTIME_SHA256, decode_graph, runtime_graph_table
from facefitting_torch import BM_SHA256, FORMAT, SOURCE_SHA256, FaceFittingGraph, load_model, parse_spec
from model_containers import bytenn_sections, inspect_container

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
RUNTIMES = Path.home() / "Library/Application Support/QCut/PrivateRuntimes"
SOURCE = RUNTIMES / "JianyingFilter/current/Models/tt_facefitting_3d_v6.2_size4_md5054e6805e1f42ba6950a9ff678aedb49.model"
LIBRARY = RUNTIMES / "JianyingShotSplit/current/Frameworks/libbytenn.dylib"


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def safe_directory(*, out):
    target = out.resolve()
    if not target.is_relative_to(PRIVATE.resolve()) or target == PRIVATE.resolve():
        raise ValueError("outputs must stay beneath private ignored directory")
    if target.exists() and any(target.iterdir()):
        raise ValueError("use a new empty run directory to avoid stale native evidence")
    target.mkdir(parents=True, exist_ok=True)
    return target


def build_cases():
    cases = {"zeros": np.zeros((1, 212), dtype=np.float32),
             "ones": np.ones((1, 212), dtype=np.float32),
             "negative-ones": -np.ones((1, 212), dtype=np.float32),
             "ramp": np.linspace(-1, 1, 212, dtype=np.float32).reshape(1, 212)}
    for seed in (17, 41, 83, 101):
        cases[f"random-{seed}"] = np.random.default_rng(seed).uniform(-1, 1, (1, 212)).astype(np.float32)
    for seed in (303, 509):
        cases[f"holdout-unit-{seed}"] = np.random.default_rng(seed).uniform(0, 1, (1, 212)).astype(np.float32)
    pulse = np.zeros((1, 212), dtype=np.float32)
    pulse[0, 0], pulse[0, -1] = 1.0, -1.0
    cases["holdout-edge-pulse"] = pulse
    return cases


def compare_native_case(*, directory, output_scale):
    result = {"shape": None, "max_abs": None, "mae": None,
              "max_abs_divided_by_output_scale": None, "input_echo_exact": False, "passed": False}
    try:
        shape = json.loads((directory / "native-shape.json").read_text())
        if shape != [1, 1, 1, 442] or any(type(value) is not int for value in shape):
            raise ValueError("invalid native output shape")
        result["shape"] = shape
        if not np.isfinite(output_scale) or output_scale <= 0:
            raise ValueError("invalid output scale")
        for name in ("native-input.f32", "input.f32"):
            if (directory / name).stat().st_size != 212 * 4:
                raise ValueError(f"{name}: expected exactly 212 float32 values")
        for name in ("native-output.f32", "pytorch-output.f32"):
            if (directory / name).stat().st_size != 442 * 4:
                raise ValueError(f"{name}: expected exactly 442 float32 values")
        expected = np.fromfile(directory / "native-output.f32", dtype="<f4").astype(np.float64)
        actual = np.fromfile(directory / "pytorch-output.f32", dtype="<f4").astype(np.float64)
        same_input = (directory / "native-input.f32").read_bytes() == (directory / "input.f32").read_bytes()
        result["input_echo_exact"] = same_input
        if not np.isfinite(expected).all() or not np.isfinite(actual).all():
            raise ValueError("nonfinite output")
        if not same_input:
            raise ValueError("native input echo differs from supplied input")
        difference = np.abs(expected - actual)
        result.update(max_abs=float(difference.max()), mae=float(difference.mean()),
                      max_abs_divided_by_output_scale=float(difference.max() / output_scale),
                      passed=bool(np.allclose(expected, actual, atol=1e-4, rtol=1e-4)))
        if not result["passed"]:
            result["reason"] = "native output exceeds unchanged atol=1e-4, rtol=1e-4"
    except (OSError, ValueError, TypeError) as error:
        result["reason"] = str(error)
    return result


def export(*, out, oracle):
    out = safe_directory(out=out)
    source = SOURCE.read_bytes()
    if digest(data=source) != SOURCE_SHA256:
        raise ValueError("unrecognized face-fitting source")
    candidates = [item for item in inspect_container(data=source)["findings"] if item["kind"] == "bytenn-bm"]
    if len(candidates) != 1:
        raise ValueError("expected one bounded face-fitting subnetwork")
    candidate = candidates[0]
    bm = source[candidate["offset"]:candidate["offset"] + candidate["bytes"]]
    if digest(data=bm) != BM_SHA256:
        raise ValueError("unrecognized face-fitting subnetwork")
    text, graph_report = decode_graph(data=bm, offset=0, table=runtime_graph_table(path=LIBRARY))
    spec = parse_spec(text=text)
    (out / "graph.private.txt").write_text(text)
    section = bytenn_sections(data=bm, offset=0)["sections"][1]
    arena = bm[section["offset"]:section["offset"] + section["bytes"]]
    (out / "weights.private.bin").write_bytes(arena)
    weights = np.frombuffer(arena[:-4], dtype="<f4").copy()
    model = FaceFittingGraph(spec=spec, weights=weights).eval()
    bundle = {"format": FORMAT, "source_sha256": SOURCE_SHA256, "bm_sha256": BM_SHA256,
              "graph_sha256": digest(data=text.encode()), "runtime_sha256": RUNTIME_SHA256,
              "local_only": True, "spec": spec, "state_dict": model.state_dict()}
    artifact = out / "facefitting.pt"
    torch.save(bundle, artifact)
    artifact_sha = digest(data=artifact.read_bytes())
    restored = load_model(path=artifact, expected_sha256=artifact_sha)
    parameter_equal = all(torch.equal(value, restored.state_dict()[name]) for name, value in model.state_dict().items())
    cases = []
    for name, values in build_cases().items():
        directory = out / f"case-{name}"
        directory.mkdir()
        values.tofile(directory / "input.f32")
        with torch.inference_mode():
            outputs = model({spec["input_name"]: torch.from_numpy(values)})
            cloned = restored({spec["input_name"]: torch.from_numpy(values)})
        output = outputs[spec["output_name"]]
        output.numpy().tofile(directory / "pytorch-output.f32")
        cases.append({"case": name, "outputs": list(outputs), "shape": list(output.shape),
                      "finite": bool(torch.isfinite(output).all()),
                      "roundtrip_exact": torch.equal(output, cloned[spec["output_name"]]),
                      "input_sha256": digest(data=values.tobytes())})
    native = {"requested": oracle, "status": "not-run"}
    if oracle:
        compiler = "/Library/Developer/CommandLineTools/usr/bin/clang++"
        binary = out / "facefitting-oracle"
        command = [compiler, "-std=c++17", "-O2", "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
                   f"-Wl,-rpath,{LIBRARY.parent}", str(Path(__file__).with_name("facefitting_oracle.mm")), "-o", str(binary)]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=60)
            with (out / "oracle.log").open("w") as log:
                result = subprocess.run([str(binary), str(LIBRARY), str(out / "graph.private.txt"),
                                         str(out / "weights.private.bin"), str(out), spec["output_name"]],
                                        stdout=log, stderr=subprocess.STDOUT, cwd=out, timeout=60)
            native.update(status="completed" if result.returncode == 0 else "blocked", returncode=result.returncode)
        except (OSError, subprocess.SubprocessError) as error:
            native.update(status="blocked", reason=str(error))
        if native["status"] == "completed":
            try:
                runtime_evidence = json.loads((out / "native-runtime.json").read_text())
                if runtime_evidence != {"forced_cpu": True, "forward_type": 0}:
                    raise ValueError("missing forced CPU runtime evidence")
                native.update(runtime_evidence)
            except (OSError, ValueError, TypeError) as error:
                native.update(status="invalid-evidence", reason=str(error))
            for case in cases:
                directory = out / f"case-{case['case']}"
                case["native"] = compare_native_case(directory=directory, output_scale=model.scale.item())
    self_pass = parameter_equal and bool(cases) and all(case["finite"] and case["roundtrip_exact"] for case in cases)
    parity = self_pass and native["status"] == "completed" and all(case.get("native", {}).get("passed", False) for case in cases)
    status = "native-parity-passed" if parity else "recovered-native-unverified"
    if not self_pass or native["status"] in {"completed", "invalid-evidence"} and not parity:
        status = "verification-failed"
    report = {"format": FORMAT, "status": status, "source": str(SOURCE), "source_path": str(SOURCE), "source_sha256": SOURCE_SHA256,
              "bm_sha256": BM_SHA256, "artifact": str(artifact), "artifact_sha256": artifact_sha,
              "artifact_bytes": artifact.stat().st_size, "runtime_sha256": RUNTIME_SHA256, "spec": spec,
              "graph_recovery": graph_report, "weight_values": len(weights), "unused_trailer_bytes": 4,
              "parameter_roundtrip_exact": parameter_equal, "cpu_only": True,
              "output_scale": model.scale.item(), "all_declared_outputs_verified": parity,
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "native": native, "cases": cases,
              "end_to_end_face_pipeline_verified": False}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--oracle", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(out=args.out, oracle=args.oracle)
    print(json.dumps(report, indent=2))
    return 1 if report["status"] == "verification-failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
