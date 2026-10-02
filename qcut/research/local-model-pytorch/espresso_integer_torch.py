"""Integer-only PyTorch replay of espresso graphs or explicit prefixes, in NHWC order.

Weights are buffers, not an invitation to train through integer rounding. Unsupported
operators fail closed; floating heads and the hardware reciprocal estimate are not
silently replaced by ordinary floating-point layers.
"""
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

from espresso_fixed import RANGE, decode_bias, decode_kernel
from espresso_graph import analyze

CONVOLUTIONS = {"Convolution", "DepthwiseSeparableConvolution", "DilationSeparableConvolution"}
SUPPORTED = CONVOLUTIONS | {"Input", "Eltwise", "Concat", "Slice", "UpSampling", "Shuffle", "ShuffleNet"}


def requantize(*, value, shift):
    if shift <= 0:
        return value * (1 << -shift)
    return torch.div(value + (1 << (shift - 1)), 1 << shift, rounding_mode="floor")


def wrap32(*, value):
    return torch.remainder(value + (1 << 31), 1 << 32) - (1 << 31)


def rescale(*, value, source, target):
    low, high = RANGE[target["type"]]
    return requantize(value=value, shift=source["fraction"] - target["fraction"]).clamp(low, high)


def upsample_x2(*, value):
    n, h, w, c = value.shape
    padded = F.pad(value, (0, 0, 1, 1, 1, 1))
    main = padded[:, 1:h + 1, 1:w + 1]
    rows = []
    for dy in (0, 2):
        row = padded[:, dy:dy + h, 1:w + 1]
        columns = []
        for dx in (0, 2):
            col = padded[:, 1:h + 1, dx:dx + w]
            diag = padded[:, dy:dy + h, dx:dx + w]
            columns.append(torch.div(9 * main + 3 * row + 3 * col + diag, 16, rounding_mode="floor"))
        rows.append(torch.stack(columns, dim=3).reshape(n, h, 2 * w, c))
    return torch.stack(rows, dim=2).reshape(n, 2 * h, 2 * w, c)


