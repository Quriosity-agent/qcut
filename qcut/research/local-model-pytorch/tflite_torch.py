"""Pure PyTorch inference for a bounded, validated float TFLite graph."""

from collections import Counter
from copy import deepcopy
import math

import torch
from torch import nn
from torch.nn import functional as F

from tflite_schema import OPTIONS, VERSIONS


SUPPORTED = set(OPTIONS)


def activate(*, value: torch.Tensor, kind: int) -> torch.Tensor:
    if kind == 0:
        return value
    if kind == 1:
        return value.relu()
    if kind == 3:
        return value.clamp(0, 6)
    raise ValueError(f"Unsupported fused activation: {kind}")


def same_padding(
    *, size: int, kernel: int, stride: int, dilation: int = 1
) -> tuple[int, int]:
    total = max(
        0, (math.ceil(size / stride) - 1) * stride + (kernel - 1) * dilation + 1 - size
    )
    return total // 2, total - total // 2


def resize(
    *,
    value: torch.Tensor,
    size: tuple[int, int],
    nearest: bool,
    align: bool,
    half: bool,
) -> torch.Tensor:
    if align and half:
        raise ValueError("align_corners and half_pixel_centers cannot both be true")
    if len(size) != 2 or min(size) < 1:
        raise ValueError("Invalid resize dimensions")
    coordinates = []
    for old, new in zip(value.shape[1:3], size):
        scale = (old - 1) / (new - 1) if align and new > 1 else old / new
        positions = torch.arange(new, dtype=value.dtype, device=value.device)
        positions = (positions + (0.5 if half else 0)) * scale
        if not nearest and half:
            positions = positions - 0.5
        coordinates.append(positions.clamp(0, old - 1))
    y, x = coordinates
    if nearest:
        # TFLite nearest uses floor except for align_corners, which rounds up at .5.
        yi = torch.floor(y + (0.5 if align else 0)).long()
        xi = torch.floor(x + (0.5 if align else 0)).long()
        return value[:, yi[:, None], xi[None, :], :]
    y0, x0 = y.floor().long(), x.floor().long()
    y1, x1 = (y0 + 1).clamp(max=value.shape[1] - 1), (x0 + 1).clamp(
        max=value.shape[2] - 1
    )
    dy, dx = (y - y0)[None, :, None, None], (x - x0)[None, None, :, None]
    top = (
        value[:, y0[:, None], x0[None, :], :] * (1 - dx)
        + value[:, y0[:, None], x1[None, :], :] * dx
    )
    bottom = (
        value[:, y1[:, None], x0[None, :], :] * (1 - dx)
        + value[:, y1[:, None], x1[None, :], :] * dx
    )
    return top * (1 - dy) + bottom * dy


def execute(*, operator: dict, values: list[torch.Tensor]) -> torch.Tensor:
    name, options = operator["type"], operator["options"]
    value = values[0]
    if name in {"CONV_2D", "DEPTHWISE_CONV_2D"}:
        weight, bias = values[1:]
        value = value.permute(0, 3, 1, 2)
        depthwise = name == "DEPTHWISE_CONV_2D"
        groups = value.shape[1] if depthwise else 1
        if depthwise and (
            weight.shape[0] != 1
            or weight.shape[-1] != groups * options["DepthMultiplier"]
        ):
            raise ValueError("Invalid depthwise channel multiplier")
        weight = weight.permute(3, 0, 1, 2) if depthwise else weight.permute(0, 3, 1, 2)
        stride = (options["StrideH"], options["StrideW"])
        dilation = (options["DilationHFactor"], options["DilationWFactor"])
        if options["Padding"] == 0:
            top, bottom = same_padding(
                size=value.shape[2],
                kernel=weight.shape[2],
                stride=stride[0],
                dilation=dilation[0],
            )
            left, right = same_padding(
                size=value.shape[3],
                kernel=weight.shape[3],
                stride=stride[1],
                dilation=dilation[1],
            )
            value = F.pad(value, (left, right, top, bottom))
        result = F.conv2d(
            value, weight, bias, stride=stride, dilation=dilation, groups=groups
        )
        return activate(value=result, kind=options["FusedActivationFunction"]).permute(
            0, 2, 3, 1
        )
    if name == "TRANSPOSE_CONV":
        shape, weight, source, bias = values
        shape = [int(item) for item in shape.tolist()]
        result = F.conv_transpose2d(
            source.permute(0, 3, 1, 2),
            weight.permute(3, 0, 1, 2),
            bias,
            stride=(options["StrideH"], options["StrideW"]),
        )
        dh, dw = result.shape[2] - shape[1], result.shape[3] - shape[2]
        if dh < 0 or dw < 0 or (options["Padding"] == 1 and (dh or dw)):
            raise ValueError("Unsupported transpose convolution output padding")
        result = result[
            :, :, dh // 2 : dh // 2 + shape[1], dw // 2 : dw // 2 + shape[2]
        ]
        return activate(value=result, kind=options["FusedActivationFunction"]).permute(
            0, 2, 3, 1
        )
    if name in {"ADD", "MUL"}:
        result = value + values[1] if name == "ADD" else value * values[1]
        return activate(value=result, kind=options["FusedActivationFunction"])
    if name == "RESHAPE":
        return value.reshape(tuple(int(item) for item in values[1].tolist()))
    if name == "TRANSPOSE":
        return value.permute(tuple(int(item) for item in values[1].tolist()))
    if name == "SOFTMAX":
        return (value * options["Beta"]).softmax(dim=-1)
    if name == "SUM":
        raw_axes = [int(item) for item in values[1].reshape(-1).tolist()]
        if any(axis < -value.ndim or axis >= value.ndim for axis in raw_axes):
            raise ValueError("Reduction axis out of bounds")
        axes = tuple(sorted({axis % value.ndim for axis in raw_axes}))
        return value.sum(dim=axes, keepdim=options["KeepDims"])
    if name.startswith("RESIZE_"):
        return resize(
            value=value,
            size=tuple(int(item) for item in values[1].tolist()),
            nearest=name == "RESIZE_NEAREST_NEIGHBOR",
            align=options["AlignCorners"],
            half=options["HalfPixelCenters"],
        )
    raise ValueError(f"Unsupported operator: {name}")


