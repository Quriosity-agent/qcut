"""Full-shape local arithmetic on retained native traces, without promotion."""
import argparse
import json
from pathlib import Path

import torch
from torch.nn import functional as F

from matting_cpu_boundary import metrics
from matting_cpu_export import digest, fresh_directory, read_tensor
from matting_phase5_numeric import four_lane_pointwise, ordered_convolution, ordered_tanh, ordered_upsample, pinned_sigmoid, pinned_tanh
from matting_torch import CPU_RUNTIME_SHA256, INPUT_SHAPES, SOURCE_SHA256, load_model


def load_trace(*, trace: Path) -> tuple[dict[str, torch.Tensor], dict[str, object]]:
    report = json.loads((trace / "report.json").read_text())
    if (report["native"]["status"] != "completed" or report["native"]["forward_type"] != 0
            or report["native"]["runtime_sha256"] != CPU_RUNTIME_SHA256
            or report["source_sha256"] != SOURCE_SHA256):
        raise ValueError("pinned completed CPU trace required")
    directory = trace / "case-000-trace"
    shapes = {}
    for line in (trace / "outputs.tsv").read_text().splitlines():
        name, n, w, h, c = line.split("\t")
        shapes[name] = (int(n), int(c), int(h), int(w))
    values = {name: read_tensor(path=directory / f"out-{name}.f32", shape=shape) for name, shape in shapes.items()}
    values.update({name: read_tensor(path=directory / f"in-{name}.f32", shape=shape) for name, shape in INPUT_SHAPES.items()})
    return values, report


def probe(*, run: Path, trace: Path, out: Path) -> dict[str, object]:
    native, source = load_trace(trace=trace)
    model = load_model(path=run / "matting-gru.pt", expected_sha256=source["artifact_sha256"], allow_unverified=True)
    out = fresh_directory(path=out)
    rows = []
    with torch.inference_mode():
        for index, row in enumerate(model.nodes):
            op = row[0]
            variants = {}
            if op in {"Convolution", "DepthwiseSeparableConvolution"}:
                conv, value, target = model.convs[str(index)], native[row[17]], row[18]
                variants["ordered-default"] = ordered_convolution(value=value, conv=conv)
                if conv.out_channels == 2:
                    variants["four-lane-pointwise"] = four_lane_pointwise(value=value, conv=conv)
                if not metrics(actual=variants["ordered-default"], expected=native[target])["bitwise_equal"]:
                    first = conv.groups == conv.in_channels == conv.out_channels or conv.kernel_size != (1, 1)
                    variants["ordered-opposite-bias"] = ordered_convolution(value=value, conv=conv, bias_first=not first)
                if row[10] == "1":
                    variants = {name: F.relu(value) for name, value in variants.items()}
                    variants["ordered-positive-zero"] = torch.where(variants["ordered-default"] > 0, variants["ordered-default"], 0.)
            elif op in {"Sigmoid", "Tanh", "UpSampling"}:
                value, target = native[row[2]], row[3]
                if op == "Sigmoid":
                    variants = {"refined-exp": pinned_sigmoid(value=value)}
                elif op == "Tanh":
                    variants = {name: pinned_tanh(value=value, formulation=name) for name in ("sigmoid", "ratio")}
                    variants["fused-tail"] = ordered_tanh(value=value)
                else:
                    variants = {name: ordered_upsample(value=value, formulation=name) for name in ("sum", "fma", "separable", "pinned")}
            else:
                continue
            base = model.evaluate_node(index=index, values=native)[target]
            results = {name: metrics(actual=value, expected=native[target]) for name, value in variants.items()}
            record = {"index": index, "operation": op, "tensor": target,
                      "baseline": metrics(actual=base, expected=native[target]), "variants": results}
            rows.append(record)
            print(json.dumps({"index": index, "tensor": target,
                              "bitwise": [key for key, val in results.items() if val["bitwise_equal"]],
                              "best_max_abs": min(val["max_abs"] for val in results.values())}), flush=True)
    report = {"status": "diagnostic-only", "new_verified_networks": 0,
              "scope": "frozen Phase4 native inputs at each full-shape layer; no new native inference",
              "source_sha256": SOURCE_SHA256, "runtime_sha256": CPU_RUNTIME_SHA256,
              "artifact_sha256": source["artifact_sha256"], "trace": str(trace.resolve()),
              "trace_report_sha256": digest(data=(trace / "report.json").read_bytes()),
              "rows": rows, "tolerances": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("run", "trace", "out"):
        parser.add_argument(f"--{flag}", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    probe(run=args.run, trace=args.trace, out=args.out)


if __name__ == "__main__":
    main()
