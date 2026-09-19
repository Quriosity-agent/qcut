"""Bounded OCR detector interpreter; private bundles need no vendor runtime."""
import hashlib
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

FORMAT = "qcut-private-ocr-detector-pytorch-v1"
SOURCE_SHA256 = "f060d7ac2f35b0ac74de6fc0f00de03f93f1247d349a9b8bdaa40b90fda1edde"
GRAPH_SHA256 = "f28e5e3134f79efae40464c750054adb2913e712873689c1de3ff904ea21c0cf"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"


def parse_graph(*, text):
    if not isinstance(text, str) or len(text) > 65536:
        raise ValueError("invalid OCR graph text")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if len(rows) < 3 or rows[0] != ["E"] or len(rows[1]) != 3:
        raise ValueError("only audited E-prefix graphs are supported")
    if not all(token.isdecimal() for token in rows[1]) or int(rows[1][0]) != 1:
        raise ValueError("invalid graph header")
    if int(rows[1][1]) != len(rows) - 3 or not 1 <= int(rows[1][1]) <= 128:
        raise ValueError("graph layer count mismatch")
    return rows[2:]


def decode_arena(*, arena, count):
    if len(arena) != count * 2 + 4:
        raise ValueError("FP16 arena size mismatch")
    values = widen_fp16(bits=np.frombuffer(arena[:-4], dtype="<u2"))
    if not np.isfinite(values).all():
        raise ValueError("nonfinite FP16 weights")
    return values


def widen_fp16(*, bits):
    if bits.dtype != np.uint16 or bits.ndim != 1 or np.any((bits & 0x7c00) == 0x7c00):
        raise ValueError("expected finite little-endian half-precision bit patterns")
    values = bits.view(np.float16).astype(np.float32)
    vector_end = len(bits) // 4 * 4
    magnitude = (bits[:vector_end] & 0x7fff).astype(np.uint32)
    subnormal = magnitude < 0x400
    # The pinned ARM64 four-lane converter XORs these bits instead of selecting them.
    corrected = values[:vector_end].view(np.uint32).copy()
    corrected[subnormal] ^= magnitude[subnormal] << 13
    values[:vector_end] = corrected.view(np.float32)
    return values


def checked_input(*, tensor):
    if (not isinstance(tensor, torch.Tensor) or tensor.device.type != "cpu"
            or tensor.dtype != torch.float32 or tensor.ndim != 4
            or tuple(tensor.shape[:2]) != (1, 3)
            or any(size < 32 or size > 2048 or size % 32 for size in tensor.shape[2:])
            or not torch.isfinite(tensor).all()):
        raise ValueError("expected finite CPU float32 [1,3,H,W], H/W multiples of 32 in [32,2048]")


