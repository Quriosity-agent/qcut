"""Verify ONNX Stage1 heads on actual beauty-host inputs, without Torch/native calls."""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import sys

import numpy as np

import espresso_oracle
from espresso_graph import analyze
from face_alignment_heads_parity import FLOAT_LIMITS, comparisons
from face_render_model_capture import inventory
from face_render_sequence_probe import bounded_bytes, fresh_output
from face_render_stability_probe import digest


def load_tensor(*, item: dict) -> np.ndarray:
    dims, raw = item["dims_nwhc"], item["raw"]
    if (not isinstance(dims, list) or len(dims) != 4 or
            any(type(value) is not int or not 1 <= value <= 4096 for value in dims) or
            not isinstance(raw, list) or len(raw) != 2 or
            any(type(value) is not int for value in raw) or not -16 <= raw[1] <= 24):
        raise ValueError("bounded typed tensor descriptor required")
    n, width, height, channels = dims
    dtype = {1: np.dtype("<i1"), 2: np.dtype("<i2"), 4: np.dtype("<f4")}.get(raw[0])
    if dtype is None or not 1 <= n * width * height * channels <= 4 * 1024**2:
        raise ValueError("bounded known tensor descriptor required")
    size = n * width * height * channels * dtype.itemsize
    data = bounded_bytes(path=Path(item["path"]), limit=size)
    if len(data) != size or digest(data=data) != item["sha256"]:
        raise ValueError("captured model tensor identity mismatch")
    values = np.frombuffer(data, dtype=dtype).reshape(n, height, width, channels).copy()
    if not np.isfinite(values).all():
        raise ValueError("nonfinite captured model tensor")
    return values


def select_heads(*, outputs: list[dict], inference: int, names: list[str]) -> dict:
    if type(inference) is not int or inference < 0 or len(names) != 5 or len(set(names)) != 5:
        raise ValueError("five distinct heads and a completed inference required")
    result = {}
    for item in outputs:
        if item["inference"] != inference or item["name"] not in names:
            continue
        name = item["name"]
        if name in result and any(item[key] != result[name][key] for key in ("sha256", "raw", "dims_nwhc")):
            raise ValueError("repeated native head extraction changed before next inference")
        result[name] = item
    if set(result) != set(names) or len(names) != 5:
        raise ValueError("all five actual native heads required")
    return result


