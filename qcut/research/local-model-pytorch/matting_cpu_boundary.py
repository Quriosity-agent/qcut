"""Local arithmetic and bucket witnesses, never a network-parity verdict."""
from __future__ import annotations

import torch
from torch.nn import functional as F

from matting_cpu_export import compare
from matting_cpu_math import cpu_exp, fused, two_channel_softmax
from matting_torch import MattingGraph


def metrics(*, actual: torch.Tensor, expected: torch.Tensor) -> dict[str, object]:
    result = compare(actual=actual, expected=expected)
    if actual.shape == expected.shape and actual.dtype == expected.dtype == torch.float32:
        differing = actual.contiguous().view(torch.int32) != expected.contiguous().view(torch.int32)
        result.update(bitwise_equal=not bool(differing.any()), bitwise_differing_values=int(differing.sum()))
    return result


def teacher_forced(*, model: MattingGraph, native: dict[str, torch.Tensor],
                   propagated: dict[str, torch.Tensor]) -> list[dict[str, object]]:
    rows = []
    with torch.inference_mode():
        for index, node in enumerate(model.nodes):
            for name, local in model.evaluate_node(index=index, values=native).items():
                rows.append({"index": index, "operation": node[0], "tensor": name,
                             "propagated": metrics(actual=propagated[name], expected=native[name]),
                             "same_native_inputs": metrics(actual=local, expected=native[name])})
    return rows


def sequential_conv(*, value: torch.Tensor, conv: torch.nn.Conv2d,
                    spatial_major: bool, bias_first: bool, use_fma: bool) -> torch.Tensor:
    """Bounded scalar reduction experiment, not the selected model implementation."""
    if conv.groups != 1 or conv.dilation != (1, 1) or conv.bias is None:
        raise ValueError("experiment supports dense, biased, undilated convolution only")
    kh, kw = conv.kernel_size
    if conv.in_channels * kh * kw > 64:
        raise ValueError("diagnostic reduction is bounded to 64 terms")
    columns = F.unfold(value, conv.kernel_size, padding=conv.padding, stride=conv.stride)
    weights = conv.weight.flatten(1)
    order = (torch.arange(weights.shape[1]).reshape(conv.in_channels, kh, kw).permute(1, 2, 0).flatten().tolist()
             if spatial_major else list(range(weights.shape[1])))
    result = torch.zeros(value.shape[0], conv.out_channels, columns.shape[-1])
    bias = conv.bias.reshape(1, -1, 1)
    if bias_first:
        result = result + bias
    for index in order:
        a, b = columns[:, index:index + 1], weights[:, index].reshape(1, -1, 1)
        result = fused(a=a, b=b, c=result) if use_fma else result + a * b
    if not bias_first:
        result = result + bias
    height = (value.shape[2] + 2 * conv.padding[0] - kh) // conv.stride[0] + 1
    width = (value.shape[3] + 2 * conv.padding[1] - kw) // conv.stride[1] + 1
    return result.reshape(value.shape[0], conv.out_channels, height, width)


def convolution_profiles(*, model: MattingGraph, native: dict[str, torch.Tensor]) -> list[dict[str, object]]:
    eligible = [(index, node) for index, node in enumerate(model.nodes) if node[0] == "Convolution"]
    selected = (eligible[0], eligible[-1]) if len(eligible) > 1 else eligible
    rows = []
    with torch.inference_mode():
        for index, node in selected:
            conv, value, expected = model.convs[str(index)], native[node[17]], native[node[18]]
            variants = {
                "torch-contiguous": conv(value.contiguous()),
                "torch-channels-last": conv(value.contiguous(memory_format=torch.channels_last)),
                "float64-single-cast": F.conv2d(value.double(), conv.weight.double(), conv.bias.double(),
                                                stride=conv.stride, padding=conv.padding).float(),
            }
            for spatial in (False, True):
                for bias_first in (False, True):
                    for fma in (False, True):
                        name = f"{'spatial' if spatial else 'channel'}-major-bias-{'first' if bias_first else 'last'}-{'fma' if fma else 'mul-add'}"
                        variants[name] = sequential_conv(value=value, conv=conv, spatial_major=spatial,
                                                         bias_first=bias_first, use_fma=fma)
            rows.append({"index": index, "tensor": node[18], "input_tensor": node[17],
                         "profiles": {key: metrics(actual=F.relu(tensor) if node[10] == "1" else tensor,
                                                    expected=expected) for key, tensor in variants.items()}})
    return rows


