"""Export bounded tensor graphs and verify every output with ONNX Runtime CPU."""
import argparse
import copy
import json
from pathlib import Path
import platform
import warnings

import numpy as np
import onnx
import torch
from torch import nn

from infer import load_inputs, load_predictor
from onnx_infer import FORMAT, ONNXModel, digest

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


class ShotGraph(nn.Module):
    def __init__(self, *, backbone, head):
        super().__init__()
        self.backbone, self.head = backbone, head

    def forward(self, inputs):
        features = self.backbone(inputs["frames"])
        return {"features": features, "probability": self.head(features)}


class TFLiteGraph(nn.Module):
    def __init__(self, *, model):
        super().__init__()
        self.model = model

    def forward(self, inputs):
        return {"logits": self.model(inputs["image"])}


class TupleGraph(nn.Module):
    def __init__(self, *, model, inputs, outputs):
        super().__init__()
        self.model, self.input_names, self.output_names = model, inputs, outputs

    def forward(self, *inputs):
        results = self.model(dict(zip(self.input_names, inputs, strict=True)))
        return tuple(results[name] for name in self.output_names)


def export_model(*, path, network=None):
    kind = torch.load(path, map_location="cpu", weights_only=True).get("format")
    if kind == "qcut-private-matting-gru-cpu-v3":
        raise ValueError("GRU v3 CPU parity is approved, but its ONNX numeric adapter is not qualified")
    if kind in {"qcut-private-shot-pytorch", "qcut-private-legacy-shot-pytorch"}:
        if network is not None:
            raise ValueError("shot export combines backbone and temporal head")
        if kind == "qcut-private-shot-pytorch":
            from shot_export import load_shots
            backbone, head = load_shots(path=path)
        else:
            from legacy_shot_export import load_legacy
            backbone, head = load_legacy(path=path)
        return ShotGraph(backbone=backbone, head=head).eval(), kind
    if kind == "qcut-bounded-tflite-pytorch":
        if network is not None:
            raise ValueError("TFLite does not have a network selector")
        from tflite_torch import load_model
        return TFLiteGraph(model=load_model(path=path)).eval(), kind
    model, kind = load_predictor(path=path, network=network)
    if not isinstance(model, nn.Module):
        raise ValueError("export requires a registered nn.Module")
    return model, kind


def schema(*, values):
    return {name: {"shape": list(value.shape), "dtype": str(value.detach().numpy().dtype)} for name, value in values.items()}


def compare(*, actual, expected):
    if set(actual) != set(expected):
        raise ValueError("output names changed during export")
    metrics = {}
    for name, reference in expected.items():
        value = actual[name]
        reference = reference.detach().numpy()
        valid = value.shape == reference.shape and value.dtype == reference.dtype and np.isfinite(value).all()
        exact = bool(valid and np.array_equal(value, reference))
        passed = bool(valid and (exact if value.dtype == np.int16 else np.allclose(value, reference, atol=1e-4, rtol=1e-4)))
        metrics[name] = {"passed": passed, "exact": exact, "shape": list(reference.shape),
                         "max_abs": float(np.max(np.abs(value.astype(np.float64) - reference.astype(np.float64)))) if valid else None}
    return metrics


def cases(*, inputs):
    yield "provided-fixture", inputs
    yield "zeros", {name: torch.zeros_like(value) for name, value in inputs.items()}
    for seed in (7103, 19019):
        generator = torch.Generator().manual_seed(seed)
        yield f"holdout-{seed}", {name: (torch.randint(-2047, 2048, value.shape, dtype=torch.int16, generator=generator)
                                        if value.dtype == torch.int16 else torch.rand(value.shape, generator=generator) * 2 - 1)
                                  for name, value in inputs.items()}


