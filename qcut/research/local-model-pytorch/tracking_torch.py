"""Vendor-independent CPU modules for four hash-pinned private tracking graphs."""
import hashlib
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

from tracking_graph import compile_graph
from tracking_numeric import pair_softmax

FORMAT = "qcut-private-tracking-pytorch-v1"
SOURCE_SHA256 = "7951eba5af0daa1f78e3962073b938169171d102107ed1585a5c6851adf3aab2"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"
NETWORKS = {
    "kernel": {"offset": 172603, "layers": 16, "graph_sha256": "d11c1e3db368d25206d62d88a423ef41144251d4aff240a7cebf1327d365cb81"},
    "search": {"offset": 361769, "layers": 14, "graph_sha256": "c61cff66d3a39844874c914598d5df6aa0a377cd3c5f32567a94ef6152863e9d"},
    "head": {"offset": 550852, "layers": 35, "graph_sha256": "3d61c85268fcaac2fdd77178fe1b3dc075d42f0f8b0366bb283cfbaffdc663bb"},
    "backbone": {"offset": 62922, "layers": 82, "graph_sha256": "bf267cecae6dcfc3dc17bc037ccc20e6539fd2cf8baeb891d437a739a9b2d784"},
}


def requantize(*, value, shift):
    if not -24 <= shift <= 30:
        raise ValueError("unsupported quantization shift")
    value = value.to(torch.int64)
    if shift > 0:
        return (value + (1 << (shift - 1))) >> shift
    return value << -shift


def saturate(*, value):
    return value.clamp(-2047, 2047).to(torch.int16)


class TrackingGraph(nn.Module):
    def __init__(self, *, text, arena=None):
        super().__init__()
        self.graph, state = compile_graph(text=text, arena=arena)
        self.input_schema = self.graph["input_schema"]
        self.output_schema = self.graph["output_schema"]
        self.tensors = nn.Module()
        for name, value in state.items():
            self.tensors.register_buffer(name.removeprefix("tensors."), value)

    def forward(self, inputs):
        if not isinstance(inputs, dict) or set(inputs) != set(self.input_schema):
            raise ValueError("exactly the declared tracking input is required")
        for name, spec in self.input_schema.items():
            value = inputs[name]
            dtype = torch.int16 if self.graph["fixed"] else torch.float32
            if (not isinstance(value, torch.Tensor) or value.device.type != "cpu" or value.dtype != dtype
                    or list(value.shape) != spec["shape"] or not torch.isfinite(value).all()):
                raise ValueError(f"expected finite CPU {spec['dtype']} NCHW input {spec['shape']}")
            if self.graph["fixed"] and ((value < -2047).any() or (value > 2047).any()):
                raise ValueError("fixed-point input must lie within the signed 12-bit profile [-2047,2047]")
        values = dict(inputs)
        for node in self.graph["nodes"]:
            self._execute(node=node, values=values)
        outputs = {name: values[name] for name in self.output_schema}
        for name, value in outputs.items():
            if list(value.shape) != self.output_schema[name]["shape"] or not torch.isfinite(value).all():
                raise ValueError("invalid tracking output")
        return outputs

    def _execute(self, *, node, values):
        op, key = node["op"], node["key"]
        if op == "DataV2":
            return
        if op in {"Convolution", "DepthwiseSeparableConvolution"}:
            source = values[node["source"]]
            weight, bias = getattr(self.tensors, f"w{key}"), getattr(self.tensors, f"b{key}")
            if self.graph["fixed"]:
                # Float64 convolution exactly accumulates the bounded integer products.
                value = F.conv2d(source.double(), weight.double(), bias.double(), stride=node["stride"],
                                 padding=node["pad"], groups=node["groups"]).to(torch.int64)
                value = (value + 2 ** 31).remainder(2 ** 32) - 2 ** 31
                value = requantize(value=value, shift=node["shift"])
                if node["relu"]:
                    value = value.clamp_min(0)
                value = saturate(value=value)
            else:
                value = F.conv2d(source, weight, bias, stride=node["stride"], padding=node["pad"], groups=node["groups"])
                if node["relu"]:
                    value = value.relu()
        elif op == "Crop":
            x, y, c, w, h, co = node["crop"]
            value = values[node["source"]][:, c:c + co, y:y + h, x:x + w]
        elif op in {"Concat", "Eltwise"}:
            operands = [values[name] for name in node["sources"]]
            if self.graph["fixed"]:
                if op == "Eltwise":
                    common = max(0, *node["shifts"])
                    operands = [value.to(torch.int64) << (common - shift) for value, shift in zip(operands, node["shifts"])]
                    value = requantize(value=operands[0] + operands[1], shift=common)
                else:
                    value = torch.cat([requantize(value=value, shift=shift) for value, shift in zip(operands, node["shifts"])], dim=1)
            else:
                value = torch.cat(operands, dim=1) if op == "Concat" else operands[0] + operands[1]
            if self.graph["fixed"]:
                value = saturate(value=value)
        elif op == "Slice":
            for name, value in zip(node["outputs"], torch.split(values[node["source"]], node["sizes"], dim=1)):
                values[name] = value
            return
        elif op == "Constant":
            value = getattr(self.tensors, f"c{key}")
        elif op == "OnnxOp2":
            a, b = (values[name] for name in node["sources"])
            value = a + b if node["mode"] == "Sum" else a / b
        elif op == "OnnxOp1":
            n, c, h, w = node["target"]
            value = values[node["source"]].reshape(n, c, h, w)
        elif op == "Transpose":
            nhwc = values[node["source"]].permute(0, 2, 3, 1)
            value = nhwc.permute(1, 3, 0, 2).permute(0, 3, 1, 2)
        elif op == "Softmax":
            value = pair_softmax(value=values[node["source"]])
        else:
            raise ValueError(f"unsupported tracking operation: {op}")
        values[node["output"]] = value


def load_models(*, path, expected_sha256=None):
    path = Path(path)
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("oversized tracking bundle")
    if expected_sha256 is not None and hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("tracking artifact SHA mismatch")
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    if (not isinstance(bundle, dict) or bundle.get("format") != FORMAT or bundle.get("source_sha256") != SOURCE_SHA256
            or bundle.get("runtime_sha256") != RUNTIME_SHA256 or bundle.get("local_only") is not True
            or not isinstance(bundle.get("networks"), dict) or set(bundle["networks"]) != set(NETWORKS)):
        raise ValueError("invalid tracking bundle provenance or missing subnetwork")
    models = {}
    for name, info in NETWORKS.items():
        item = bundle["networks"][name]
        text = item["graph"]
        if (not isinstance(text, str) or hashlib.sha256(text.encode()).hexdigest() != info["graph_sha256"]
                or item.get("network_id") != f"bm-offset-{info['offset']:08x}"):
            raise ValueError("tracking graph hash or identity mismatch")
        model = TrackingGraph(text=text)
        state, expected = item["state_dict"], model.state_dict()
        if not isinstance(state, dict) or set(state) != set(expected):
            raise ValueError("tracking state keys mismatch")
        for key, value in state.items():
            if (not isinstance(value, torch.Tensor) or value.dtype != expected[key].dtype
                    or value.shape != expected[key].shape or not torch.isfinite(value).all()):
                raise ValueError("invalid tracking state tensor")
        model.load_state_dict(state, strict=True)
        models[name] = model.cpu().eval()
    return models


def load_model(*, path, name, expected_sha256=None):
    if name not in NETWORKS:
        raise ValueError(f"unknown tracking subnetwork: {name}")
    return load_models(path=path, expected_sha256=expected_sha256)[name]
