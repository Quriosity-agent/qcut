"""Strict, local-only CPU evaluator for two hash-pinned embedded classifiers."""
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

FORMAT = "qcut-private-classifier-pytorch-v1"
EXECUTION_PROFILE = "classifier-cpu-hard8-ohwi-hwc-v1"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"
PROFILES = {
    "c73": {
        "source_sha256": "20e49208c0ac7f2b167d3ea1024966f1418fd35bfae7fbb3fd2f8b000287d1cf",
        "bm_sha256": "0062d0feb383ba8b3f6c883ec5028c130e16cf404d74857ad46b55e55754c099",
        "graph_sha256": "930274596b824174b5f5575b9102b11bedc9192b4242a549fbaa3beda34f051e",
        "source_filename": "c73_v1.0_size0_md5726b5931800d3f3599ebf4cf617a229d.model",
        "output_name": "Sigmoid_271", "output_channels": 73,
        "state_sha256": "dfd8c338b3f612eadbdf4ae37ed7725937ec5819cf1dd660b59485db7e3d9c85",
    },
    "dance": {
        "source_sha256": "ca436a5031aa853aa2becd1690e221c77278f84b6d54198485fe2a624e738565",
        "bm_sha256": "063ac20a5dbe020541e503b3d57d3db9116fd0cf4ed97e254958571a8daab820",
        "graph_sha256": "2e314c0e6fd4e8362e819caae61ebf6293a95c5adab59da48ae13e6a06b57a4f",
        "source_filename": "dance_detection_js_v1.0_size0_md5dc53a9d99f63bcbfd576d99f7db7ac17.model",
        "output_name": "Div_275", "output_channels": 1,
        "state_sha256": "06a144561b0adb1add716d971e07bb6c9b3ee9b924b75c03787062d8b751be48",
    },
}


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def state_digest(*, state):
    checksum = hashlib.sha256()
    for name in sorted(state):
        value = state[name]
        checksum.update(json.dumps([name, list(value.shape), str(value.dtype)], separators=(",", ":")).encode())
        checksum.update(b"\0")
        checksum.update(value.detach().cpu().contiguous().numpy().astype("<f4", copy=False).tobytes())
    return checksum.hexdigest()


def parse_spec(*, text, profile):
    expected = PROFILES[profile]
    if digest(data=text.encode("ascii")) != expected["graph_sha256"]:
        raise ValueError("unrecognized classifier graph hash")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if rows[0] != ["D"] or rows[1][:2] != ["1", "118"] or len(rows[1]) != 3 or len(rows) != 121:
        raise ValueError("unsupported classifier graph header")
    return rows[2:]


def hard_sigmoid(*, value):
    # Both audited graphs encode divisor 8, including fused SE activations.
    return torch.clamp(value + 4.0, 0.0, 8.0) / 8.0


def fused_activation(*, value, mode):
    if mode == "0":
        return value
    if mode == "1":
        return value.relu()
    if mode == "2":
        return hard_sigmoid(value=value)
    raise ValueError("unsupported fused activation")