class OCRDetector(nn.Module):
    def __init__(self, *, nodes, weights=None):
        super().__init__()
        self.nodes = nodes
        self.layers = nn.ModuleDict()
        self.steps = []
        self.weight_slices = []
        channels, consumed, cursor = {}, set(), 0
        if weights is not None and (weights.dtype != np.float32 or weights.ndim != 1 or not np.isfinite(weights).all()):
            raise ValueError("invalid OCR weights")
        for index, row in enumerate(nodes):
            if not isinstance(row, list) or len(row) < 2 or not all(isinstance(t, str) for t in row):
                raise ValueError("invalid OCR graph node")
            kind, name = row[:2]
            inputs, params, module = [], {}, None
            if kind == "DataV2":
                if index != 0 or len(row) != 9 or row[2:] != ["1", "1", "1", "3", "4", "0", "0"]:
                    raise ValueError("unsupported OCR input declaration")
                self.input_name = name
                target, cout = name, 3
            elif kind in {"Convolution", "ConvTranspose2d"}:
                transpose = kind == "ConvTranspose2d"
                if len(row) != (22 if transpose else 19) or row[-8:-2] != ["4", "0"] * 3:
                    raise ValueError("unsupported convolution storage")
                if transpose:
                    cout, groups, kh, kw, sh, sw, ph, pw, oh, ow, bias, relu = map(int, row[2:14])
                else:
                    cout, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
                    groups, oh, ow = 1, 0, 0
                if (not 1 <= cout <= 256 or groups != 1 or kh != kw or kh not in (1, 3, 4, 7)
                        or sh != sw or sh not in (1, 2) or ph != pw or ph != kh // 2 - (kh == 4)
                        or bias != 1 or relu not in (0, 1) or oh != ow or not 0 <= oh < sh):
                    raise ValueError("unsupported convolution semantics")
                inputs, target = [row[-2]], row[-1]
                if inputs[0] not in channels:
                    raise ValueError("missing convolution input")
                cin = channels[inputs[0]]
                params = {"relu": bool(relu)}
                module = (nn.ConvTranspose2d(cin, cout, kh, sh, ph, output_padding=oh)
                          if transpose else nn.Conv2d(cin, cout, kh, sh, ph))
                count = cin * cout * kh * kw
                self.weight_slices.append({"node": name, "start": cursor, "kernel_count": count,
                                           "bias_count": cout, "transpose": transpose,
                                           "cin": cin, "cout": cout, "kernel": kh})
                if weights is not None:
                    values = weights[cursor:cursor + count + cout]
                    if len(values) != count + cout:
                        raise ValueError("truncated OCR weights")
                    packed = torch.from_numpy(values[:count].copy()).reshape(cout, kh, kw, cin)
                    kernel = packed.permute(3, 0, 1, 2) if transpose else packed.permute(0, 3, 1, 2)
                    with torch.no_grad():
                        module.weight.copy_(kernel)
                        module.bias.copy_(torch.from_numpy(values[count:].copy()))
                cursor += count + cout
            elif kind == "PoolingDown":
                if len(row) != 13 or row[2:11] != ["3", "3", "2", "2", "1", "1", "4", "0", "MAX"]:
                    raise ValueError("unsupported max pool")
                inputs, target = [row[11]], row[12]
                cout = channels.get(inputs[0])
            elif kind == "OnnxOp2":
                if len(row) != 8 or row[2] != "Sum" or row[6:] != ["4", "0"]:
                    raise ValueError("unsupported binary operator")
                inputs, target = row[3:5], row[5]
                cout = channels.get(inputs[0])
                if cout != channels.get(inputs[1]):
                    raise ValueError("residual channel mismatch")
            elif kind in {"Relu", "Sigmoid"}:
                if len(row) != 6 or row[4:] != (["0", "0"] if kind == "Relu" else ["4", "0"]):
                    raise ValueError("unsupported activation")
                inputs, target = [row[2]], row[3]
                cout = channels.get(inputs[0])
            elif kind == "Concat2":
                if len(row) != 9 or row[2:4] != ["1", "2"] or row[7:] != ["4", "0"]:
                    raise ValueError("unsupported channel concatenation")
                inputs, target = row[4:6], row[6]
                cout = sum(channels.get(k, 0) for k in inputs)
            else:
                raise ValueError(f"unsupported OCR operator: {kind}")
            if any(k not in channels for k in inputs) or cout is None or target in channels:
                raise ValueError("missing input or duplicate output")
            channels[target] = cout
            consumed.update(inputs)
            if module is not None:
                self.layers[str(index)] = module
            self.steps.append({"kind": kind, "inputs": inputs, "output": target, "params": params})
        self.outputs = [key for key in channels if key not in consumed]
        if not self.outputs or not hasattr(self, "input_name"):
            raise ValueError("empty OCR graph")
        self.parameter_count = cursor
        if weights is not None and cursor != len(weights):
            raise ValueError("unconsumed OCR weights")

    def forward(self, inputs, *, trace=False):
        if not isinstance(inputs, dict) or set(inputs) != {self.input_name}:
            raise ValueError("exactly one declared OCR input is required")
        checked_input(tensor=inputs[self.input_name])
        values = dict(inputs)
        for index, step in enumerate(self.steps):
            kind, names, target = step["kind"], step["inputs"], step["output"]
            if kind == "DataV2":
                continue
            tensors = [values[name] for name in names]
            if kind in {"Convolution", "ConvTranspose2d"}:
                value = self.layers[str(index)](tensors[0])
                if step["params"]["relu"]:
                    value = value.relu()
            elif kind == "PoolingDown":
                value = F.max_pool2d(tensors[0], 3, 2, 1)
            elif kind == "OnnxOp2":
                if tensors[0].shape != tensors[1].shape:
                    raise ValueError("residual shape mismatch; broadcasting is unsupported")
                value = tensors[0] + tensors[1]
            elif kind == "Relu":
                value = tensors[0].relu()
            elif kind == "Sigmoid":
                value = tensors[0].sigmoid()
            elif kind == "Concat2":
                value = torch.cat(tensors, dim=1)
            else:
                raise ValueError("unsupported execution step")
            if not torch.isfinite(value).all():
                raise ValueError(f"nonfinite OCR tensor: {target}")
            values[target] = value
        return values if trace else {key: values[key] for key in self.outputs}


def load_model(*, path, expected_sha256=None):
    path = Path(path)
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("oversized OCR bundle")
    if expected_sha256 is not None and hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("OCR artifact hash mismatch")
    bundle = torch.load(path, map_location="cpu", weights_only=True)
    if (not isinstance(bundle, dict) or bundle.get("format") != FORMAT or bundle.get("local_only") is not True
            or bundle.get("source_sha256") != SOURCE_SHA256 or bundle.get("runtime_sha256") != RUNTIME_SHA256
            or not isinstance(bundle.get("graph"), str)
            or hashlib.sha256(bundle["graph"].encode()).hexdigest() != GRAPH_SHA256):
        raise ValueError("unsupported OCR bundle provenance")
    model = OCRDetector(nodes=parse_graph(text=bundle["graph"]))
    if not isinstance(bundle.get("state_dict"), dict) or any(
            not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or not torch.isfinite(value).all()
            for value in bundle["state_dict"].values()):
        raise ValueError("invalid OCR state tensor")
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.cpu().eval()
