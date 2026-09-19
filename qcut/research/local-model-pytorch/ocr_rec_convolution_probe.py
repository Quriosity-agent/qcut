"""Local accumulation experiments on frozen native tensors; never parity evidence."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from ocr_export import compare, fresh_directory, read_native
from ocr_rec_diagnose import load_for_diagnosis


def accumulated(*, value, layer, lanes, bias_first, fused, order):
    limit = min(8, layer.out_channels)
    patches = F.unfold(value, layer.kernel_size, padding=layer.padding, stride=layer.stride)
    weights = layer.weight[:limit].flatten(1)
    if order == "hwc":
        patches = patches.reshape(value.shape[0], layer.in_channels, -1, patches.shape[-1]).transpose(1, 2).flatten(1, 2)
        weights = layer.weight[:limit].permute(0, 2, 3, 1).reshape(limit, -1)
    accumulators = [torch.zeros(value.shape[0], limit, patches.shape[-1]) for _ in range(lanes)]
    if bias_first:
        accumulators[0] += layer.bias[:limit, None]
    for index in range(weights.shape[1]):
        left, right = patches[:, index, None], weights[None, :, index, None]
        previous = accumulators[index % lanes]
        accumulators[index % lanes] = ((left.double() * right.double()) + previous.double()).float() if fused else previous + left * right
    total = accumulators[0]
    for value in accumulators[1:]:
        total = total + value
    if not bias_first:
        total += layer.bias[:limit, None]
    return total


def probe(*, source, out):
    out = fresh_directory(path=out)
    report = json.loads((source / "report.json").read_text())
    model = load_for_diagnosis(report=report)
    names = [step["output"] for step in model.steps[1:]]
    result = []
    for case in report["cases"]:
        directory = source / f"case-{case['case']}"
        native, _ = read_native(directory=directory, names=names)
        native["data"] = torch.from_numpy(np.load(directory / "inputs.npz")["data"])
        for index, step in enumerate(model.steps):
            if step["kind"] != "Convolution" or step["output"] not in {
                "backbone.first_conv.conv", "down_channels", "conv1d.conv1d", "embedding"}:
                continue
            layer = model.layers[str(index)]
            value = native[step["inputs"][0]]
            expected = native[step["output"]][:, :8].flatten(2)
            modes = {}
            for order in ("chw", "hwc"):
                for lanes in (1, 2, 4, 8):
                    for bias_first in (True, False):
                        for fused in (True, False):
                            actual = accumulated(value=value, layer=layer, lanes=lanes, bias_first=bias_first, fused=fused, order=order)
                            if step["config"]["activation"] == 1:
                                actual = actual.relu()
                            key = f"{order}-{lanes}-{'bias-first' if bias_first else 'bias-last'}-{'fused' if fused else 'separate'}"
                            modes[key] = {**compare(actual=actual, expected=expected), "equal": int((actual == expected).sum())}
            result.append({"case": case["case"], "blob": step["output"], "elements": expected.numel(), "modes": modes})
            best = sorted(modes.items(), key=lambda x: x[1]["mae"])[:5]
            print(json.dumps({"blob": step["output"], "elements": expected.numel(), "best": best}), flush=True)
    (out / "report.json").write_text(json.dumps(result, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    with torch.inference_mode():
        probe(source=args.source.resolve(), out=args.out)


if __name__ == "__main__":
    main()