def shuffle_lanes(*, value, groups, lanes):
    n, h, w, channels = value.shape
    if (type(groups) is not int or type(lanes) is not int or min(groups, lanes) < 1
            or (not torch.jit.is_tracing() and channels % (groups * lanes))):
        raise ValueError("shuffle needs channels divisible by positive groups * lanes")
    return value.reshape(n, h, w, groups, channels // (groups * lanes), lanes).permute(0, 1, 2, 4, 3, 5).reshape(n, h, w, channels)


def shuffle_net(*, sources, descriptors, targets, lanes):
    merged = torch.cat(sources, dim=3)
    shuffled = shuffle_lanes(value=merged, groups=2, lanes=lanes)
    fractions = torch.cat([torch.full((value.shape[3],), descriptor["fraction"], dtype=torch.int64, device=value.device)
                           for value, descriptor in zip(sources, descriptors)])
    fractions = shuffle_lanes(value=fractions.reshape(1, 1, 1, -1), groups=2, lanes=lanes).reshape(-1)
    half = shuffled.shape[3] // 2
    values = []
    for index, target in enumerate(targets):
        channels = shuffled[..., index * half:(index + 1) * half]
        channel_fractions = fractions[index * half:(index + 1) * half]
        scaled = torch.zeros_like(channels)
        for fraction in sorted({descriptor["fraction"] for descriptor in descriptors}):
            candidate = requantize(value=channels, shift=fraction - target["fraction"])
            scaled = torch.where(channel_fractions == fraction, candidate, scaled)
        low, high = RANGE[target["type"]]
        if target["type"] == 2:
            # This kernel clamps only one side per lane, even at unchanged scale.
            upper = torch.arange(half, device=scaled.device) % (2 * lanes) < lanes
            scaled = torch.where(upper, scaled.clamp_max(high), scaled.clamp_min(low))
        else:
            scaled = scaled.clamp(low, high)
        values.append(scaled)
    return values


class IntegerConvolution(nn.Module):
    def __init__(self, *, layer, source, arena, channels):
        super().__init__()
        self.layer = layer
        self.source = source
        self.depthwise = layer["op"] != "Convolution"
        kh, kw = layer["kernel"]
        co = layer["shape"][3]
        count = co * (1 if self.depthwise else channels) * kh * kw
        kernel, cursor = decode_kernel(arena, layer["arena_offset"], count, layer["weight"], layer["packed"])
        shape = (kh, kw, co) if self.depthwise else (co, kh, kw, channels)
        self.register_buffer("kernel", torch.from_numpy(kernel.reshape(shape).copy()))
        if layer["bias"]:
            bias = torch.from_numpy(decode_bias(arena, cursor, co, False).copy())
            fraction = layer["weight"]["fraction"] + source["fraction"]
            bias = requantize(value=bias, shift=layer["bias_storage"]["fraction"] - fraction)
        else:
            bias = torch.zeros(co, dtype=torch.int64)
        self.register_buffer("bias", bias)

    def forward(self, value):
        kh, kw = self.layer["kernel"]
        sh, sw = self.layer["stride"]
        ph, pw = self.layer["pad"]
        dh, dw = self.layer.get("dilation", (1, 1))
        padded = F.pad(value, (0, 0, pw, pw, ph, ph))
        oh = (padded.shape[1] - dh * (kh - 1) - 1) // sh + 1
        ow = (padded.shape[2] - dw * (kw - 1) - 1) // sw + 1
        accumulated = self.bias.reshape(1, 1, 1, -1)
        for y in range(kh):
            for x in range(kw):
                patch = padded[:, y * dh:y * dh + sh * oh:sh, x * dw:x * dw + sw * ow:sw]
                product = (patch * self.kernel[y, x] if self.depthwise
                           else torch.matmul(patch, self.kernel[:, y, x].transpose(0, 1)))
                accumulated = accumulated + product
        # Wrap before adding the rounding offset; the rounding intermediate must not wrap.
        shift = self.layer["weight"]["fraction"] + self.source["fraction"] - self.layer["storage"]["fraction"]
        value = requantize(value=wrap32(value=accumulated), shift=shift)
        if self.layer["relu"]:
            value = value.clamp_min(0)
        return value.clamp(*RANGE[self.layer["storage"]["type"]])


class EspressoIntegerGraph(nn.Module):
    def __init__(self, *, text, arena, output_names=None, input_shapes=None, prefix_output=None):
        super().__init__()
        self.graph = analyze(text)
        if len(arena) != self.graph["arena_bytes"]:
            raise ValueError("arena byte count does not match graph")
        stamp = self.graph["stamp"]
        if stamp is not None and int.from_bytes(arena[-4:], "little") != stamp:
            raise ValueError("arena stamp does not match graph")
        self.prefix_output = prefix_output
        self.execution_layers = self.graph["layers"]
        if prefix_output is not None:
            if not isinstance(prefix_output, str):
                raise ValueError("prefix output must name a produced blob")
            producer = next((index for index, layer in enumerate(self.execution_layers)
                             if layer["op"] != "Input" and prefix_output in layer["outputs"]), None)
            if producer is None:
                raise ValueError("prefix output must name a produced blob")
            self.execution_layers = self.execution_layers[:producer + 1]
        self.input_names = tuple(layer["name"] for layer in self.graph["layers"] if layer["op"] == "Input")
        self.input_shapes = {name: tuple(self.graph["shapes"][name]) for name in self.input_names}
        if input_shapes is not None:
            if set(input_shapes) != set(self.input_names):
                raise ValueError("input shape names do not match graph")
            for name, shape in input_shapes.items():
                original = self.input_shapes[name]
                if len(shape) != 4 or any(type(v) is not int or v <= 0 for v in shape):
                    raise ValueError("input shape must be four positive integers")
                if shape[0] != original[0] or shape[3] != original[3]:
                    raise ValueError("only spatial input extents may change")
                self.input_shapes[name] = tuple(shape)
        produced = [name for layer in self.execution_layers if layer["op"] != "Input" for name in layer["outputs"]]
        consumed = {name for layer in self.execution_layers for name in layer["inputs"]}
        terminal = (prefix_output,) if prefix_output is not None else tuple(name for name in produced if name not in consumed)
        self.output_names = tuple(output_names) if output_names is not None else terminal
        if not self.output_names or len(set(self.output_names)) != len(self.output_names) or not set(self.output_names) <= set(produced):
            raise ValueError("expected unique existing output names")
        self.convolutions = nn.ModuleDict()
        self.slots = {}
        for index, layer in enumerate(self.execution_layers):
            self._validate_layer(layer=layer)
            if layer["op"] in CONVOLUTIONS:
                key = str(index)
                source_name = layer["inputs"][0]
                self.slots[layer["name"]] = key
                self.convolutions[key] = IntegerConvolution(
                    layer=layer, source=self.graph["descriptors"][source_name], arena=arena,
                    channels=self.graph["shapes"][source_name][3],
                )

    def _validate_layer(self, *, layer):
        if layer["op"] not in SUPPORTED:
            raise ValueError(f"unsupported integer operator {layer['op']}")
        for name in layer["outputs"]:
            if self.graph["descriptors"][name]["type"] not in RANGE:
                raise ValueError("integer replay refuses floating-point blobs")
        if layer["op"] in CONVOLUTIONS:
            if layer["weight"]["type"] not in RANGE or (layer["bias"] and layer["bias_storage"]["type"] != 4):
                raise ValueError("unsupported convolution storage")
        if layer["op"] == "UpSampling" and layer["mode"] != "LINEAR":
            raise ValueError("only measured integer LINEAR x2 upsampling is supported")
        if layer["op"] in ("Shuffle", "ShuffleNet"):
            sources = [self.graph["shapes"][name] for name in layer["inputs"]]
            groups = 2 if layer["op"] == "ShuffleNet" else layer["parts"]
            lanes = layer["groups"]
            if (any(shape[:3] != sources[0][:3] for shape in sources)
                    or sum(shape[3] for shape in sources) % (groups * lanes)
                    or any(self.graph["descriptors"][name]["type"] not in RANGE for name in layer["inputs"])):
                raise ValueError("unsupported shuffle shape or source storage")

    def _execute(self, *, inputs):
        if len(inputs) != len(self.input_names):
            raise ValueError("input count does not match graph")
        blobs = dict(zip(self.input_names, inputs))
        for name, value in blobs.items():
            if value.dtype != torch.int64:
                raise ValueError("integer replay requires int64 NHWC inputs")
            if not torch.jit.is_tracing() and tuple(value.shape) != self.input_shapes[name]:
                raise ValueError(f"input {name} shape does not match fixed profile")
        desc = self.graph["descriptors"]
        for layer in self.execution_layers:
            op = layer["op"]
            if op == "Input":
                continue
            sources = [blobs[name] for name in layer["inputs"]]
            storage = layer.get("storage")
            if op in CONVOLUTIONS:
                values = [self.convolutions[self.slots[layer["name"]]](sources[0])]
            elif op == "Eltwise":
                common = max(desc[name]["fraction"] for name in layer["inputs"])
                aligned = [value * (1 << (common - desc[name]["fraction"])) for name, value in zip(layer["inputs"], sources)]
                value = requantize(value=aligned[0] + aligned[1], shift=common - storage["fraction"])
                if layer["relu"]:
                    value = value.clamp_min(0)
                values = [value.clamp(*RANGE[storage["type"]])]
            elif op == "Concat":
                parts = [value if desc[name]["fraction"] == storage["fraction"]
                         else rescale(value=value, source=desc[name], target=storage)
                         for name, value in zip(layer["inputs"], sources)]
                values = [torch.cat(parts, dim=3)]
            elif op == "Slice":
                split = layer["split"]
                parts = (sources[0][..., :split], sources[0][..., split:])
                source = desc[layer["inputs"][0]]
                values = [value if source["fraction"] == desc[name]["fraction"]
                          else rescale(value=value, source=source, target=desc[name])
                          for name, value in zip(layer["outputs"], parts)]
            elif op == "Shuffle":
                values = [shuffle_lanes(value=sources[0], groups=layer["parts"], lanes=layer["groups"])]
            elif op == "ShuffleNet":
                values = shuffle_net(sources=sources, descriptors=[desc[name] for name in layer["inputs"]],
                                     targets=[desc[name] for name in layer["outputs"]], lanes=layer["groups"])
            else:
                values = [upsample_x2(value=sources[0])]
            blobs.update(zip(layer["outputs"], values))
        return blobs

    def forward(self, *inputs):
        blobs = self._execute(inputs=inputs)
        return tuple(blobs[name] for name in self.output_names)

    def intermediate(self, *, inputs):
        return self._execute(inputs=tuple(inputs[name] for name in self.input_names))


def load(*, directory, output_names=None, input_shapes=None, prefix_output=None):
    directory = Path(directory)
    return EspressoIntegerGraph(
        text=(directory / "graph.txt").read_text(), arena=(directory / "arena.bin").read_bytes(),
        output_names=output_names, input_shapes=input_shapes, prefix_output=prefix_output,
    ).eval()
