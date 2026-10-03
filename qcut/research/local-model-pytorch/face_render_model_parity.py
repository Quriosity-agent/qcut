"""Verify ONNX Stage1 heads on actual beauty-host inputs, without Torch/native calls."""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
from pathlib import Path
import sys

import numpy as np

import espresso_oracle
from espresso_graph import analyze
from face_alignment_heads_parity import FLOAT_LIMITS, comparisons
from face_alignment_replay import strict_json
from face_render_model_capture import inventory
from face_render_sequence_probe import bounded_bytes, fresh_output
from face_render_stability_probe import digest


def no_torch() -> None:
    if (any(name == "torch" or name.startswith("torch.") for name in sys.modules) or
            importlib.util.find_spec("torch") is not None):
        raise ValueError("Torch-free verification requires no installed or imported Torch")


def load_report(*, data: bytes) -> dict:
    value = strict_json(data=data)
    if not isinstance(value, dict):
        raise ValueError("report object required")
    return value


def require_sha256(*, value) -> None:
    if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise ValueError("SHA-256 identity required")


def require_path(*, value) -> None:
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("nonempty local path required")


def tensor_descriptor(*, item: dict) -> tuple[tuple[int, int, int, int], np.dtype]:
    if not isinstance(item, dict):
        raise ValueError("tensor descriptor object required")
    dims, raw = item.get("dims_nwhc"), item.get("raw")
    if (not isinstance(dims, list) or len(dims) != 4 or
            any(type(value) is not int or not 1 <= value <= 4096 for value in dims) or
            not isinstance(raw, list) or len(raw) != 2 or
            any(type(value) is not int for value in raw) or not -16 <= raw[1] <= 24):
        raise ValueError("bounded typed tensor descriptor required")
    n, width, height, channels = dims
    dtype = {1: np.dtype("<i1"), 2: np.dtype("<i2"), 4: np.dtype("<f4")}.get(raw[0])
    if dtype is None or not 1 <= n * width * height * channels <= 4 * 1024**2:
        raise ValueError("bounded known tensor descriptor required")
    require_path(value=item.get("path"))
    require_sha256(value=item.get("sha256"))
    return (n, height, width, channels), dtype


def load_tensor(*, item: dict) -> np.ndarray:
    shape, dtype = tensor_descriptor(item=item)
    size = int(np.prod(shape)) * dtype.itemsize
    data = bounded_bytes(path=Path(item["path"]), limit=size)
    if len(data) != size or digest(data=data) != item["sha256"]:
        raise ValueError("captured model tensor identity mismatch")
    values = np.frombuffer(data, dtype=dtype).reshape(shape).copy()
    if not np.isfinite(values).all():
        raise ValueError("nonfinite captured model tensor")
    return values


def require_heads(*, names) -> None:
    if (not isinstance(names, list) or len(names) != 5 or
            any(not isinstance(name, str) or not name or name in (".", "..") or
                Path(name).name != name or "\0" in name for name in names) or len(set(names)) != 5):
        raise ValueError("five distinct heads and a completed inference required")


def validate_capture_tensor(*, item: dict) -> None:
    tensor_descriptor(item=item)
    if (not isinstance(item.get("name"), str) or not item["name"] or
            type(item.get("inference")) is not int or not -1 <= item["inference"] <= 128):
        raise ValueError("named tensor with a typed capture inference required")


def select_heads(*, outputs: list[dict], inference: int, names: list[str]) -> dict:
    require_heads(names=names)
    if type(inference) is not int or not 0 <= inference <= 128 or not isinstance(outputs, list):
        raise ValueError("five distinct heads and a completed inference required")
    result = {}
    for item in outputs:
        validate_capture_tensor(item=item)
        if item["inference"] != inference or item["name"] not in names:
            continue
        name = item["name"]
        if name in result and any(item[key] != result[name][key] for key in ("sha256", "raw", "dims_nwhc")):
            raise ValueError("repeated native head extraction changed before next inference")
        result[name] = item
    if set(result) != set(names) or len(names) != 5:
        raise ValueError("all five actual native heads required")
    return result


