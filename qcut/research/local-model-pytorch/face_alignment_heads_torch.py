"""Independent FsNew 120/160 networks with the measured nine-operator float tail.

The integer executor remains integer-only. No native calls occur during inference;
weights are decoded once into buffers and remain private derived model assets.
"""
from pathlib import Path

import torch
from torch import nn

from espresso_fixed import decode_bias, decode_kernel
from espresso_graph import analyze
from espresso_integer_torch import EspressoIntegerGraph


TAIL_OPS = ("PoolingDown", "OnnxOp1", "InnerProduct", "InnerProduct", "Sigmoid",
            "InnerProduct", "Softmax", "InnerProduct", "InnerProduct")
TAIL_CHANNELS = (128, 128, 212, 106, 106, None, None, 1, 1)


def alignment_tail(*, graph):
    layers = graph["layers"]
    boundary = next((index for index, layer in enumerate(layers)
                     if any(graph["descriptors"][name]["type"] == 4 for name in layer["outputs"])), None)
    if boundary is None or boundary < 2:
        raise ValueError("alignment requires an integer backbone and explicit floating tail")
    tail = layers[boundary:]
    if tuple(layer["op"] for layer in tail) != TAIL_OPS:
        raise ValueError("unsupported alignment floating operator sequence")
    inputs = [layer for layer in layers if layer["op"] == "Input"]
    if len(inputs) != 1:
        raise ValueError("one alignment image input required")
    source = inputs[0]
    size = source["shape"][1]
    if (size not in (120, 160) or source["shape"] != (1, size, size, 3)
            or source["storage"] != {"type": 2 if size == 120 else 1, "fraction": 6}):
        raise ValueError("unsupported alignment image profile")
    prefix = layers[boundary - 1]
    if len(prefix["outputs"]) != 1 or tail[0]["inputs"] != prefix["outputs"]:
        raise ValueError("floating tail must follow the single integer backbone output")
    name = prefix["outputs"][0]
    feature_size = 4 if size == 120 else 5
    if (graph["shapes"][name] != (1, feature_size, feature_size, 128)
            or graph["descriptors"][name] != {"type": 2 if size == 120 else 1, "fraction": 7 if size == 120 else 2}):
        raise ValueError("unsupported alignment backbone output profile")
    names = [layer["outputs"][0] for layer in tail if len(layer["outputs"]) == 1]
    if len(names) != 9 or len(set(names)) != 9:
        raise ValueError("nine unique floating outputs required")
    parents = (name, names[0], names[1], names[1], names[3], names[1], names[5], names[1], names[1])
    for index, (layer, parent, channels) in enumerate(zip(tail, parents, TAIL_CHANNELS, strict=True)):
        channels = channels if channels is not None else (3 if size == 120 else 5)
        output = layer["outputs"][0]
        if (layer["inputs"] != [parent] or graph["shapes"][output] != (1, 1, 1, channels)
                or graph["descriptors"][output] != {"type": 4, "fraction": 0}):
            raise ValueError(f"unsupported alignment tail shape, wiring or storage at {index}")
        if layer["op"] == "InnerProduct" and (
                layer["weight"] != {"type": 4, "fraction": 0}
                or layer["bias_storage"] != {"type": 4, "fraction": 0}
                or not layer["bias"] or layer["relu"] or layer["packed"]):
            raise ValueError("only measured float32 dense heads with bias are supported")
    pool, reshape = tail[:2]
    if pool["mode"] != "AVE" or not pool["is_global"] or pool["pad"] != (0, 0):
        raise ValueError("only unpadded global average alignment pooling is supported")
    if reshape["dims"] != (1, 1, 1, 128) or reshape["params"] != ["2"]:
        raise ValueError("only the measured pooled alignment vector reshape is supported")
    return name, tail


def global_average_float(*, value, fraction):
    if value.dtype != torch.int64 or value.ndim != 4 or type(fraction) is not int or not 0 <= fraction <= 31:
        raise ValueError("global average requires integer NHWC and bounded fraction")
    height, width = value.shape[1:3]
    if not torch.jit.is_tracing() and (height < 1 or width < 1):
        raise ValueError("nonempty global average input required")
    # The 5x5 kernel multiplies by a rounded reciprocal; true division differs.
    scale = 1 / (height * width * 2 ** fraction)
    return value.sum(dim=(1, 2), keepdim=True).to(torch.float32) * scale


