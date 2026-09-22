"""Readable PyTorch module for espresso graphs whose blobs are float32.

`espresso_fixed.py` reproduces the runtime bit for bit in NumPy, including the fixed-point rules.
Graphs whose storage descriptors are all `4 0` need none of that: every layer is ordinary float32
arithmetic, so they can be expressed as an `nn.Module` and exported. The layer semantics are the
ones the probes established (see espresso-fixed-point.zh-CN.md): a convolution is a plain conv
with bias and optional ReLU, `Eltwise` adds, `Concat` joins channels, `UpSampling LINEAR` is the
zero-padded half-pixel x2 kernel `(9a + 3b + 3c + d) / 16`, and a dense layer is a matmul.

Softmax is the one place the export is not exact: on two classes the runtime takes the exponent
relative to channel 0 and scales by the hardware reciprocal estimate, which has no ONNX
equivalent, so this module offers the ordinary softmax and the caller reports the deviation.
"""
import numpy as np
import torch
from torch import nn

from espresso_fixed import decode_bias, decode_kernel
from espresso_graph import analyze


def zero_padded_upsample(value):
    """Half-pixel bilinear x2 with zeros outside the image, as the runtime's LINEAR kernel does."""
    weights = value.new_tensor([[1.0, 3.0], [3.0, 9.0]]) / 16.0
    n, c, h, w = value.shape
    padded = torch.nn.functional.pad(value, (1, 1, 1, 1))
    out = value.new_zeros((n, c, 2 * h, 2 * w))
    for dy in (0, 1):
        for dx in (0, 1):
            top = 0 if dy == 0 else 2
            left = 0 if dx == 0 else 2
            main = padded[:, :, 1:h + 1, 1:w + 1]
            row = padded[:, :, top:top + h, 1:w + 1]
            col = padded[:, :, 1:h + 1, left:left + w]
            diag = padded[:, :, top:top + h, left:left + w]
            out[:, :, dy::2, dx::2] = (9 * main + 3 * row + 3 * col + diag) / 16.0
    return out


class EspressoFloatGraph(nn.Module):
    """Executes a float32 espresso graph; inputs and outputs are NCHW tensors."""

    def __init__(self, *, text, arena):
        super().__init__()
        self.graph = analyze(text)
        if any(layer.get("storage", {}).get("type", 4) != 4 for layer in self.graph["layers"]):
            raise ValueError("this module only executes graphs whose blobs are float32")
        # Layer names carry dots, which nn.ModuleDict rejects, so modules are keyed by index.
        self.layers = nn.ModuleList()
        self.slots = {}
        self.constants = {}
        self.input_names = [layer["name"] for layer in self.graph["layers"] if layer["op"] == "Input"]
        self.output_name = self.graph["layers"][-1]["outputs"][0]
        for layer in self.graph["layers"]:
            op = layer["op"]
            if op in ("Convolution", "DepthwiseSeparableConvolution", "DilationSeparableConvolution"):
                self.slots[layer["name"]] = len(self.layers)
                self.layers.append(self._convolution(layer, arena))
            elif op == "InnerProduct":
                self.slots[layer["name"]] = len(self.layers)
                self.layers.append(self._dense(layer, arena))
            elif op == "Constant":
                count = int(np.prod(layer["shape"]))
                values, _ = decode_kernel(arena, layer["arena_offset"], count, layer["storage"], False)
                self.constants[layer["outputs"][0]] = torch.from_numpy(values.astype(np.float32).reshape(1, layer["shape"][3], 1, 1))
            elif op not in ("Input", "Eltwise", "Concat", "UpSampling", "Softmax", "Sigmoid", "Mul"):
                raise ValueError(f"unsupported float operator {op}")

    def _convolution(self, layer, arena):
        kh, kw = layer["kernel"]
        co = layer["shape"][3]
        depthwise = layer["op"] != "Convolution"
        ci = self.graph["shapes"][layer["inputs"][0]][3]
        count = co * (1 if depthwise else ci) * kh * kw
        kernel, cursor = decode_kernel(arena, layer["arena_offset"], count, layer["weight"], False)
        module = nn.Conv2d(ci, co, (kh, kw), layer["stride"], layer["pad"], layer.get("dilation", (1, 1)),
                           ci if depthwise else 1, bias=layer["bias"])
        # Dense kernels are stored (co, kh, kw, ci); depthwise ones (kh, kw, c).
        weight = (kernel.reshape(kh, kw, co).transpose(2, 0, 1)[:, None] if depthwise
                  else kernel.reshape(co, kh, kw, ci).transpose(0, 3, 1, 2))
        with torch.no_grad():
            module.weight.copy_(torch.from_numpy(weight.astype(np.float32).copy()))
            if layer["bias"]:
                module.bias.copy_(torch.from_numpy(decode_bias(arena, cursor, co, True).astype(np.float32)))
        return module

    def _dense(self, layer, arena):
        n, h, w, c = self.graph["shapes"][layer["inputs"][0]]
        features = h * w * c
        co = layer["shape"][3]
        kernel, cursor = decode_kernel(arena, layer["arena_offset"], co * features, layer["weight"], False)
        module = nn.Linear(features, co, bias=layer["bias"])
        with torch.no_grad():
            module.weight.copy_(torch.from_numpy(kernel.reshape(co, features).astype(np.float32).copy()))
            if layer["bias"]:
                module.bias.copy_(torch.from_numpy(decode_bias(arena, cursor, co, True).astype(np.float32)))
        return module

    def forward(self, *inputs):
        blobs = dict(zip(self.input_names, inputs))
        for layer in self.graph["layers"]:
            op, name = layer["op"], layer["name"]
            if op == "Input":
                continue
            if op == "Constant":
                blobs[layer["outputs"][0]] = self.constants[layer["outputs"][0]]
                continue
            sources = [blobs[key] if key in blobs else self.constants[key] for key in layer["inputs"]]
            if op in ("Convolution", "DepthwiseSeparableConvolution", "DilationSeparableConvolution"):
                value = self.layers[self.slots[name]](sources[0])
                if layer["relu"]:
                    value = torch.relu(value)
            elif op == "InnerProduct":
                value = self.layers[self.slots[name]](sources[0].flatten(1)).reshape(sources[0].shape[0], -1, 1, 1)
                if layer["relu"]:
                    value = torch.relu(value)
            elif op == "Eltwise":
                value = sources[0] + sources[1]
                if layer["relu"]:
                    value = torch.relu(value)
            elif op == "Concat":
                value = torch.cat(sources, dim=1)
            elif op == "UpSampling":
                if layer["mode"] != "LINEAR":
                    raise ValueError(f"unsupported upsample mode {layer['mode']}")
                value = zero_padded_upsample(sources[0])
            elif op == "Softmax":
                value = torch.softmax(sources[0], dim=1)
            elif op == "Sigmoid":
                value = torch.sigmoid(sources[0])
            elif op == "Mul":
                value = sources[0] * sources[1]
            else:
                raise ValueError(f"unsupported float operator {op}")
            blobs[layer["outputs"][0]] = value
        return blobs[self.output_name]


def load(*, directory):
    path = __import__("pathlib").Path(directory)
    model = EspressoFloatGraph(text=(path / "graph.txt").read_text(), arena=(path / "arena.bin").read_bytes())
    model.eval()
    return model
