"""Strict FP32 vision graph interpreter; no runtime or private source reads."""
import hashlib
import io
import math
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from vision_batch_profiles import (EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256, execution_profile,
                                   input_shapes as profile_input_shapes, ordered_execution)


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def state_digest(*, state):
    result = hashlib.sha256()
    if not isinstance(state, dict) or not state:
        raise ValueError("empty vision state")
    for name in sorted(state):
        value = state[name]
        if (not isinstance(value, torch.Tensor) or value.device.type != "cpu"
                or value.dtype != torch.float32 or not torch.isfinite(value).all()):
            raise ValueError("expected finite CPU float32 state tensors")
        result.update(name.encode() + b"\0")
        result.update(str(tuple(value.shape)).encode() + b"\0")
        result.update(value.contiguous().numpy().tobytes())
    return result.hexdigest()


def parse_graph(*, text):
    if not isinstance(text, str) or len(text) > 131072:
        raise ValueError("invalid vision graph")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    # Optional storage prefixes: E marks an fp16 arena (widened by the exporter), D float32.
    for prefix in (["E"], ["D"]):
        if rows and rows[0] == prefix:
            rows = rows[1:]
    # Header: <input count> <layer count> <stamp>; every input is a leading DataV2 row.
    if (not rows or len(rows[0]) != 3 or not all(v.isdecimal() for v in rows[0])
            or not 1 <= int(rows[0][0]) <= 4 or not 1 <= int(rows[0][1]) <= 256
            or len(rows) != int(rows[0][0]) + int(rows[0][1]) + 1):
        raise ValueError("unsupported header or layer count")
    count = int(rows[0][0])
    if any(row[0] != "DataV2" for row in rows[1:1 + count]) or any(row[0] == "DataV2" for row in rows[1 + count:]):
        raise ValueError("declared input count differs from the leading DataV2 rows")
    return rows[1:]


def channel_sum(*, value, ordered):
    """Keep-dim sum over channels; the ordered form adds channels one at a time like the native loop."""
    if not ordered:
        return value.sum(dim=1, keepdim=True)
    total = value[:, :1]
    for index in range(1, value.shape[1]):
        total = total + value[:, index:index + 1]
    return total


def fma(*, a, b, c):
    """Single-rounding multiply-add, as the ARM kernels fuse it."""
    return (a.double() * (b.double() if isinstance(b, torch.Tensor) else b) + c.double()).float()


def separable_bilinear(*, value, size):
    """Half-pixel bilinear resize evaluated x first, then y, with fused multiply-adds; matches the native CPU kernel."""
    n, c, h, w = value.shape
    oh, ow = size

    def axis(length, count):
        source = ((torch.arange(count, dtype=torch.float32) + 0.5) * (length / count) - 0.5).clamp(min=0)
        low = source.floor().long().clamp(max=length - 1)
        return low, (low + 1).clamp(max=length - 1), source - low.float()

    y0, y1, wy = axis(h, oh)
    x0, x1, wx = axis(w, ow)
    wx, wy = wx.reshape(1, 1, 1, -1), wy.reshape(1, 1, -1, 1)
    rows = value[:, :, y0], value[:, :, y1]
    top = fma(a=rows[0][:, :, :, x1], b=wx, c=rows[0][:, :, :, x0] * (1 - wx))
    bottom = fma(a=rows[1][:, :, :, x1], b=wx, c=rows[1][:, :, :, x0] * (1 - wx))
    return fma(a=bottom, b=wy, c=top * (1 - wy))