def export(*, model_path, input_path, out, network=None):
    out = Path(out).resolve()
    if out == PRIVATE.resolve() or not out.is_relative_to(PRIVATE.resolve()) or (out.exists() and any(out.iterdir())):
        raise ValueError("fresh private export directory required")
    out.mkdir(parents=True, exist_ok=True)
    result = {"status": "export-failed", "source_bundle": str(Path(model_path).resolve()),
              "network": network, "platform": platform.platform(), "cases": [],
              "scope": "ONNX Runtime versus PyTorch same-tensor output parity; not new vendor or editor parity"}
    try:
        result.update(source_bundle_sha256=digest(path=model_path), input_sha256=digest(path=input_path))
        inputs = load_inputs(path=input_path)
        model, kind = export_model(path=model_path, network=network)
        with torch.inference_mode():
            outputs = model(inputs)
        export_graph = model
        if kind == "qcut-private-tracking-pytorch-v1":
            from onnx_tracking import ONNXTrackingFixed, ONNXTrackingHead
            adapter = ONNXTrackingFixed if model.graph["fixed"] else ONNXTrackingHead
            export_graph = adapter(original=model).eval()
        if kind == "qcut-private-ocr-recognizer-logits-pytorch-v4":
            from onnx_numeric import PinnedSigmoid
            export_graph = copy.deepcopy(model)
            export_graph.sigmoid = PinnedSigmoid()
        wrapper = TupleGraph(model=export_graph, inputs=list(inputs), outputs=list(outputs)).eval()
        artifact = out / "model.onnx"
        with warnings.catch_warnings(record=True) as observed, torch.inference_mode():
            warnings.simplefilter("always")
            torch.onnx.export(wrapper, tuple(inputs.values()), str(artifact), opset_version=18, dynamo=False,
                              input_names=list(inputs), output_names=list(outputs), external_data=False)
        (out / "export-warnings.json").write_text(json.dumps(sorted({str(item.message) for item in observed}), indent=2) + "\n")
        graph = onnx.load(artifact, load_external_data=False)
        # Legacy tracing can leave symbolic output extents after static Pad/Resize.
        for value in graph.graph.output:
            value.type.tensor_type.shape.ClearField("dim")
            for dimension in outputs[value.name].shape:
                value.type.tensor_type.shape.dim.add().dim_value = int(dimension)
        onnx.checker.check_model(graph, full_check=True)
        domains = sorted({node.domain for node in graph.graph.node if node.domain not in ("", "ai.onnx")})
        if domains or graph.functions or any(tensor.data_location == onnx.TensorProto.EXTERNAL for tensor in graph.graph.initializer):
            raise ValueError("nonportable custom operators, functions, or external tensors")
        onnx.save(graph, artifact)
        metadata = {"format": FORMAT, "status": "candidate-unverified", "local_only": True,
                    "artifact": artifact.name, "artifact_sha256": digest(path=artifact), "external_data": False,
                    "custom_operators": [], "opset": 18, "source_format": kind,
                    "source_bundle_sha256": result["source_bundle_sha256"], "network": network,
                    "inputs": schema(values=inputs), "outputs": schema(values=outputs),
                    "shape_scope": "fixed export shapes only; no implicit dynamic-shape claim",
                    "torch_version": torch.__version__, "onnx_version": onnx.__version__}
        for spec in metadata["inputs"].values():
            if spec["dtype"] == "int16":
                spec["range"] = [-2047, 2047]
        contract = out / "contract.json"
        contract.write_text(json.dumps(metadata, indent=2) + "\n")
        runtime = ONNXModel(contract_path=contract, allow_unverified=True)
        for name, values in cases(inputs=inputs):
            with torch.inference_mode():
                expected = model(values)
            candidate = runtime({key: value.numpy() for key, value in values.items()})
            metrics = compare(actual=candidate, expected=expected)
            directory = out / name
            directory.mkdir()
            np.savez(directory / "inputs.npz", **{key: value.numpy() for key, value in values.items()})
            np.savez(directory / "pytorch.npz", **{key: value.numpy() for key, value in expected.items()})
            np.savez(directory / "onnx.npz", **candidate)
            result["cases"].append({"case": name, "passed": all(item["passed"] for item in metrics.values()), "outputs": metrics})
        passed = bool(result["cases"]) and all(case["passed"] for case in result["cases"])
        metadata["status"] = "onnx-runtime-parity-passed" if passed else "onnx-runtime-parity-failed"
        contract.write_text(json.dumps(metadata, indent=2) + "\n")
        result.update(status=metadata["status"], contract=str(contract), artifact=str(artifact),
                      artifact_sha256=metadata["artifact_sha256"], inputs=metadata["inputs"], outputs=metadata["outputs"],
                      node_count=len(graph.graph.node), providers=runtime.session.get_providers())
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--network")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = export(model_path=args.model, input_path=args.input, out=args.out, network=args.network)
    print(json.dumps({key: value for key, value in report.items() if key != "cases"}, indent=2))
    return int(report["status"] != "onnx-runtime-parity-passed")


if __name__ == "__main__":
    raise SystemExit(main())
