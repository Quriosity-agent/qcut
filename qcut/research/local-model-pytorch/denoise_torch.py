#!/usr/bin/env python3
"""Hash-pinned three-frame denoising graph, with private same-tensor evidence."""
import argparse
import hashlib
import json
import pathlib
import subprocess

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from container_scan import decode_graph, runtime_graph_table
from model_containers import bytenn_sections

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
SOURCE = pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingBasicVideo/current/Models/noise_reduction/nn_denoise.bytenn"
LIBRARY = pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current/Frameworks/libbytenn.dylib"
SOURCE_SHA256 = "3dfdbefcd5da99fde8b54b01c96ce58625b0feb2e2307b9b7bae71a5817b8a83"
FORMAT = "qcut-private-denoise-pytorch-v1"


class DenoiseGraph(nn.Module):
    def __init__(self, *, nodes, weights=None, align_corners=False):
        super().__init__()
        self.nodes = nodes
        self.align_corners = align_corners
        self.convs = nn.ModuleDict()
        if not isinstance(align_corners, bool):
            raise ValueError("invalid resize profile")
        if weights is not None and (weights.ndim != 1 or not np.isfinite(weights).all()):
            raise ValueError("invalid weights")
        self.input_shapes = {}
        channels, cursor = {}, 0
        for index, row in enumerate(nodes):
            op, name = row[:2]
            if op == "DataV2":
                if len(row) != 9 or row[6:] != ["4", "0", "0"]:
                    raise ValueError("unsupported input layout")
                n, h, w, c = map(int, row[2:6])
                if n != 1 or c != 3 or h % 16 or w % 16 or min(h, w) < 16 or max(h, w) > 1920:
                    raise ValueError("unsupported input shape")
                self.input_shapes[name] = (n, c, h, w)
                channels[name] = c
            elif op == "Concat":
                if len(row) != 9 or row[2] != "3" or row[-2:] != ["4", "0"]:
                    raise ValueError("unsupported concat")
                channels[row[6]] = sum(channels[v] for v in row[3:6])
            elif op == "Convolution":
                if len(row) != 19 or row[11:17] != ["4", "0"] * 3:
                    raise ValueError("unsupported convolution layout")
                co, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
                if not 1 <= co <= 32 or kh != 3 or kw != 3 or sh != sw or sh not in (1, 2) or ph != 1 or pw != 1 or bias != 1 or relu not in (0, 1):
                    raise ValueError("unsupported convolution parameters")
                ci = channels[row[17]]
                conv = nn.Conv2d(ci, co, 3, sh, 1)
                count = co * ci * 9
                if weights is not None:
                    values = weights[cursor:cursor + count + co]
                    if len(values) != count + co:
                        raise ValueError("truncated convolution weights")
                    with torch.no_grad():
                        conv.weight.copy_(torch.from_numpy(values[:count].copy()).reshape(co, 3, 3, ci).permute(0, 3, 1, 2))
                        conv.bias.copy_(torch.from_numpy(values[count:].copy()))
                cursor += count + co
                self.convs[str(index)] = conv
                channels[row[18]] = co
            elif op == "UpSampling":
                if len(row) != 5 or row[-1] != "BILINEAR":
                    raise ValueError("unsupported upsampling")
                channels[row[3]] = channels[row[2]]
            elif op == "Eltwise":
                if len(row) != 8 or row[5:] != ["4", "0", "0"] or channels[row[2]] != channels[row[3]]:
                    raise ValueError("unsupported residual addition")
                channels[row[4]] = channels[row[2]]
            else:
                raise ValueError(f"unsupported operation {op}")
        if set(self.input_shapes) != {"data0", "data1", "data2"} or len(set(self.input_shapes.values())) != 1:
            raise ValueError("expected three same-shape RGB inputs")
        if channels.get("Add_38") != 3:
            raise ValueError("missing RGB residual output")
        if weights is not None and len(weights) != cursor:
            raise ValueError(f"weight count mismatch: {cursor} vs {len(weights)}")
        self.parameter_count = cursor

    def forward(self, inputs):
        if set(inputs) != set(self.input_shapes):
            raise ValueError("all three temporal inputs required")
        values = dict(inputs)
        for name, shape in self.input_shapes.items():
            tensor = inputs[name]
            if tuple(tensor.shape) != shape or tensor.dtype != torch.float32 or not torch.isfinite(tensor).all():
                raise ValueError(f"invalid input {name}")
        for index, row in enumerate(self.nodes):
            op = row[0]
            if op == "Concat":
                values[row[6]] = torch.cat([values[k] for k in row[3:6]], dim=1)
            elif op == "Convolution":
                value = self.convs[str(index)](values[row[17]])
                values[row[18]] = value.relu() if row[10] == "1" else value
            elif op == "UpSampling":
                values[row[3]] = F.interpolate(values[row[2]], scale_factor=2, mode="bilinear", align_corners=self.align_corners)
            elif op == "Eltwise":
                values[row[4]] = values[row[2]] + values[row[3]]
        output = values["Add_38"]
        if not torch.isfinite(output).all():
            raise ValueError("nonfinite denoise output")
        return {"Add_38": output}