class VisionGraph(nn.Module):
    def __init__(self, *, nodes, weights=None, ordered=False):
        super().__init__()
        if type(ordered) is not bool:
            raise ValueError("ordered must be an explicit boolean")
        self.ordered = ordered
        if ordered:
            from matting_phase5_numeric import ordered_tanh
            from ocr_rec_numeric import PinnedSigmoid, ordered_convolution
            self.ordered_convolution = ordered_convolution
            self.ordered_tanh = ordered_tanh
            self.pinned_sigmoid = PinnedSigmoid()
        if not isinstance(nodes, list) or not 2 <= len(nodes) <= 257:
            raise ValueError("invalid vision nodes")
        if weights is not None and (weights.dtype != np.float32 or weights.ndim != 1
                                    or not np.isfinite(weights).all()):
            raise ValueError("expected finite one-dimensional FP32 weights")
        self.nodes, self.layers = nodes, nn.ModuleDict()
        self.shapes, self.input_shapes, self.steps = {}, {}, []
        cursor, consumed, layer_names = 0, set(), set()
        for index, row in enumerate(nodes):
            if not isinstance(row, list) or len(row) < 2 or not all(isinstance(v, str) for v in row):
                raise ValueError("invalid graph node")
            op, name = row[:2]
            if name in layer_names:
                raise ValueError("duplicate layer name")
            layer_names.add(name)
            inputs, target, shape, layer, count = [], None, None, None, 0
            params = {}
            if op == "DataV2":
                if index != len(self.input_shapes) or len(row) != 9 or row[6:] != ["4", "0", "0"]:
                    raise ValueError("unsupported input storage")
                n, h, w, c = map(int, row[2:6])
                if n != 1 or c != 3 or min(h, w) < 1 or max(h, w) > 1024:
                    raise ValueError("unsupported input dimensions")
                target, shape = name, (n, c, h, w)
                self.input_shapes[name] = shape
            elif op in {"Convolution", "DepthwiseSeparableConvolution"}:
                if len(row) != 19 or row[11:17] != ["4", "0"] * 3:
                    raise ValueError("unsupported convolution storage")
                co, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
                if (not 1 <= co <= 1280 or kh != kw or kh not in (1, 3, 5, 7)
                        or sh != sw or sh not in (1, 2, 7) or ph != pw or ph not in (0, kh // 2)
                        or bias != 1 or relu not in (0, 1)):
                    raise ValueError("unsupported convolution semantics")
                inputs, target, params = [row[17]], row[18], {"relu": bool(relu)}
                n, ci, hi, wi = self._shape(name=inputs[0])
                depthwise = op == "DepthwiseSeparableConvolution"
                groups = ci if depthwise else 1
                if depthwise and co != ci:
                    raise ValueError("unsupported depthwise multiplier")
                layer = nn.Conv2d(ci, co, kh, sh, ph, groups=groups)
                shape = (n, co, (hi + 2 * ph - kh) // sh + 1, (wi + 2 * pw - kw) // sw + 1)
                count = co * (ci // groups) * kh * kw + co
                if weights is not None:
                    data = self._slice(weights=weights, start=cursor, count=count)
                    packed = torch.from_numpy(data[:-co].copy())
                    kernel = (packed.reshape(kh, kw, co).permute(2, 0, 1).unsqueeze(1) if depthwise
                              else packed.reshape(co, kh, kw, ci).permute(0, 3, 1, 2))
                    with torch.no_grad():
                        layer.weight.copy_(kernel)
                        layer.bias.copy_(torch.from_numpy(data[-co:].copy()))
            elif op == "Conv2D":
                # groups ci co kh kw sh sw pad(l r t b) dilation(h w) bias relu, then storage and names.
                if len(row) != 25 or row[17:23] != ["4", "0"] * 3:
                    raise ValueError("unsupported dilated convolution storage")
                g, ci, co, kh, kw, sh, sw, pl, pr, pt, pb, dh, dw, bias, relu = map(int, row[2:17])
                if (g != 1 or not 1 <= co <= 1280 or kh != kw or kh not in (1, 3, 5) or sh != sw or sh != 1
                        or not (pl == pr == pt == pb) or dh != dw or not 1 <= dh <= 32 or pl != dh * (kh // 2)
                        or bias != 1 or relu not in (0, 1)):
                    raise ValueError("unsupported dilated convolution semantics")
                inputs, target, params = [row[23]], row[24], {"relu": bool(relu)}
                n, cin, hi, wi = self._shape(name=inputs[0])
                if cin != ci:
                    raise ValueError("dilated convolution input channels differ")
                layer = nn.Conv2d(ci, co, kh, 1, pl, dilation=dh)
                shape = (n, co, hi, wi)
                count = co * ci * kh * kw + co
                if weights is not None:
                    data = self._slice(weights=weights, start=cursor, count=count)
                    with torch.no_grad():
                        layer.weight.copy_(torch.from_numpy(data[:-co].copy()).reshape(co, kh, kw, ci).permute(0, 3, 1, 2))
                        layer.bias.copy_(torch.from_numpy(data[-co:].copy()))
            elif op == "Pooling":
                if len(row) != 13 or row[2:11] != ["2", "2", "2", "2", "0", "0", "4", "0", "MAX"]:
                    raise ValueError("only 2x2 stride-2 max pooling supported")
                inputs, target = [row[11]], row[12]
                n, c, h, w = self._shape(name=inputs[0])
                if h % 2 or w % 2:
                    raise ValueError("max pooling needs even extents")
                shape = (n, c, h // 2, w // 2)
            elif op == "Slice":
                # Channel split into a leading block of K channels and the remainder.
                if len(row) != 11 or row[3:5] != ["1", "1"] or row[6] != "2" or row[8] != "0" or row[10] != "0":
                    raise ValueError("unsupported slice")
                inputs, split = [row[2]], int(row[5])
                n, c, h, w = self._shape(name=inputs[0])
                if not 0 < split < c:
                    raise ValueError("slice point outside the channel extent")
                target, extra, params = row[7], row[9], {"split": split}
                shape = (n, split, h, w)
                if extra in self.shapes or extra == target:
                    raise ValueError("duplicate slice output")
                self.shapes[extra] = (n, c - split, h, w)
                params["extra"] = extra
            elif op == "OnnxOp2":
                if len(row) != 8 or row[2] != "Mul" or row[6:] != ["4", "0"]:
                    raise ValueError("unsupported binary operation")
                inputs, target = row[3:5], row[5]
                shape = self._shape(name=inputs[0])
                if self._shape(name=inputs[1]) != shape:
                    raise ValueError("multiply shapes differ; broadcasting unsupported")
            elif op == "Eltwise":
                if len(row) != 8 or row[5:7] != ["4", "0"] or row[7] not in ("0", "1"):
                    raise ValueError("unsupported residual addition")
                inputs, target, params = row[2:4], row[4], {"relu": row[7] == "1"}
                shape = self._shape(name=inputs[0])
                if self._shape(name=inputs[1]) != shape:
                    raise ValueError("residual shapes differ; broadcasting unsupported")
            elif op == "Concat":
                if len(row) != 8 or row[2] != "2" or row[6:] != ["4", "0"]:
                    raise ValueError("only two-input channel concat supported")
                inputs, target = row[3:5], row[5]
                left, right = [self._shape(name=k) for k in inputs]
                if left[0] != right[0] or left[2:] != right[2:]:
                    raise ValueError("concat spatial shapes differ")
                shape = (left[0], left[1] + right[1], *left[2:])
            elif op == "Shuffle":
                if len(row) != 6 or row[2:4] != ["4", "2"]:
                    raise ValueError("unsupported channel shuffle")
                inputs, target = [row[4]], row[5]
                shape = self._shape(name=inputs[0])
                if shape[1] % 8:
                    raise ValueError("four-lane two-group shuffle needs channels divisible by eight")
            elif op == "UpSampling":
                if len(row) != 5 or row[4] not in ("NEAREST", "BILINEAR"):
                    raise ValueError("unsupported upsample")
                inputs, target, params = [row[2]], row[3], {"mode": row[4].lower()}
                n, c, h, w = self._shape(name=inputs[0])
                shape = (n, c, h * 2, w * 2)
            elif op in {"Tanh", "Sigmoid"}:
                if len(row) != 6 or row[4:] != ["4", "0"]:
                    raise ValueError("unsupported activation")
                inputs, target = [row[2]], row[3]
                shape = self._shape(name=inputs[0])
            elif op == "SEScale":
                # Per-channel gate: the second operand is a [N, C, 1, 1] tensor broadcast over H and W.
                if len(row) != 8 or row[5:] != ["4", "0", "0"]:
                    raise ValueError("unsupported channel scale")
                inputs, target = row[2:4], row[4]
                shape = self._shape(name=inputs[0])
                if self._shape(name=inputs[1]) != (shape[0], shape[1], 1, 1):
                    raise ValueError("channel scale gate must be a per-channel singleton")
            elif op == "Upsample":
                # Fractional bilinear resize; the audited flags are the half-pixel form (no corner alignment).
                if len(row) != 8 or row[3:6] != ["linear", "0", "1"]:
                    raise ValueError("unsupported fractional upsample")
                factor = float(row[2])
                if not math.isfinite(factor) or not 1 < factor <= 4:
                    raise ValueError("unsupported upsample factor")
                inputs, target = [row[6]], row[7]
                n, c, h, w = self._shape(name=inputs[0])
                shape = (n, c, math.floor(h * factor + 0.5), math.floor(w * factor + 0.5))
                params = {"size": shape[2:]}
            elif op == "PoolingDown":
                if len(row) not in (13, 14) or row[8:11] != ["4", "0", "AVE"]:
                    raise ValueError("unsupported pooling")
                kh, kw, sh, sw, ph, pw = map(int, row[2:8])
                inputs, target = [row[11]], row[12]
                n, c, h, w = self._shape(name=inputs[0])
                global_pool = len(row) == 14 and row[13] == "GLOBAL"
                if global_pool:
                    if (kh, kw, sh, sw, ph, pw) != (h, w, 1, 1, 0, 0):
                        raise ValueError("global pool must match original input extent")
                    shape = (n, c, 1, 1)
                elif len(row) == 13 and (kh, kw, sh, sw, ph, pw) == (2, 2, 2, 2, 0, 0) and h % 2 == w % 2 == 0:
                    shape = (n, c, h // 2, w // 2)
                else:
                    raise ValueError("unsupported pool parameters")
                params = {"global": global_pool}
            elif op == "OnnxOp1" and row[2:3] == ["ReduceSum"]:
                if len(row) != 10 or row[5:] != ["4", "0", "1", "1", "1"]:
                    raise ValueError("only keepdim channel reduce-sum supported")
                inputs, target = [row[3]], row[4]
                n, c, h, w = self._shape(name=inputs[0])
                shape, params = (n, 1, h, w), {"reduce": True}
            elif op == "OnnxOp1":
                if len(row) != 12 or row[2] != "Reshape":
                    raise ValueError("unsupported unary operation")
                inputs, target = [row[3]], row[4]
                shape = self._shape(name=inputs[0])
                if shape[2:] != (1, 1) or row[5:] != ["4", "0", "1", "1", "1", str(shape[1]), "2"]:
                    raise ValueError("only spatial-singleton reshape supported")
            elif op == "InnerProduct":
                if len(row) != 13 or row[3] != "1" or row[4] not in ("0", "1") or row[5:11] != ["4", "0"] * 3:
                    raise ValueError("unsupported dense storage")
                co = int(row[2])
                inputs, target, params = [row[11]], row[12], {"relu": row[4] == "1"}
                n, ci, h, w = self._shape(name=inputs[0])
                if not 1 <= co <= 1280 or (h, w) != (1, 1):
                    raise ValueError("unsupported dense dimensions")
                layer, shape, count = nn.Linear(ci, co), (n, co, 1, 1), ci * co + co
                if weights is not None:
                    data = self._slice(weights=weights, start=cursor, count=count)
                    with torch.no_grad():
                        layer.weight.copy_(torch.from_numpy(data[:-co].copy()).reshape(co, ci))
                        layer.bias.copy_(torch.from_numpy(data[-co:].copy()))
            else:
                raise ValueError(f"unsupported vision operator: {op}")
            if target in self.shapes or shape is None or min(shape) < 1 or math.prod(shape) > 33554432:
                raise ValueError("duplicate output or invalid tensor extent")
            self.shapes[target] = shape
            consumed.update(inputs)
            self.steps.append({"op": op, "inputs": inputs, "output": target, "params": params})
            if layer is not None:
                self.layers[str(index)] = layer
            cursor += count
        self.output_shapes = {k: v for k, v in self.shapes.items() if k not in consumed}
        if not self.input_shapes or not self.output_shapes:
            raise ValueError("missing graph inputs or outputs")
        if weights is not None and len(weights) != cursor:
            raise ValueError(f"unconsumed or missing weights: expected {cursor}, got {len(weights)}")
        self.parameter_count = cursor

    def _shape(self, *, name):
        if name not in self.shapes:
            raise ValueError(f"missing input: {name}")
        return self.shapes[name]

    @staticmethod
    def _slice(*, weights, start, count):
        result = weights[start:start + count]
        if len(result) != count:
            raise ValueError("truncated vision weight arena")
        return result

    def upsample(self, *, value, mode):
        if self.ordered and mode == "bilinear":
            return separable_bilinear(value=value, size=(value.shape[2] * 2, value.shape[3] * 2))
        return F.interpolate(value, scale_factor=2, mode=mode,
                             align_corners=False if mode == "bilinear" else None)

    def forward(self, inputs, *, capture=False):
        if not isinstance(inputs, dict) or set(inputs) != set(self.input_shapes):
            raise ValueError("exact declared inputs required")
        for name, shape in self.input_shapes.items():
            value = inputs[name]
            if (not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or value.device.type != "cpu"
                    or tuple(value.shape) != shape or not torch.isfinite(value).all()):
                raise ValueError("expected finite CPU float32 original-shape input")
        # NPZ does not preserve strides; canonicalize to keep replay independent of decoder layout.
        values = {name: value.contiguous() for name, value in inputs.items()}
        for index, step in enumerate(self.steps):
            op, target, params = step["op"], step["output"], step["params"]
            if op == "DataV2":
                continue
            data = [values[k] for k in step["inputs"]]
            if op in {"Convolution", "DepthwiseSeparableConvolution", "Conv2D"}:
                layer = self.layers[str(index)]
                value = (self.ordered_convolution(value=data[0], weight=layer.weight, bias=layer.bias, stride=layer.stride,
                                                  padding=layer.padding, groups=layer.groups, dilation=layer.dilation)
                         if self.ordered else layer(data[0]))
            elif op == "InnerProduct":
                value = self.layers[str(index)](data[0].flatten(1))[:, :, None, None]
            elif op == "Eltwise":
                value = data[0] + data[1]
            elif op == "Concat":
                value = torch.cat(data, dim=1)
            elif op == "Shuffle":
                n, c, h, w = self.shapes[target]
                # The audited native shuffle interleaves four-channel blocks, not individual channels.
                value = data[0].reshape(n, 2, c // 8, 4, h, w).transpose(1, 2).reshape(n, c, h, w)
            elif op == "UpSampling":
                value = self.upsample(value=data[0], mode=params["mode"])
            elif op == "Tanh":
                value = self.ordered_tanh(value=data[0]) if self.ordered else data[0].tanh()
            elif op == "Sigmoid":
                value = self.pinned_sigmoid(data[0]) if self.ordered else torch.sigmoid(data[0])
            elif op == "SEScale":
                value = data[0] * data[1]
            elif op == "Upsample":
                value = (separable_bilinear(value=data[0], size=params["size"]) if self.ordered
                         else F.interpolate(data[0], size=params["size"], mode="bilinear", align_corners=False))
            elif op == "PoolingDown":
                value = data[0].mean((2, 3), keepdim=True) if params["global"] else F.avg_pool2d(data[0], 2, 2)
            elif op == "Pooling":
                value = F.max_pool2d(data[0], 2, 2)
            elif op == "Slice":
                value, values[params["extra"]] = data[0][:, :params["split"]], data[0][:, params["split"]:]
            elif op == "OnnxOp2":
                value = data[0] * data[1]
            elif op == "OnnxOp1" and params.get("reduce"):
                value = channel_sum(value=data[0], ordered=self.ordered)
            elif op == "OnnxOp1":
                value = data[0]
            else:
                raise ValueError("unsupported execution step")
            if params.get("relu"):
                value = value.relu()
            values[target] = value
        result = {k: values[k] for k in self.output_shapes}
        if any(not torch.isfinite(v).all() for v in result.values()):
            raise ValueError("nonfinite vision outputs")
        return values if capture else result


def load_model(*, path, expected_sha256=None, allow_unverified=False):
    if type(allow_unverified) is not bool:
        raise ValueError("allow_unverified must be an explicit boolean")
    path = Path(path)
    limit = 64 * 1024 * 1024
    with path.open("rb") as stream:
        payload = stream.read(limit + 1)
    if not 0 < len(payload) <= limit:
        raise ValueError("invalid vision bundle size")
    if expected_sha256 is not None and digest(data=payload) != expected_sha256:
        raise ValueError("vision artifact hash mismatch")
    bundle = torch.load(io.BytesIO(payload), weights_only=True, map_location="cpu")
    if not isinstance(bundle, dict) or bundle.get("format") != FORMAT or bundle.get("local_only") is not True:
        raise ValueError("invalid vision bundle format")
    profile_name = bundle.get("profile")
    profile = PROFILES.get(profile_name) if isinstance(profile_name, str) else None
    if profile is None or any(bundle.get(key) != profile[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")):
        raise ValueError("unsupported source provenance")
    if bundle.get("runtime_sha256") != RUNTIME_SHA256 or bundle.get("execution_profile") != execution_profile(profile=profile):
        raise ValueError("unsupported execution profile")
    text = bundle.get("graph_text")
    if not isinstance(text, str) or digest(data=text.encode()) != profile["graph_sha256"]:
        raise ValueError("vision graph hash mismatch")
    if (bundle.get("verification_status") != "native-parity-passed" or profile.get("native_verified") is not True) and not allow_unverified:
        raise ValueError("vision candidate is not native verified")
    actual_state_sha = state_digest(state=bundle.get("state_dict"))
    if actual_state_sha != bundle.get("state_sha256") or actual_state_sha != profile.get("state_sha256"):
        raise ValueError("vision state digest mismatch")
    model = VisionGraph(nodes=parse_graph(text=text), ordered=ordered_execution(profile=profile))
    if model.input_shapes != profile_input_shapes(profile=profile) or model.output_shapes != {k: tuple(v) for k, v in profile["outputs"].items()}:
        raise ValueError("vision schema mismatch")
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.eval()