def validate_inventory(*, evidence: dict) -> None:
    if (not isinstance(evidence, dict) or not isinstance(evidence.get("networks"), dict) or
            not 1 <= len(evidence["networks"]) <= 4096 or
            type(evidence.get("metadata_records")) is not int or not 1 <= evidence["metadata_records"] <= 4096 or
            type(evidence.get("successful_inferences")) is not int or evidence["successful_inferences"] < 1):
        raise ValueError("bounded typed capture inventory required")
    completed = 0
    for identity, network in evidence["networks"].items():
        if (not isinstance(identity, str) or not identity.isdecimal() or int(identity) < 1 or
                not isinstance(network, dict)):
            raise ValueError("captured network object required")
        require_sha256(value=network.get("graph_sha256"))
        require_path(value=network.get("graph_path"))
        declared = network.get("declared_outputs")
        if not isinstance(declared, list) or not declared or any(not isinstance(name, str) for name in declared):
            raise ValueError("declared native output names required")
        # The capture writer appends a semicolon after each declared name.
        names = declared[:-1] if declared[-1] == "" else declared
        if any(not name for name in names) or len(set(names)) != len(names):
            raise ValueError("ambiguous declared native outputs")
        successes = network.get("successful_inferences")
        if (not isinstance(successes, list) or len(successes) > 129 or
                any(type(index) is not int for index in successes) or successes != list(range(len(successes)))):
            raise ValueError("typed contiguous successful inference sequence required")
        for key in ("inputs", "outputs"):
            records = network.get(key)
            if not isinstance(records, list) or len(records) > 4096:
                raise ValueError("bounded tensor capture list required")
            for item in records:
                validate_capture_tensor(item=item)
                if item["inference"] >= 0 and item["inference"] not in successes:
                    raise ValueError("captured tensor lacks a successful inference")
        for inference in successes:
            inputs = [item for item in network["inputs"] if item["inference"] == inference]
            if not inputs or len({item["name"] for item in inputs}) != len(inputs):
                raise ValueError("completed inference has missing or duplicate inputs")
        completed += len(successes)
    if completed != evidence["successful_inferences"]:
        raise ValueError("capture inference total mismatch")


def validate_capture(*, captured: dict) -> None:
    if (not isinstance(captured, dict) or captured.get("passed") is not True or
            captured.get("native_analysis_bypassed") is not False or
            not isinstance(captured.get("comparisons"), list) or len(captured["comparisons"]) != 4 or
            any(not isinstance(item, dict) or item.get("equal") is not True for item in captured["comparisons"])):
        raise ValueError("passed pixel-neutral actual host capture required")
    validate_inventory(evidence=captured.get("captures"))


def validate_export(*, exported: dict) -> None:
    if (not isinstance(exported, dict) or exported.get("passed") is not True or
            exported.get("native_oracle_sha256") != espresso_oracle.RUNTIME_SHA256 or
            not isinstance(exported.get("networks"), dict) or set(exported["networks"]) != {"120", "160"} or
            not isinstance(exported.get("float_policies"), dict) or set(exported["float_policies"]) != set(FLOAT_LIMITS) or
            not isinstance(exported.get("artifacts"), dict)):
        raise ValueError("passed complete Stage1 exports required")
    for key, expected in FLOAT_LIMITS.items():
        actual = exported["float_policies"][key]
        if (not isinstance(actual, list) or len(actual) != 3 or
                any(type(value) is not type(limit) or value != limit for value, limit in zip(actual, expected, strict=True))):
            raise ValueError("fixed typed Stage1 float policies required")
    hashes = []
    for size, model in exported["networks"].items():
        if not isinstance(model, dict):
            raise ValueError("Stage1 model descriptor required")
        require_sha256(value=model.get("graph_sha256"))
        hashes.append(model["graph_sha256"])
        require_heads(names=model.get("terminal_names"))
        cases = model.get("cases")
        reference = cases.get("recorded-face") if isinstance(cases, dict) else None
        identities = reference.get("input_sha256") if isinstance(reference, dict) else None
        if not isinstance(identities, dict) or set(identities) != {"data"}:
            raise ValueError("recorded Stage1 input identity required")
        require_sha256(value=identities["data"])
        require_sha256(value=exported["artifacts"].get(f"align-{size}/artifacts/model.onnx"))
    if len(set(hashes)) != 2:
        raise ValueError("distinct Stage1 profile graphs required")