def load_model(*, path):
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    required = {"format", "source_sha256", "local_only", "nodes", "state_dict", "align_corners", "derived_input_shape", "original_input_shape"}
    if not isinstance(bundle, dict) or set(bundle) != required or bundle.get("format") != FORMAT or bundle.get("source_sha256") != SOURCE_SHA256 or bundle.get("local_only") is not True:
        raise ValueError("unsupported denoise bundle provenance")
    if bundle["original_input_shape"] != [1, 3, 1088, 1920] or len(bundle["nodes"]) != 28 or bundle["align_corners"] is not False:
        raise ValueError("invalid denoise graph metadata")
    model = DenoiseGraph(nodes=bundle["nodes"], align_corners=bundle["align_corners"])
    if model.parameter_count != 62779 or len(model.convs) != 15:
        raise ValueError("unexpected denoise architecture")
    expected_shape = bundle["derived_input_shape"] or bundle["original_input_shape"]
    if any(list(shape) != expected_shape for shape in model.input_shapes.values()):
        raise ValueError("input shape provenance mismatch")
    if any(not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or not torch.isfinite(value).all() for value in bundle["state_dict"].values()):
        raise ValueError("invalid model parameters")
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.eval()


def prepare(*, output, side):
    output = output.resolve()
    if not output.is_relative_to(PRIVATE.resolve()) or output == PRIVATE.resolve():
        raise ValueError("outputs must remain in private ignored directory")
    output.mkdir(parents=True, exist_ok=True)
    data = SOURCE.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError("unsupported denoise source hash")
    text, details = decode_graph(data=data, offset=0, table=runtime_graph_table(path=LIBRARY))
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    nodes = rows[1:]
    if details["input_count"] != 3 or details["layer_count"] != 25 or len(nodes) != 28:
        raise ValueError("unexpected denoise graph structure")
    if side:
        for row in nodes:
            if row[0] == "DataV2":
                row[3:5] = [str(side), str(side)]
    graph = "\n".join(" ".join(row) + "\\n" for row in [rows[0], *nodes]) + "\n"
    (output / "graph.private.txt").write_text(graph)
    section = bytenn_sections(data=data, offset=0)["sections"][1]
    arena = data[section["offset"]:section["offset"] + section["bytes"]]
    (output / "weights.private.bin").write_bytes(arena)
    weights = np.frombuffer(arena[:-4], dtype="<f4").copy()
    if not np.isfinite(weights).all():
        raise ValueError("nonfinite source weights")
    return nodes, weights


