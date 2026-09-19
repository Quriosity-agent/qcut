"""Exact integer tracking export without unsupported ORT float64 Conv kernels."""
import torch
from torch.nn import functional as F

from tracking_torch import TrackingGraph, saturate


class ONNXTrackingHead(TrackingGraph):
    def __init__(self, *, original):
        torch.nn.Module.__init__(self)
        if original.graph["fixed"]:
            raise ValueError("floating head adapter cannot accept fixed-point networks")
        self.graph = original.graph
        self.input_schema, self.output_schema = original.input_schema, original.output_schema
        self.tensors = original.tensors

    def _execute(self, *, node, values):
        if node["op"] == "Softmax":
            from onnx_numeric import pair_softmax
            values[node["output"]] = pair_softmax(value=values[node["source"]])
            return
        super()._execute(node=node, values=values)


def quantize(*, value, shift):
    if shift > 0:
        return torch.floor((value.double() + (1 << (shift - 1))) / (1 << shift)).to(torch.int64)
    return value.to(torch.int64) * (1 << -shift)


class ONNXTrackingFixed(TrackingGraph):
    def __init__(self, *, original):
        torch.nn.Module.__init__(self)
        if not original.graph["fixed"]:
            raise ValueError("ONNX integer adapter requires a fixed-point subnetwork")
        self.graph = original.graph
        self.input_schema, self.output_schema = original.input_schema, original.output_schema
        self.tensors = original.tensors

    def _execute(self, *, node, values):
        op = node["op"]
        if op in {"Convolution", "DepthwiseSeparableConvolution"}:
            source = values[node["source"]].double()
            key = node["key"]
            weight, bias = getattr(self.tensors, f"w{key}"), getattr(self.tensors, f"b{key}")
            kh, kw = weight.shape[2:]
            groups = node["groups"]
            patches = F.unfold(source, (kh, kw), padding=node["pad"], stride=node["stride"])
            patches = patches.reshape(source.shape[0], groups, -1, patches.shape[-1])
            kernel = weight.double().reshape(groups, weight.shape[0] // groups, -1)
            accum = torch.matmul(kernel.unsqueeze(0), patches).reshape(source.shape[0], weight.shape[0], -1)
            accum = accum + bias.double().reshape(1, -1, 1)
            height = (source.shape[2] + 2 * node["pad"] - kh) // node["stride"] + 1
            width = (source.shape[3] + 2 * node["pad"] - kw) // node["stride"] + 1
            value = accum.reshape(source.shape[0], weight.shape[0], height, width).to(torch.int64)
            value = (value + 2 ** 31).remainder(2 ** 32) - 2 ** 31
            value = quantize(value=value, shift=node["shift"])
            if node["relu"]:
                value = value.clamp_min(0)
            values[node["output"]] = saturate(value=value)
            return
        if op in {"Concat", "Eltwise"}:
            operands = [values[name] for name in node["sources"]]
            if op == "Concat":
                value = torch.cat([quantize(value=value, shift=shift) for value, shift in zip(operands, node["shifts"], strict=True)], dim=1)
            else:
                common = max(0, *node["shifts"])
                operands = [value.to(torch.int64) * (1 << (common - shift)) for value, shift in zip(operands, node["shifts"], strict=True)]
                value = quantize(value=operands[0] + operands[1], shift=common)
            values[node["output"]] = saturate(value=value)
            return
        super()._execute(node=node, values=values)