def validate_graph(*, graph: dict, size: int, names: list[str], network: dict) -> None:
    require_heads(names=names)
    produced, consumed = set(), set()
    inputs = []
    for layer in graph["layers"]:
        if any(name not in produced for name in layer["inputs"]):
            raise ValueError("graph input lacks an unambiguous producer")
        if layer["op"] == "Input":
            inputs.append(layer)
        consumed.update(layer["inputs"])
        for name in layer["outputs"]:
            if name in produced:
                raise ValueError("duplicate graph blob producer")
            produced.add(name)
    if (len(inputs) != 1 or inputs[0]["outputs"] != ["data"] or
            graph["shapes"]["data"] != (1, size, size, 3) or
            graph["descriptors"]["data"] != {"type": 2 if size == 120 else 1, "fraction": 6}):
        raise ValueError("graph Stage1 input profile mismatch")
    outputs = produced - {"data"}
    terminals = outputs - consumed
    if set(names) != terminals or any(graph["descriptors"][name] != {"type": 4, "fraction": 0} for name in names):
        raise ValueError("all five graph float terminals required")
    declared = {name for name in network["declared_outputs"] if name}
    if not declared <= outputs:
        raise ValueError("declared native output has no graph association")
    for key in ("inputs", "outputs"):
        allowed = {"data"} if key == "inputs" else produced
        for item in network[key]:
            name = item["name"]
            if name not in allowed:
                raise ValueError("captured tensor has no graph association")
            shape, _ = tensor_descriptor(item=item)
            descriptor = graph["descriptors"][name]
            if shape != graph["shapes"][name] or item["raw"] != [descriptor["type"], descriptor["fraction"]]:
                raise ValueError("captured tensor differs from graph shape or storage")


def run(*, args: argparse.Namespace) -> dict:
    out = fresh_output(path=args.out)
    report = dict(passed=False, native_inference_called=False, native_analysis_bypassed=False,
                  full_frame_geometry_independent=False, model_outputs={}, failures=[])
    try:
        no_torch()
        import onnxruntime
        from espresso_onnx_runtime import session

        no_torch()
        if onnxruntime.__version__ != "1.22.1":
            raise ValueError("Torch-free ORT 1.22.1 required")
        capture, root = (espresso_oracle.private_path(path=path) for path in (args.capture, args.root))
        capture_bytes = bounded_bytes(path=capture / "report.json", limit=8 * 1024**2)
        captured = load_report(data=capture_bytes)
        validate_capture(captured=captured)
        evidence = inventory(capture=capture / "capture")
        validate_inventory(evidence=evidence)
        if evidence != captured.get("captures"):
            raise ValueError("capture files changed since pixel-neutral verification")
        exported_bytes = bounded_bytes(path=root / "summary.json", limit=16 * 1024**2)
        exported = load_report(data=exported_bytes)
        validate_export(exported=exported)
        report.update(capture_sha256=digest(data=capture_bytes), export_summary_sha256=digest(data=exported_bytes),
                      versions=dict(onnxruntime=onnxruntime.__version__, numpy=np.__version__),
                      source_sha256={name: digest(data=Path(__file__).with_name(name).read_bytes()) for name in (
                          Path(__file__).name, "face_render_model_capture.py", "face_alignment_heads_parity.py",
                          "face_alignment_replay.py",
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
            names = model["terminal_names"]
            validate_graph(graph=graph, size=size, names=names, network=network)
            checkers = comparisons(graph=graph)
            artifact = f"align-{size}/artifacts/model.onnx"
            path = root / artifact
            file_digest = digest(data=bounded_bytes(path=path, limit=128 * 1024**2))
            if file_digest != exported.get("artifacts", {}).get(artifact):
                raise ValueError("ONNX artifact hash mismatch")
            all_files[path] = file_digest
            runner = session(path=path)
            try:
                if [item.name for item in runner.get_outputs()] != names or len(names) != 5:
                    raise ValueError("complete ONNX terminal metadata required")
                actual_inputs = runner.get_inputs()
                if (len(actual_inputs) != 1 or actual_inputs[0].name != "data" or
                        actual_inputs[0].shape != [1, size, size, 3] or
                        any(type(value) is not int for value in actual_inputs[0].shape) or
                        actual_inputs[0].type != "tensor(int64)"):
                    raise ValueError("ONNX Stage1 input metadata mismatch")
                cases = []
                reference_path = root / f"align-{size}/recorded-face/input.npy"
                reference_data = bounded_bytes(path=reference_path, limit=1024**2)
                all_files[reference_path] = digest(data=reference_data)
                reference = np.load(io.BytesIO(reference_data), allow_pickle=False)
                if (not isinstance(reference, np.ndarray) or reference.shape != (1, size, size, 3) or
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
        no_torch()
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