def read_descriptors(*, text, height, width):
    descriptors = {}
    for line in text.splitlines():
        fields = line.split("\t")
        if len(fields) != 7 or fields[0] in descriptors:
            raise ValueError("invalid native tensor descriptor")
        values = list(map(int, fields[1:]))
        if values[:4] != [1, width, height, 3] or any(value < -(2**31) or value >= 2**31 for value in values[4:]):
            raise ValueError("invalid native tensor dimensions or raw fields")
        descriptors[fields[0]] = {"dims_nwhc": values[:4], "raw_i32_at_24": values[4], "raw_i32_at_28": values[5]}
    if set(descriptors) != {"data0", "data1", "data2", "Add_38"}:
        raise ValueError("incomplete native tensor descriptors")
    return descriptors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=pathlib.Path, default=PRIVATE / "denoise")
    parser.add_argument("--side", type=int, default=64)
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("--original-shape", action="store_true")
    args = parser.parse_args()
    if args.side < 16 or args.side > 512 or args.side % 16:
        parser.error("research side must be a multiple of 16 from 16 through 512")
    torch.set_num_threads(4)
    nodes, weights = prepare(output=args.out, side=0 if args.original_shape else args.side)
    height, width = (1088, 1920) if args.original_shape else (args.side, args.side)
    output = args.out.resolve()
    if args.oracle:
        binary = output / "denoise-oracle"
        subprocess.run(["/Library/Developer/CommandLineTools/usr/bin/clang++", "-std=c++17", "-O2",
                        "-isysroot", "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
                        f"-Wl,-rpath,{LIBRARY.parent}",
                        str(pathlib.Path(__file__).with_name("denoise_oracle.mm")), "-o", str(binary)], check=True)
        subprocess.run([str(binary), "--self-test"], cwd=output, check=True)
        with (output / "oracle.log").open("w") as log:
            result = subprocess.run([str(binary), str(LIBRARY), str(output / "graph.private.txt"),
                                     str(output / "weights.private.bin"), str(output), str(height), str(width)],
                                    cwd=output, stdout=log, stderr=subprocess.STDOUT, timeout=90)
        if result.returncode:
            raise RuntimeError(f"native oracle failed {result.returncode}: {output / 'oracle.log'}")
    # The verified native resize profile is align_corners=False; load_model rejects anything else.
    model = DenoiseGraph(nodes=nodes, weights=weights, align_corners=False).eval()
    artifact = output / "candidate.pt"
    torch.save({"format": FORMAT, "source_sha256": SOURCE_SHA256, "local_only": True,
                "nodes": nodes, "state_dict": model.state_dict(), "align_corners": False,
                "original_input_shape": [1, 3, 1088, 1920],
                "derived_input_shape": None if args.original_shape else [1, 3, height, width]}, artifact)
    clone = load_model(path=artifact)
    state_equal = all(torch.equal(value, clone.state_dict()[name]) for name, value in model.state_dict().items())
    cases = []
    for directory in sorted(output.glob("case-*")):
        schema = json.loads((directory / "schema.json").read_text())
        if schema != {"layout": "NHWC", "storage_dtype": "float32", "native_trailing_fields": "uninterpreted", "shape": [1, height, width, 3], "native_dims_order": "NWHC", "inputs": ["data0", "data1", "data2"], "output": "Add_38"}:
            raise ValueError("native tensor schema mismatch")
        descriptors = read_descriptors(text=(directory / "tensor-descriptors.tsv").read_text(), height=height, width=width)
        def read(name):
            path = directory / f"{name}.f32"
            if path.stat().st_size != height * width * 3 * 4:
                raise ValueError("native tensor byte count mismatch")
            value = torch.from_numpy(np.fromfile(path, dtype="<f4").reshape(1, height, width, 3).transpose(0, 3, 1, 2).copy())
            if not torch.isfinite(value).all():
                raise ValueError("nonfinite native tensor")
            return value
        inputs = {name: read(name) for name in ("data0", "data1", "data2")}
        with torch.inference_mode():
            actual, restored = model(inputs)["Add_38"], clone(inputs)["Add_38"]
        expected = read("Add_38")
        delta = (actual - expected).abs()
        input_equal = all(torch.equal(read("observed-" + name), value) for name, value in inputs.items())
        cases.append({"case": directory.name, "max_abs": delta.max().item(), "mae": delta.mean().item(), "native_input_exact": input_equal,
                      "native_descriptors": descriptors, "roundtrip": torch.equal(actual, restored), "passed": bool(torch.isfinite(actual).all() and delta.max() <= 1e-4)})
    report = {"format": FORMAT, "source_sha256": SOURCE_SHA256, "artifact": str(artifact),
              "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(), "parameters": model.parameter_count,
              "nodes": len(nodes), "state_dict_equal": state_equal, "native_graph_input_resized": not args.original_shape, "research_shape": [height, width],
              "original_input_shape": [1, 3, 1088, 1920], "align_corners": args.align_corners, "cases": cases,
              "status": ("native-parity-passed" if args.original_shape else "limited-derived-shape-parity-passed") if state_equal and cases and all(c["passed"] and c["roundtrip"] and c["native_input_exact"] for c in cases) else "native-unverified-or-failed"}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return int(report["status"] == "native-unverified-or-failed")


if __name__ == "__main__":
    raise SystemExit(main())
