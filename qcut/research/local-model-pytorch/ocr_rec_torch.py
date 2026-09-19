"""Hash-pinned recognizer logits; legacy failed candidate stays opt-in."""
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

from ocr_torch import RUNTIME_SHA256
from ocr_rec_numeric import PinnedSigmoid, SpatialSum, ordered_convolution

FORMAT = "qcut-private-ocr-recognizer-logits-pytorch-v1"
FAILED_FORMAT = "qcut-private-ocr-recognizer-logits-pytorch-v2"
CANDIDATE_PROFILE = "ocr-rec-cpu-hard8-native-half-v2"
ORDERED_FAILED_FORMAT = "qcut-private-ocr-recognizer-logits-pytorch-v3"
ORDERED_PROFILE = "ocr-rec-cpu-hard8-ordered-fma-v3"
VALIDATED_FORMAT = "qcut-private-ocr-recognizer-logits-pytorch-v4"
EXECUTION_PROFILE = "ocr-rec-cpu-hard8-ordered-fma-pinned-sigmoid-v4"
LEGACY_PROFILE = "ocr-rec-candidate-relu6-v1"
STATE_SHA256 = "17914cad51bd7196ec36757feed130adb4025f8726183bd724235eb489759be7"
SOURCE_SHA256 = "d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac"
GRAPH_SHA256 = "b31162ff9592552f1084aa1f4522bd889d5184dbfe912f3cbc06e4a31675c11d"
INPUT_SHAPE = (1, 3, 32, 512)


def parse_graph(*, text):
    if not isinstance(text, str) or len(text) > 65536:
        raise ValueError("invalid recognizer graph")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if (len(rows) < 3 or rows[0] != ["E"] or len(rows[1]) != 3
            or not all(token.isdecimal() for token in rows[1]) or int(rows[1][0]) != 1
            or int(rows[1][1]) != len(rows) - 3 or not 1 <= len(rows) - 3 <= 512):
        raise ValueError("unsupported recognizer header")
    return rows[2:]


