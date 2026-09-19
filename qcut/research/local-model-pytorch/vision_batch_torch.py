"""Strict FP32 vision graph interpreter; no runtime or private source reads."""
import hashlib
import io
import math
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from vision_batch_profiles import EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256


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
    if rows and rows[0] == ["D"]:
        rows = rows[1:]
    if (not rows or len(rows[0]) != 3 or not all(v.isdecimal() for v in rows[0])
            or rows[0][0] != "1" or not 1 <= int(rows[0][1]) <= 256
            or len(rows) != int(rows[0][1]) + 2):
        raise ValueError("unsupported header or layer count")
    return rows[1:]


class VisionGraph(nn.Module):
    def __init__(self, *, nodes, weights=None):
        super().__init__()
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
                if index or len(row) != 9 or row[6:] != ["4", "0", "0"]:
                    raise ValueError("unsupported input storage")
                n, h, w, c = map(int, row[2:6])
                if n != 1 or c != 3 or min(h, w) < 1 or max(h, w) > 512:
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
            elif op == "Tanh":
                if len(row) != 6 or row[4:] != ["4", "0"]:
                    raise ValueError("unsupported activation")
                inputs, target = [row[2]], row[3]
                shape = self._shape(name=inputs[0])
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
        if len(self.input_shapes) != 1 or not self.output_shapes:
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
            if op in {"Convolution", "DepthwiseSeparableConvolution"}:
                value = self.layers[str(index)](data[0])
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
                value = data[0].tanh()
            elif op == "PoolingDown":
                value = data[0].mean((2, 3), keepdim=True) if params["global"] else F.avg_pool2d(data[0], 2, 2)
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
    if bundle.get("runtime_sha256") != RUNTIME_SHA256 or bundle.get("execution_profile") != EXECUTION_PROFILE:
        raise ValueError("unsupported execution profile")
    text = bundle.get("graph_text")
    if not isinstance(text, str) or digest(data=text.encode()) != profile["graph_sha256"]:
        raise ValueError("vision graph hash mismatch")
    if (bundle.get("verification_status") != "native-parity-passed" or profile.get("native_verified") is not True) and not allow_unverified:
        raise ValueError("vision candidate is not native verified")
    actual_state_sha = state_digest(state=bundle.get("state_dict"))
    if actual_state_sha != bundle.get("state_sha256") or actual_state_sha != profile.get("state_sha256"):
        raise ValueError("vision state digest mismatch")
    model = VisionGraph(nodes=parse_graph(text=text))
    if model.input_shapes != {"data": tuple(profile["input_shape"])} or model.output_shapes != {k: tuple(v) for k, v in profile["outputs"].items()}:
        raise ValueError("vision schema mismatch")
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.eval()