def stable_sigmoid(*, value):
    # Avoid cancellation observed for tiny probabilities in ORT's Sigmoid kernel.
    exponent = torch.exp(-torch.abs(value))
    denominator = 1 + exponent
    return torch.where(value >= 0, 1 / denominator, exponent / denominator)


class FloatDense(nn.Module):
    def __init__(self, *, layer, arena, channels):
        super().__init__()
        count = layer["shape"][3]
        weights, cursor = decode_kernel(arena, layer["arena_offset"], count * channels, layer["weight"], False)
        bias = decode_bias(arena, cursor, count, True)
        weight_tensor = torch.from_numpy(weights.reshape(count, channels).astype("float32").copy())
        bias_tensor = torch.from_numpy(bias.astype("float32").copy())
        if not torch.isfinite(weight_tensor).all() or not torch.isfinite(bias_tensor).all():
            raise ValueError("nonfinite alignment dense weights or bias")
        self.register_buffer("weight", weight_tensor)
        self.register_buffer("bias", bias_tensor)

    def forward(self, value):
        result = value.reshape(value.shape[0], -1) @ self.weight.T + self.bias
        return result.reshape(value.shape[0], 1, 1, self.weight.shape[0])


class EspressoAlignmentGraph(nn.Module):
    def __init__(self, *, text, arena, output_names=None, input_shapes=None, prefix_output=None):
        super().__init__()
        if prefix_output is not None:
            raise ValueError("alignment export requires the complete floating tail")
        graph = analyze(text)
        prefix, tail = alignment_tail(graph=graph)
        if input_shapes is not None and input_shapes != {
                layer["name"]: tuple(layer["shape"]) for layer in graph["layers"] if layer["op"] == "Input"}:
            raise ValueError("alignment input profile cannot change")
        self.backbone = EspressoIntegerGraph(text=text, arena=arena, prefix_output=prefix)
        self.graph = self.backbone.graph
        self.execution_layers = self.graph["layers"]
        self.input_names, self.input_shapes = self.backbone.input_names, self.backbone.input_shapes
        self.prefix, self.tail = prefix, tail
        produced = [name for layer in self.execution_layers if layer["op"] != "Input" for name in layer["outputs"]]
        consumed = {name for layer in self.execution_layers for name in layer["inputs"]}
        self.output_names = tuple(output_names) if output_names is not None else tuple(name for name in produced if name not in consumed)
        if (not self.output_names or len(set(self.output_names)) != len(self.output_names)
                or not set(self.output_names) <= set(produced)):
            raise ValueError("expected unique existing alignment output names")
        self.dense = nn.ModuleDict({str(index): FloatDense(layer=layer, arena=arena, channels=128)
                                   for index, layer in enumerate(tail) if layer["op"] == "InnerProduct"})

    def _execute(self, *, inputs):
        blobs = self.backbone._execute(inputs=inputs)
        for index, layer in enumerate(self.tail):
            value = blobs[layer["inputs"][0]]
            op = layer["op"]
            if op == "PoolingDown":
                result = global_average_float(value=value, fraction=self.graph["descriptors"][self.prefix]["fraction"])
            elif op == "OnnxOp1":
                result = value.reshape(layer["dims"])
            elif op == "InnerProduct":
                result = self.dense[str(index)](value)
            elif op == "Sigmoid":
                result = stable_sigmoid(value=value)
            else:
                # These heads have one spatial pixel, so the native scalar tail
                # uses true division, not the four-pixel FRECPE path.
                shifted = value - value.amax(dim=-1, keepdim=True)
                exponent = torch.exp(shifted)
                result = exponent / exponent.sum(dim=-1, keepdim=True)
            blobs[layer["outputs"][0]] = result
        return blobs

    def forward(self, *inputs):
        blobs = self._execute(inputs=inputs)
        return tuple(blobs[name] for name in self.output_names)

    def intermediate(self, *, inputs):
        return self._execute(inputs=tuple(inputs[name] for name in self.input_names))


def load(*, directory, output_names=None, input_shapes=None, prefix_output=None):
    directory = Path(directory)
    return EspressoAlignmentGraph(text=(directory / "graph.txt").read_text(), arena=(directory / "arena.bin").read_bytes(),
                                  output_names=output_names, input_shapes=input_shapes, prefix_output=prefix_output).eval()