def run(*, args: argparse.Namespace) -> dict:
    import onnxruntime
    from espresso_onnx_runtime import session

    out = fresh_output(path=args.out)
    report = dict(passed=False, native_inference_called=False, native_analysis_bypassed=False,
                  full_frame_geometry_independent=False, model_outputs={}, failures=[])
    try:
        if onnxruntime.__version__ != "1.22.1" or any(
                name == "torch" or name.startswith("torch.") for name in sys.modules):
            raise ValueError("Torch-free ORT 1.22.1 required")
        capture, root = (espresso_oracle.private_path(path=path) for path in (args.capture, args.root))
        capture_bytes = bounded_bytes(path=capture / "report.json", limit=8 * 1024**2)
        captured = json.loads(capture_bytes)
        if (captured.get("passed") is not True or captured.get("native_analysis_bypassed") is not False or
                len(captured.get("comparisons", [])) != 4 or
                any(item.get("equal") is not True for item in captured["comparisons"])):
            raise ValueError("passed pixel-neutral actual host capture required")
        evidence = inventory(capture=capture / "capture")
        if evidence != captured.get("captures"):
            raise ValueError("capture files changed since pixel-neutral verification")
        exported_bytes = bounded_bytes(path=root / "summary.json", limit=16 * 1024**2)
        exported = json.loads(exported_bytes)
        if (exported.get("passed") is not True or exported.get("native_oracle_sha256") != espresso_oracle.RUNTIME_SHA256 or
                set(exported.get("networks", {})) != {"120", "160"} or
                exported.get("float_policies") != {key: list(value) for key, value in FLOAT_LIMITS.items()}):
            raise ValueError("passed complete Stage1 exports required")
        report.update(capture_sha256=digest(data=capture_bytes), export_summary_sha256=digest(data=exported_bytes),
                      versions=dict(onnxruntime=onnxruntime.__version__, numpy=np.__version__),
                      source_sha256={name: digest(data=Path(__file__).with_name(name).read_bytes()) for name in (
                          Path(__file__).name, "face_render_model_capture.py", "face_alignment_heads_parity.py",
                          "espresso_onnx_runtime.py", "espresso_graph.py", "espresso_oracle.py",
                          "face_render_sequence_probe.py", "face_render_consumer_probe.py",
                          "face_render_stability_probe.py")})
        all_files = {}
        for size in (120, 160):
            model = exported["networks"][str(size)]
            selected = [network for network in evidence["networks"].values()
                        if network["graph_sha256"] == model["graph_sha256"]]
            if len(selected) != 1 or not selected[0]["successful_inferences"]:
                raise ValueError("one active actual host network per Stage1 profile required")
            network = selected[0]
            graph_bytes = bounded_bytes(path=Path(network["graph_path"]), limit=1024**2)
            if digest(data=graph_bytes) != model["graph_sha256"]:
                raise ValueError("actual host graph hash differs from converted model")
            graph = analyze(graph_bytes.decode("utf-8"))
            checkers = comparisons(graph=graph)
            artifact = f"align-{size}/artifacts/model.onnx"
            path = root / artifact
            file_digest = digest(data=bounded_bytes(path=path, limit=128 * 1024**2))
            if file_digest != exported.get("artifacts", {}).get(artifact):
                raise ValueError("ONNX artifact hash mismatch")
            all_files[path] = file_digest
            runner = session(path=path)
            try:
                names = model["terminal_names"]
                if [item.name for item in runner.get_outputs()] != names or len(names) != 5:
                    raise ValueError("complete ONNX terminal metadata required")
                actual_inputs = runner.get_inputs()
                if (len(actual_inputs) != 1 or actual_inputs[0].name != "data" or
                        actual_inputs[0].shape != [1, size, size, 3] or actual_inputs[0].type != "tensor(int64)"):
                    raise ValueError("ONNX Stage1 input metadata mismatch")
                cases = []
                reference_path = root / f"align-{size}/recorded-face/input.npy"
                reference_data = bounded_bytes(path=reference_path, limit=1024**2)
                all_files[reference_path] = digest(data=reference_data)
                reference = np.load(io.BytesIO(reference_data), allow_pickle=False)
                if (reference.shape != (1, size, size, 3) or
                        reference.dtype != np.dtype(np.int16 if size == 120 else np.int8) or
                        digest(data=reference.tobytes()) != model["cases"]["recorded-face"]["input_sha256"]["data"]):
                    raise ValueError("recorded reference input provenance mismatch")
                for inference in network["successful_inferences"]:
                    inputs = [item for item in network["inputs"] if item["inference"] == inference]
                    if (len(inputs) != 1 or inputs[0]["name"] != "data" or
                            inputs[0]["dims_nwhc"] != [1, size, size, 3] or
                            inputs[0]["raw"] != [2 if size == 120 else 1, 6]):
                        raise ValueError("actual host Stage1 input storage mismatch")
                    values = load_tensor(item=inputs[0])
                    if (values < -128).any() or (values > 127).any():
                        raise ValueError("Stage1 signed pixels out of range")
                    heads = select_heads(outputs=network["outputs"], inference=inference, names=names)
                    outputs = runner.run(None, {"data": values.astype(np.int64)})
                    if len(outputs) != len(names):
                        raise ValueError("incomplete ONNX execution")
                    checks = {}
                    for name, output in zip(names, outputs, strict=True):
                        original = load_tensor(item=heads[name])
                        checks[name] = checkers[name](actual=output, expected=original,
                                                     descriptor=graph["descriptors"][name], raw=heads[name]["raw"])
                        np.save(out / f"size-{size}-infer-{inference:03d}-{name}.npy", output)
                    cases.append(dict(inference=inference, passed=all(item["passed"] for item in checks.values()),
                                      checks=checks, actual_input_sha256=inputs[0]["sha256"],
                                      recorded_reference_input_equal=np.array_equal(values, reference),
                                      input_changed_elements=int(np.count_nonzero(values != reference))))
                report["model_outputs"][str(size)] = dict(graph_sha256=model["graph_sha256"], onnx_sha256=file_digest,
                                                          successful_inferences=len(cases), cases=cases)
            finally:
                runner = None
        if inventory(capture=capture / "capture") != evidence or any(
                digest(data=bounded_bytes(path=path, limit=128 * 1024**2)) != expected for path, expected in all_files.items()):
            raise RuntimeError("actual model capture or ONNX artifact mutated during verification")
        if (bounded_bytes(path=capture / "report.json", limit=8 * 1024**2) != capture_bytes or
                bounded_bytes(path=root / "summary.json", limit=16 * 1024**2) != exported_bytes or
                any(digest(data=Path(__file__).with_name(name).read_bytes()) != expected
                    for name, expected in report["source_sha256"].items())):
            raise RuntimeError("actual-model provenance changed during execution")
        if any(name == "torch" or name.startswith("torch.") for name in sys.modules):
            raise RuntimeError("actual-model verifier imported Torch")
        report["passed"] = all(case["passed"] for network in report["model_outputs"].values() for case in network["cases"])
        report["head_comparisons"] = sum(len(case["checks"]) for network in report["model_outputs"].values() for case in network["cases"])
        if not report["passed"]:
            raise RuntimeError("actual beauty-host ONNX head parity failed without loosening gates")
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "root", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    result = run(args=parser.parse_args())
    print(json.dumps(dict(passed=result["passed"], head_comparisons=result["head_comparisons"]), indent=2))


if __name__ == "__main__":
    main()