class OCRRecognizer(nn.Module):
    def __init__(self, *, nodes, weights=None, execution_profile=LEGACY_PROFILE):
        super().__init__()
        if execution_profile not in (LEGACY_PROFILE, CANDIDATE_PROFILE, ORDERED_PROFILE, EXECUTION_PROFILE):
            raise ValueError("unsupported recognizer execution profile")
        self.execution_profile = execution_profile
        self.sigmoid = PinnedSigmoid() if execution_profile == EXECUTION_PROFILE else nn.Sigmoid()
        self.reduction = SpatialSum(ordered=execution_profile in (ORDERED_PROFILE, EXECUTION_PROFILE))
        self.layers = nn.ModuleDict()
        self.constants = nn.ParameterDict()
        self.steps = []
        channels, consumed, cursor = {}, set(), 0
        if weights is not None and (weights.dtype != np.float32 or weights.ndim != 1 or not np.isfinite(weights).all()):
            raise ValueError("invalid recognizer weight vector")
        for index, row in enumerate(nodes):
            if not isinstance(row, list) or len(row) < 2 or not all(isinstance(token, str) for token in row):
                raise ValueError("invalid recognizer row")
            kind, name = row[:2]
            inputs, config = [], {}
            if kind == "DataV2":
                if index != 0 or row[2:] != ["1", "32", "512", "3", "4", "0", "0"]:
                    raise ValueError("unsupported recognizer input")
                target, cout = name, 3
                self.input_name = name
            elif kind in {"Convolution", "DepthwiseSeparableConvolution"}:
                if len(row) != 19 or row[11:17] != ["4", "0"] * 3:
                    raise ValueError("unsupported recognizer convolution storage")
                cout, kh, kw, sh, sw, ph, pw, bias, activation = map(int, row[2:11])
                if (not 1 <= cout <= 11000 or kh not in (1, 3, 5) or kw not in (1, 3, 5, 15)
                        or sh not in (1, 2) or sw not in (1, 2) or (ph, pw) != (kh // 2, kw // 2)
                        or bias != 1 or activation not in (0, 1, 2)):
                    raise ValueError("unsupported recognizer convolution semantics")
                inputs, target = [row[17]], row[18]
                if inputs[0] not in channels:
                    raise ValueError("missing convolution input")
                cin = channels[inputs[0]]
                depthwise = kind == "DepthwiseSeparableConvolution"
                if depthwise and cin != cout:
                    raise ValueError("unsupported depth multiplier")
                count = kh * kw * cout * (1 if depthwise else cin)
                if cursor + count + cout > 16 * 1024 * 1024:
                    raise ValueError("recognizer parameter bound exceeded")
                conv = nn.Conv2d(cin, cout, (kh, kw), (sh, sw), (ph, pw), groups=cin if depthwise else 1)
                if weights is not None:
                    values = weights[cursor:cursor + count + cout]
                    if len(values) != count + cout:
                        raise ValueError("truncated recognizer arena")
                    kernel = torch.from_numpy(values[:count].copy())
                    kernel = (kernel.reshape(kh, kw, cout).permute(2, 0, 1).unsqueeze(1) if depthwise
                              else kernel.reshape(cout, kh, kw, cin).permute(0, 3, 1, 2))
                    with torch.no_grad():
                        conv.weight.copy_(kernel)
                        conv.bias.copy_(torch.from_numpy(values[count:].copy()))
                cursor += count + cout
                self.layers[str(index)] = conv
                config["activation"] = activation
            elif kind == "Constant":
                if len(row) != 10 or row[2:7] != ["0", "1", "1", "1", "1"] or row[8:] != ["4", "0"]:
                    raise ValueError("unsupported recognizer constant")
                target, cout = row[7], 1
                if weights is not None and cursor >= len(weights):
                    raise ValueError("truncated recognizer constant")
                value = 1.0 if weights is None else float(weights[cursor])
                if value <= 0:
                    raise ValueError("expected positive pooling divisor")
                self.constants[str(index)] = nn.Parameter(torch.tensor(value).reshape(1, 1, 1, 1), requires_grad=False)
                cursor += 1
            elif kind == "Concat":
                if len(row) != 8 or row[2] != "2" or row[6:] != ["4", "0"]:
                    raise ValueError("unsupported recognizer concat")
                inputs, target = row[3:5], row[5]
                cout = sum(channels.get(key, 0) for key in inputs)
            elif kind == "OnnxOp1":
                if len(row) != 11 or row[2] != "ReduceSum" or row[5:] != ["4", "0", "2", "2", "3", "1"]:
                    raise ValueError("unsupported recognizer reduction")
                inputs, target = [row[3]], row[4]
                cout = channels.get(inputs[0])
            elif kind == "OnnxOp2":
                if len(row) != 8 or row[2] not in {"Div", "Mul"} or row[6:] != ["4", "0"]:
                    raise ValueError("unsupported recognizer binary op")
                inputs, target = row[3:5], row[5]
                cout = channels.get(inputs[0])
                config["op"] = row[2]
            elif kind in {"Eltwise", "SEScale"}:
                if len(row) != 8 or row[5:] != ["4", "0", "0"]:
                    raise ValueError("unsupported residual/scale")
                inputs, target = row[2:4], row[4]
                cout = channels.get(inputs[0])
                if channels.get(inputs[1]) != cout:
                    raise ValueError("channel mismatch")
            elif kind == "PoolingDown":
                if len(row) != 13 or row[2:11] != ["2", "2", "2", "2", "0", "0", "4", "0", "AVE"]:
                    raise ValueError("unsupported recognizer pooling")
                inputs, target = [row[11]], row[12]
                cout = channels.get(inputs[0])
            elif kind == "UpSampling":
                if len(row) != 5 or row[4] != "NEAREST":
                    raise ValueError("unsupported recognizer resize")
                inputs, target = [row[2]], row[3]
                cout = channels.get(inputs[0])
            elif kind == "Sigmoid":
                if len(row) != 6 or row[4:] != ["4", "0"]:
                    raise ValueError("unsupported recognizer activation")
                inputs, target = [row[2]], row[3]
                cout = channels.get(inputs[0])
            else:
                raise ValueError(f"unsupported recognizer operator: {kind}")
            if target in channels or cout is None or any(key not in channels for key in inputs):
                raise ValueError("invalid recognizer topology")
            channels[target] = cout
            consumed.update(inputs)
            self.steps.append({"kind": kind, "inputs": inputs, "output": target, "config": config})
        self.outputs = [name for name in channels if name not in consumed]
        if not self.outputs or not hasattr(self, "input_name"):
            raise ValueError("empty recognizer")
        self.parameter_count = cursor
        if weights is not None and cursor != len(weights):
            raise ValueError("unconsumed recognizer arena")

    def forward(self, inputs, *, trace=False):
        if not isinstance(inputs, dict) or set(inputs) != {self.input_name}:
            raise ValueError("exact recognizer input required")
        value = inputs[self.input_name]
        if (not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or value.device.type != "cpu"
                or tuple(value.shape) != INPUT_SHAPE or not torch.isfinite(value).all()):
            raise ValueError("expected finite CPU float32 [1,3,32,512]")
        values = dict(inputs)
        for index, step in enumerate(self.steps):
            kind, target = step["kind"], step["output"]
            tensors = [values[key] for key in step["inputs"]]
            if kind == "DataV2":
                continue
            if kind in {"Convolution", "DepthwiseSeparableConvolution"}:
                layer = self.layers[str(index)]
                if self.execution_profile in (ORDERED_PROFILE, EXECUTION_PROFILE):
                    value = ordered_convolution(value=tensors[0], weight=layer.weight, bias=layer.bias,
                                                stride=layer.stride, padding=layer.padding, groups=layer.groups)
                else:
                    value = layer(tensors[0])
                activation = step["config"]["activation"]
                if activation:
                    if activation == 1:
                        value = value.relu()
                    elif self.execution_profile != LEGACY_PROFILE:
                        value = (value + 4.0).clamp(0, 8) / 8.0
                    else:
                        value = value.clamp(0, 6)
            elif kind == "Constant":
                value = self.constants[str(index)]
            elif kind == "Concat":
                value = torch.cat(tensors, dim=1)
            elif kind == "OnnxOp1":
                value = self.reduction(tensors[0])
            elif kind == "OnnxOp2":
                if step["config"]["op"] == "Div":
                    if tensors[1].numel() != 1 or not torch.all(tensors[1] > 0):
                        raise ValueError("invalid scalar divisor")
                    value = tensors[0] / tensors[1]
                else:
                    if tensors[0].shape != tensors[1].shape:
                        raise ValueError("unsupported multiply broadcasting")
                    value = tensors[0] * tensors[1]
            elif kind == "SEScale":
                if tensors[1].shape != tensors[0].shape[:2] + (1, 1):
                    raise ValueError("invalid squeeze/excitation gate shape")
                value = tensors[0] * tensors[1]
            elif kind == "Eltwise":
                if tensors[0].shape != tensors[1].shape:
                    raise ValueError("residual shape mismatch")
                value = tensors[0] + tensors[1]
            elif kind == "PoolingDown":
                value = F.avg_pool2d(tensors[0], 2, 2)
            elif kind == "UpSampling":
                value = F.interpolate(tensors[0], scale_factor=2, mode="nearest")
            elif kind == "Sigmoid":
                value = self.sigmoid(tensors[0])
            else:
                raise ValueError("unsupported recognizer execution")
            if not torch.isfinite(value).all():
                raise ValueError(f"nonfinite recognizer output: {target}")
            values[target] = value
        return values if trace else {key: values[key] for key in self.outputs}


def state_digest(*, state):
    checksum = hashlib.sha256()
    for name in sorted(state):
        value = state[name]
        checksum.update(json.dumps([name, list(value.shape), str(value.dtype)], separators=(",", ":")).encode())
        checksum.update(b"\0")
        checksum.update(value.detach().cpu().contiguous().numpy().astype("<f4", copy=False).tobytes())
    return checksum.hexdigest()


def _restore(*, path, expected_sha256, format_name, execution_profile):
    path = Path(path)
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("oversized recognizer bundle")
    if expected_sha256 is not None and hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("recognizer artifact hash mismatch")
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    if (not isinstance(bundle, dict) or bundle.get("format") != format_name or bundle.get("source_sha256") != SOURCE_SHA256
            or bundle.get("runtime_sha256") != RUNTIME_SHA256 or bundle.get("local_only") is not True
            or not isinstance(bundle.get("graph"), str) or hashlib.sha256(bundle["graph"].encode()).hexdigest() != GRAPH_SHA256):
        raise ValueError("unsupported recognizer provenance")
    if format_name != FORMAT and bundle.get("execution_profile") != execution_profile:
        raise ValueError("recognizer execution profile mismatch")
    model = OCRRecognizer(nodes=parse_graph(text=bundle["graph"]), execution_profile=execution_profile)
    if not isinstance(bundle.get("state_dict"), dict) or any(not isinstance(key, str) for key in bundle["state_dict"]) or any(
            not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or not torch.isfinite(value).all()
            for value in bundle["state_dict"].values()):
        raise ValueError("invalid recognizer state")
    if format_name != FORMAT and state_digest(state=bundle["state_dict"]) != STATE_SHA256:
        raise ValueError("recognizer state hash mismatch")
    model.load_state_dict(bundle["state_dict"], strict=True)
    if any(not torch.all(value > 0) for value in model.constants.values()):
        raise ValueError("invalid recognizer divisors")
    return model.cpu().eval()


def load_model(*, path, expected_sha256=None, allow_unverified=False):
    if allow_unverified is not True:
        raise ValueError("recognizer candidate failed native parity; explicit allow_unverified=True is required for research")
    return _restore(path=path, expected_sha256=expected_sha256, format_name=FORMAT, execution_profile=LEGACY_PROFILE)


def load_validated_model(*, path, expected_sha256=None):
    return _restore(path=path, expected_sha256=expected_sha256,
                    format_name=VALIDATED_FORMAT, execution_profile=EXECUTION_PROFILE)


def load_candidate_model(*, path, expected_sha256=None, allow_unverified=False, ordered=False):
    if allow_unverified is not True:
        raise ValueError("hard8-only recognizer failed native parity; explicit research opt-in required")
    return _restore(path=path, expected_sha256=expected_sha256,
                    format_name=ORDERED_FAILED_FORMAT if ordered else FAILED_FORMAT,
                    execution_profile=ORDERED_PROFILE if ordered else CANDIDATE_PROFILE)