class TFLiteTorch(nn.Module):
    def __init__(self, *, bundle: dict):
        super().__init__()
        if (
            bundle.get("format") != "qcut-bounded-tflite-pytorch"
            or bundle.get("version") != 1
        ):
            raise ValueError("Unsupported bundle format/version")
        self.graph = deepcopy(
            {key: value for key, value in bundle.items() if key != "constants"}
        )
        self.tensors = self.graph["tensors"]
        if not 0 < len(self.tensors) <= 4096 or len(self.graph["operators"]) > 2048:
            raise ValueError("Graph exceeds supported bounds")
        for spec in self.tensors:
            shape = spec["shape"]
            if (
                spec["dtype"] not in {"float32", "int32"}
                or len(shape) > 6
                or any(not isinstance(dim, int) or dim <= 0 for dim in shape)
                or math.prod(shape) > 32_000_000
            ):
                raise ValueError("Invalid tensor specification")
        if (
            len(self.graph["inputs"]) != 1
            or len(self.graph["outputs"]) != 1
            or any(
                not 0 <= index < len(self.tensors)
                for index in self.graph["inputs"] + self.graph["outputs"]
            )
        ):
            raise ValueError("Exactly one valid input and output required")
        self.constant_ids = []
        for key, constant in bundle["constants"].items():
            index = int(key)
            self._check_tensor(index=index, value=constant)
            if not torch.isfinite(constant).all():
                raise ValueError("Non-finite constant")
            self.register_buffer(f"tensor_{index}", constant.detach().clone())
            self.constant_ids.append(index)
        available = set(self.constant_ids)
        if available.intersection(self.graph["inputs"]):
            raise ValueError("Input overlaps constant")
        available.update(self.graph["inputs"])
        self.uses = Counter(self.graph["outputs"])
        arities = {
            "CONV_2D": 3,
            "DEPTHWISE_CONV_2D": 3,
            "TRANSPOSE_CONV": 4,
            "SOFTMAX": 1,
        }
        for operator in self.graph["operators"]:
            name = operator["type"]
            if (
                name not in SUPPORTED
                or len(operator["inputs"]) != arities.get(name, 2)
                or len(operator["outputs"]) != 1
            ):
                raise ValueError("Unsupported operator/arity")
            if any(index not in available for index in operator["inputs"]):
                raise ValueError("Missing dependency or optional tensor")
            output = operator["outputs"][0]
            if output in available or not 0 <= output < len(self.tensors):
                raise ValueError("Invalid output or duplicate producer")
            options = operator["options"]
            if operator["version"] not in VERSIONS[name] or set(options) != set(
                OPTIONS[name][1]
            ):
                raise ValueError("Unsupported operator version/options")
            if options.get("Padding", 0) not in {0, 1} or options.get(
                "FusedActivationFunction", 0
            ) not in {0, 1, 3}:
                raise ValueError("Unsupported padding/activation")
            if options.get("QuantizedBiasType", 0) != 0:
                raise ValueError("Quantized bias unsupported")
            if any(
                options.get(key, 1) <= 0
                for key in (
                    "StrideH",
                    "StrideW",
                    "DilationHFactor",
                    "DilationWFactor",
                    "DepthMultiplier",
                )
            ):
                raise ValueError("Invalid convolution geometry")
            available.add(output)
            self.uses.update(operator["inputs"])
        if (
            not self.graph["inputs"]
            or not self.graph["outputs"]
            or any(index not in available for index in self.graph["outputs"])
        ):
            raise ValueError("Invalid model I/O")

    def _check_tensor(self, *, index: int, value: torch.Tensor):
        if not 0 <= index < len(self.tensors):
            raise ValueError("Tensor index out of bounds")
        spec = self.tensors[index]
        dtype = {"float32": torch.float32, "int32": torch.int32}.get(spec["dtype"])
        if list(value.shape) != spec["shape"] or value.dtype != dtype:
            raise ValueError(f"Tensor shape/dtype mismatch: {index}")

    def forward(self, value: torch.Tensor, *, capture: bool = False):
        if len(self.graph["inputs"]) != 1:
            raise ValueError("This runner requires exactly one input")
        index = self.graph["inputs"][0]
        self._check_tensor(index=index, value=value)
        if not torch.isfinite(value).all():
            raise ValueError("Non-finite input")
        values = {
            index: getattr(self, f"tensor_{index}") for index in self.constant_ids
        }
        values[index] = value
        remaining = self.uses.copy()
        for operator in self.graph["operators"]:
            result = execute(
                operator=operator,
                values=[values[index] for index in operator["inputs"]],
            )
            index = operator["outputs"][0]
            self._check_tensor(index=index, value=result)
            values[index] = result
            if not capture:
                for source in operator["inputs"]:
                    remaining[source] -= 1
                    if remaining[source] == 0:
                        values.pop(source, None)
        return values if capture else values[self.graph["outputs"][0]]

    def export_bundle(self) -> dict:
        return {
            **deepcopy(self.graph),
            "constants": {
                str(index): getattr(self, f"tensor_{index}").detach().cpu().clone()
                for index in self.constant_ids
            },
        }


def load_model(*, path) -> TFLiteTorch:
    return TFLiteTorch(
        bundle=torch.load(path, map_location="cpu", weights_only=True)
    ).eval()