def channels_last_experiment(*, model: MattingGraph, inputs: dict[str, torch.Tensor],
                             native: dict[str, torch.Tensor]) -> dict[str, object]:
    values = dict(inputs)
    local_layers = []
    with torch.inference_mode():
        for index, node in enumerate(model.nodes):
            if node[0] in {"Convolution", "DepthwiseSeparableConvolution"}:
                conv = model.convs[str(index)]
                actual = conv(values[node[17]].contiguous(memory_format=torch.channels_last))
                local = conv(native[node[17]].contiguous(memory_format=torch.channels_last))
                if node[10] == "1":
                    actual, local = F.relu(actual), F.relu(local)
                values[node[18]] = actual
                local_layers.append({"index": index, "operation": node[0], "tensor": node[18],
                                     **metrics(actual=local, expected=native[node[18]])})
                continue
            values.update(model.evaluate_node(index=index, values=values))
    return {"scope": "diagnostic input-layout experiment; unchanged weights; not persisted or selected by loader",
            "outputs": {name: metrics(actual=values[name], expected=native[name]) for name in model.output_shapes},
            "local_convolutions": local_layers,
            "first_local_bit_difference": next((row for row in local_layers if not row["bitwise_equal"]), None)}


def bucket_fields(*, logits: torch.Tensor) -> dict[str, torch.Tensor]:
    difference = logits[:, 1] - logits[:, 0]
    denominator = 1 + cpu_exp(value=difference)
    mantissa, exponent = torch.frexp(torch.where(torch.isinf(denominator), 1, denominator))
    return {"difference": difference, "denominator": denominator,
            "bucket": torch.floor(mantissa * 512).to(torch.int64), "exponent": exponent,
            "infinite": torch.isinf(denominator)}


def bucket_witnesses(*, actual_logits: torch.Tensor, native_logits: torch.Tensor,
                     native_probabilities: torch.Tensor, limit: int = 16) -> dict[str, object]:
    if (actual_logits.shape != native_logits.shape or native_probabilities.shape != native_logits.shape
            or type(limit) is not int or not 1 <= limit <= 64):
        raise ValueError("aligned logits/probabilities and a witness limit from 1 to 64 required")
    actual, isolated = two_channel_softmax(value=actual_logits), two_channel_softmax(value=native_logits)
    actual_fields, native_fields = bucket_fields(logits=actual_logits), bucket_fields(logits=native_logits)
    changed = ((actual_fields["bucket"] != native_fields["bucket"]) |
               (actual_fields["exponent"] != native_fields["exponent"]) |
               (actual_fields["infinite"] != native_fields["infinite"]))
    failures = ((actual.double() - native_probabilities.double()).abs() >
                1e-4 + 1e-4 * native_probabilities.double().abs()).any(dim=1)
    witnesses = []
    for batch, y, x in failures.nonzero()[:limit].tolist():
        point = (batch, y, x)
        record = {"pixel_nhw": list(point), "bucket_changed": bool(changed[point])}
        for key, logits, probabilities, fields in (("native", native_logits, native_probabilities, native_fields),
                                                   ("pytorch", actual_logits, actual, actual_fields)):
            record[key] = {"logits": logits[batch, :, y, x].tolist(),
                           "logit_bits": [f"{int(v) & 0xffffffff:08x}" for v in logits[batch, :, y, x].contiguous().view(torch.int32)],
                           "probabilities": probabilities[batch, :, y, x].tolist(),
                           **{name: tensor[point].item() for name, tensor in fields.items()}}
        witnesses.append(record)
    smooth_native = native_logits.softmax(dim=1)
    smooth_actual = actual_logits.softmax(dim=1)
    return {"fixed_tolerance": {"atol": 1e-4, "rtol": 1e-4},
            "isolated_softmax_native_logits": metrics(actual=isolated, expected=native_probabilities),
            "probabilities": metrics(actual=actual, expected=native_probabilities),
            "logits": metrics(actual=actual_logits, expected=native_logits),
            "failing_pixels": int(failures.sum()), "bucket_changed_pixels": int(changed.sum()),
            "all_failures_have_bucket_change": bool((~failures | changed).all()),
            "witnesses": witnesses,
            "standard_softmax_control": {
                "scope": "different mathematical semantics; not a native-parity candidate or fix",
                "own_logits_vs_native_logits": metrics(actual=smooth_actual, expected=smooth_native),
                "standard_on_native_logits_vs_native_output": metrics(actual=smooth_native, expected=native_probabilities)}}
