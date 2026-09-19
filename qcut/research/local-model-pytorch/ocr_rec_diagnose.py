"""Compare numerical experiments with frozen complete native outputs, privately."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from ocr_export import compare, fresh_directory, read_native, sha
from ocr_rec_torch import CANDIDATE_PROFILE, FAILED_FORMAT, ORDERED_FAILED_FORMAT, load_candidate_model, load_validated_model


def load_for_diagnosis(*, report):
    if report["format"] in (FAILED_FORMAT, ORDERED_FAILED_FORMAT):
        return load_candidate_model(path=report["artifact"], expected_sha256=report["artifact_sha256"],
                                    allow_unverified=True, ordered=report["format"] == ORDERED_FAILED_FORMAT)
    return load_validated_model(path=report["artifact"], expected_sha256=report["artifact_sha256"])


class DiagnosticConvolution(nn.Module):
    def __init__(self, *, layer, precision):
        super().__init__()
        self.layer = layer
        self.precision = precision

    def forward(self, value):
        layer = self.layer
        if self.precision == "ordered":
            from ocr_rec_numeric import ordered_convolution
            return ordered_convolution(value=value, weight=layer.weight, bias=layer.bias,
                                       stride=layer.stride, padding=layer.padding, groups=layer.groups)
        if self.precision == "double":
            return F.conv2d(value.double(), layer.weight.double(), layer.bias.double(),
                            layer.stride, layer.padding, layer.dilation, layer.groups).float()
        return F.conv2d(value.contiguous(memory_format=torch.channels_last),
                        layer.weight.contiguous(memory_format=torch.channels_last), layer.bias,
                        layer.stride, layer.padding, layer.dilation, layer.groups)


class PolynomialSigmoid(nn.Module):
    def forward(self, value):
        from tracking_numeric import exp_estimate
        return 1 / (1 + exp_estimate(value=-value))


def diagnose(*, source, out, polynomial=False, ordered=False, ordered_conv=False):
    out = fresh_directory(path=out)
    report = json.loads((source / "report.json").read_text())
    models = {}
    for mode in (("ordered",) if ordered_conv else ("baseline", "double", "channels-last")):
        from ocr_rec_numeric import SpatialSum
        model = load_for_diagnosis(report=report)
        model.execution_profile = CANDIDATE_PROFILE
        model.reduction = SpatialSum()
        if mode != "baseline":
            for name, layer in list(model.layers.items()):
                model.layers[name] = DiagnosticConvolution(layer=layer, precision=mode)
        if polynomial:
            model.sigmoid = PolynomialSigmoid()
        if ordered:
            model.reduction = SpatialSum(ordered=True)
        models[mode] = model
    cases = []
    for case in report["cases"]:
        directory = source / f"case-{case['case']}"
        with np.load(directory / "inputs.npz", allow_pickle=False) as data:
            inputs = {key: torch.from_numpy(data[key]) for key in data.files}
        with np.load(directory / "native-outputs.npz", allow_pickle=False) as data:
            native = {key: torch.from_numpy(data[key]) for key in data.files}
        result = {"case": case["case"], "modes": {}}
        for mode, model in models.items():
            with torch.inference_mode():
                outputs = model(inputs)
            result["modes"][mode] = {key: compare(actual=value, expected=native[key]) for key, value in outputs.items()}
            for key, value in outputs.items():
                native_value = native[key]
                metrics = result["modes"][mode][key]
                metrics["outside_tolerance"] = int(((value - native_value).abs() > 1e-4 + 1e-4 * native_value.abs()).sum())
        cases.append(result)
        print(json.dumps(result), flush=True)
    result = {"source_report": str(source / "report.json"), "source_report_sha256": sha(data=(source / "report.json").read_bytes()),
              "scope": "diagnostic only; frozen full native logits, not fresh native runs", "cases": cases}
    (out / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def inspect_sigmoids(*, source, out):
    from tracking_numeric import exp_estimate, reciprocal_estimate

    out = fresh_directory(path=out)
    report = json.loads((source / "report.json").read_text())
    model = load_for_diagnosis(report=report)
    names = [step["output"] for step in model.steps[1:]]
    result = []
    for case in report["cases"]:
        native, _ = read_native(directory=source / f"case-{case['case']}", names=names)
        for step in model.steps:
            if step["kind"] != "Sigmoid":
                continue
            value, expected = native[step["inputs"][0]], native[step["output"]]
            denominator = 1 + exp_estimate(value=-value)
            reciprocal = reciprocal_estimate(value=denominator)
            refined = reciprocal * (2 - denominator * reciprocal)
            twice = refined * (2 - denominator * refined)
            fused_refined = reciprocal * (2 - denominator.double() * reciprocal.double()).float()
            fused_twice = fused_refined * (2 - denominator.double() * fused_refined.double()).float()
            metrics = {}
            for name, actual in {"torch": value.sigmoid(), "poly-exp-div": 1 / denominator,
                                 "poly-exp-estimate": reciprocal, "poly-exp-refined": refined,
                                 "poly-exp-twice": twice, "poly-exp-fused-twice": fused_twice}.items():
                metrics[name] = {**compare(actual=actual, expected=expected), "equal": int((actual == expected).sum())}
            result.append({"case": case["case"], "blob": step["output"], "elements": expected.numel(), "modes": metrics})
    (out / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


def inspect_reductions(*, source, out):
    out = fresh_directory(path=out)
    report = json.loads((source / "report.json").read_text())
    model = load_for_diagnosis(report=report)
    names = [step["output"] for step in model.steps[1:]]
    result = []
    for case in report["cases"]:
        native, _ = read_native(directory=source / f"case-{case['case']}", names=names)
        for step in model.steps:
            if step["kind"] != "OnnxOp1":
                continue
            value, expected = native[step["inputs"][0]], native[step["output"]]
            modes = {"torch": value.sum(dim=(2, 3), keepdim=True),
                     "double": value.double().sum(dim=(2, 3), keepdim=True).float()}
            array = value.numpy().reshape(value.shape[0], value.shape[1], -1)
            modes["sequential"] = torch.from_numpy(array.cumsum(axis=-1)[..., -1].copy()).reshape_as(expected)
            for lanes in (2, 4, 8):
                partial = np.zeros((*array.shape[:2], lanes), dtype=np.float32)
                for index in range(array.shape[-1]):
                    partial[..., index % lanes] += array[..., index]
                modes[f"lanes-{lanes}"] = torch.from_numpy(partial.sum(axis=-1)).reshape_as(expected)
            result.append({"case": case["case"], "blob": step["output"], "elements": expected.numel(),
                           "modes": {name: {**compare(actual=actual, expected=expected), "equal": int((actual == expected).sum())}
                                     for name, actual in modes.items()}})
    (out / "report.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps([{k: v for k, v in entry.items() if k != "modes"} | {
        "modes": {name: [metrics["max_abs"], metrics["equal"]] for name, metrics in entry["modes"].items()}}
        for entry in result], indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sigmoids", action="store_true")
    parser.add_argument("--polynomial", action="store_true")
    parser.add_argument("--reductions", action="store_true")
    parser.add_argument("--ordered", action="store_true")
    parser.add_argument("--ordered-conv", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    if args.reductions:
        inspect_reductions(source=args.source.resolve(), out=args.out)
    elif args.sigmoids:
        inspect_sigmoids(source=args.source.resolve(), out=args.out)
    else:
        diagnose(source=args.source.resolve(), out=args.out, polynomial=args.polynomial,
                 ordered=args.ordered, ordered_conv=args.ordered_conv)


if __name__ == "__main__":
    main()