class ClassifierGraph(nn.Module):
    def __init__(self, *, nodes, weights=None):
        super().__init__()
        if not isinstance(nodes, list) or not 2 <= len(nodes) <= 119:
            raise ValueError("invalid classifier node count")
        if weights is not None and (weights.dtype != np.float32 or weights.ndim != 1 or not np.isfinite(weights).all()):
            raise ValueError("expected finite float32 weight arena")
        self.nodes = [list(row) for row in nodes]
        self.layers = nn.ModuleDict()
        self.constants = nn.ParameterDict()
        self.shapes, self.inputs, self.routes = {}, {}, []
        consumed, names, cursor = set(), set(), 0
        for index, row in enumerate(self.nodes):
            if len(row) < 2 or any(not isinstance(value, str) or not value for value in row):
                raise ValueError("invalid classifier node")
            op, name = row[:2]
            if name in names:
                raise ValueError("duplicate layer name")
            names.add(name)
            inputs, output, shape, count, layer = [], None, None, 0, None
            if op == "DataV2":
                if len(row) != 9 or row[2:] != ["1", "224", "224", "3", "4", "0", "0"] or self.inputs:
                    raise ValueError("unsupported classifier input")
                output, shape = name, (1, 3, 224, 224)
                self.inputs[name] = shape
            elif op in {"Convolution", "DepthwiseSeparableConvolution"}:
                if len(row) != 19 or row[11:17] != ["4", "0"] * 3:
                    raise ValueError("unsupported convolution fields")
                co, kh, kw, sh, sw, ph, pw, bias, activation = map(int, row[2:11])
                if (not 1 <= co <= 576 or kh != kw or kh not in (1, 3, 5) or sh != sw or sh not in (1, 2)
                        or ph != pw or ph != kh // 2 or bias != 1 or activation not in (0, 1, 2)):
                    raise ValueError("unsupported convolution semantics")
                inputs, output = [row[17]], row[18]
                n, ci, hi, wi = self._shape(name=inputs[0])
                groups = ci if op == "DepthwiseSeparableConvolution" else 1
                if op == "DepthwiseSeparableConvolution" and co != ci:
                    raise ValueError("unsupported depthwise multiplier")
                layer = nn.Conv2d(ci, co, kh, sh, ph, groups=groups)
                shape = (n, co, (hi + 2 * ph - kh) // sh + 1, (wi + 2 * pw - kw) // sw + 1)
                count = co * (ci // groups) * kh * kw + co
                if weights is not None:
                    values = self._slice(weights=weights, cursor=cursor, count=count)
                    with torch.no_grad():
                        if op == "DepthwiseSeparableConvolution":
                            kernel = torch.from_numpy(values[:-co].copy()).reshape(kh, kw, co).permute(2, 0, 1).unsqueeze(1)
                        else:
                            kernel = torch.from_numpy(values[:-co].copy()).reshape(co, kh, kw, ci).permute(0, 3, 1, 2)
                        layer.weight.copy_(kernel)
                        layer.bias.copy_(torch.from_numpy(values[-co:].copy()))
            elif op in {"ReluHardSwish", "ReluHardSigmoid", "Sigmoid"}:
                suffix = ["4", "0"] if op == "Sigmoid" else ["4", "0", "8", "0"]
                if len(row) != 4 + len(suffix) or row[4:] != suffix:
                    raise ValueError("unsupported activation fields")
                inputs, output = [row[2]], row[3]
                shape = self._shape(name=inputs[0])
            elif op == "Constant":
                if len(row) != 10 or row[2:7] != ["0", "1", "1", "1", "1"] or row[8:] != ["4", "0"]:
                    raise ValueError("unsupported scalar constant")
                output, shape, count = row[7], (1, 1, 1, 1), 1
                value = 0.0 if weights is None else float(self._slice(weights=weights, cursor=cursor, count=1)[0])
                self.constants[str(index)] = nn.Parameter(torch.tensor(value, dtype=torch.float32), requires_grad=False)
            elif op == "OnnxOp1":
                if len(row) != 11 and len(row) != 12:
                    raise ValueError("unsupported unary fields")
                inputs, output = [row[3]], row[4]
                n, ci, hi, wi = self._shape(name=inputs[0])
                if row[2] == "ReduceSum" and row[5:] == ["4", "0", "2", "2", "3", "1"]:
                    shape = (n, ci, 1, 1)
                elif row[2] == "Reshape" and row[5:] == ["4", "0", "1", "1", "1", "576", "2"] and (ci, hi, wi) == (576, 1, 1):
                    shape = (n, ci, 1, 1)
                else:
                    raise ValueError("unsupported reduction or reshape")
            elif op == "OnnxOp2":
                if len(row) != 8 or row[2] != "Div" or row[6:] != ["4", "0"]:
                    raise ValueError("unsupported binary operation")
                inputs, output = row[3:5], row[5]
                shape = self._shape(name=inputs[0])
                if self._shape(name=inputs[1]) != (1, 1, 1, 1):
                    raise ValueError("division requires scalar denominator")
            elif op in {"SEScale", "Eltwise"}:
                if len(row) != 8 or row[5:] != ["4", "0", "0"]:
                    raise ValueError("unsupported scale or residual fields")
                inputs, output = row[2:4], row[4]
                shape = self._shape(name=inputs[0])
                other = self._shape(name=inputs[1])
                if other != (shape if op == "Eltwise" else (shape[0], shape[1], 1, 1)):
                    raise ValueError("invalid scale or residual shape")
            elif op == "PoolingDown":
                if len(row) != 14 or row[2:11] != ["7", "7", "1", "1", "0", "0", "4", "0", "AVE"] or row[13] != "GLOBAL":
                    raise ValueError("unsupported pooling fields")
                inputs, output = [row[11]], row[12]
                n, ci, hi, wi = self._shape(name=inputs[0])
                if (hi, wi) != (7, 7):
                    raise ValueError("unexpected global pool input")
                shape = (n, ci, 1, 1)
            elif op == "InnerProduct":
                if len(row) != 13 or row[3:11] != ["1", "0", "4", "0", "4", "0", "4", "0"]:
                    raise ValueError("unsupported dense fields")
                co = int(row[2])
                if co not in (1, 73, 1024):
                    raise ValueError("unsupported classifier dense width")
                inputs, output = [row[11]], row[12]
                n, ci, hi, wi = self._shape(name=inputs[0])
                if (hi, wi) != (1, 1):
                    raise ValueError("dense requires spatial singleton")
                layer, shape, count = nn.Linear(ci, co), (n, co, 1, 1), ci * co + co
                if weights is not None:
                    values = self._slice(weights=weights, cursor=cursor, count=count)
                    with torch.no_grad():
                        layer.weight.copy_(torch.from_numpy(values[:-co].copy()).reshape(co, ci))
                        layer.bias.copy_(torch.from_numpy(values[-co:].copy()))
            else:
                raise ValueError(f"unsupported classifier operator: {op}")
            if output in self.shapes or shape is None or min(shape) < 1:
                raise ValueError("duplicate output or invalid shape")
            self.shapes[output] = shape
            self.routes.append((inputs, output))
            consumed.update(inputs)
            if layer is not None:
                self.layers[str(index)] = layer
            cursor += count
        if not self.inputs:
            raise ValueError("missing classifier input")
        if weights is not None and len(weights) != cursor:
            raise ValueError(f"weight arena count mismatch: consumed {cursor}, provided {len(weights)}")
        self.parameter_count = cursor
        self.output_names = [name for name in self.shapes if name not in consumed]

    def _shape(self, *, name):
        if name not in self.shapes:
            raise ValueError(f"unknown or forward tensor reference: {name}")
        return self.shapes[name]

    @staticmethod
    def _slice(*, weights, cursor, count):
        values = weights[cursor:cursor + count]
        if len(values) != count:
            raise ValueError("truncated classifier weights")
        return values

    def forward(self, inputs, *, capture=False):
        if set(inputs) != set(self.inputs):
            raise ValueError("exact classifier input names required")
        for name, shape in self.inputs.items():
            value = inputs[name]
            if not isinstance(value, torch.Tensor) or value.device.type != "cpu" or value.dtype != torch.float32 or tuple(value.shape) != shape or not torch.isfinite(value).all():
                raise ValueError("expected finite CPU float32 NCHW input [1,3,224,224]")
        values = dict(inputs)
        for index, (row, route) in enumerate(zip(self.nodes, self.routes, strict=True)):
            op, (sources, output) = row[0], route
            if op == "DataV2":
                continue
            args = [values[name] for name in sources]
            if op in {"Convolution", "DepthwiseSeparableConvolution"}:
                value = fused_activation(value=self.layers[str(index)](args[0]), mode=row[10])
            elif op == "InnerProduct":
                value = self.layers[str(index)](args[0].flatten(1)).reshape(self.shapes[output])
            elif op == "ReluHardSwish":
                value = args[0] * hard_sigmoid(value=args[0])
            elif op == "ReluHardSigmoid":
                value = hard_sigmoid(value=args[0])
            elif op == "Sigmoid":
                value = args[0].sigmoid()
            elif op == "Constant":
                value = self.constants[str(index)].reshape(self.shapes[output])
            elif op == "OnnxOp1":
                value = args[0].sum(dim=(2, 3), keepdim=True) if row[2] == "ReduceSum" else args[0].reshape(self.shapes[output])
            elif op == "OnnxOp2":
                if torch.any(args[1] == 0):
                    raise ValueError("zero classifier divisor")
                value = args[0] / args[1]
            elif op == "SEScale":
                value = args[0] * args[1]
            elif op == "Eltwise":
                value = args[0] + args[1]
            elif op == "PoolingDown":
                value = F.avg_pool2d(args[0], kernel_size=(7, 7))
            else:
                raise ValueError(f"unsupported classifier operator: {op}")
            if tuple(value.shape) != self.shapes[output] or not torch.isfinite(value).all():
                raise ValueError(f"invalid classifier tensor: {output}")
            values[output] = value
        return values if capture else {name: values[name] for name in self.output_names}


def load_model(*, path, expected_sha256=None):
    path = Path(path)
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("oversized classifier bundle")
    if expected_sha256 is not None and digest(data=path.read_bytes()) != expected_sha256:
        raise ValueError("classifier artifact hash mismatch")
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    required = {"format", "profile", "source_sha256", "bm_sha256", "graph_sha256", "runtime_sha256",
                "local_only", "graph_text", "state_dict", "execution_profile"}
    if not isinstance(bundle, dict) or set(bundle) != required or bundle["format"] != FORMAT or bundle["local_only"] is not True or bundle["profile"] not in PROFILES:
        raise ValueError("unsupported classifier bundle")
    profile = PROFILES[bundle["profile"]]
    if any(bundle[key] != profile[key] for key in ("source_sha256", "bm_sha256", "graph_sha256")) or bundle["runtime_sha256"] != RUNTIME_SHA256:
        raise ValueError("classifier provenance mismatch")
    if bundle["execution_profile"] != EXECUTION_PROFILE:
        raise ValueError("unsupported classifier execution profile")
    nodes = parse_spec(text=bundle["graph_text"], profile=bundle["profile"])
    model = ClassifierGraph(nodes=nodes)
    state = bundle["state_dict"]
    if not isinstance(state, dict) or set(state) != set(model.state_dict()):
        raise ValueError("invalid classifier state keys")
    for name, expected in model.state_dict().items():
        value = state[name]
        if not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or value.layout != torch.strided or value.shape != expected.shape or not torch.isfinite(value).all():
            raise ValueError("invalid classifier state tensor")
    if state_digest(state=state) != profile["state_sha256"]:
        raise ValueError("classifier state content hash mismatch")
    model.load_state_dict(state, strict=True)
    if model.output_names != [profile["output_name"]] or model.shapes[profile["output_name"]] != (1, profile["output_channels"], 1, 1):
        raise ValueError("classifier output schema mismatch")
    return model.cpu().eval()
