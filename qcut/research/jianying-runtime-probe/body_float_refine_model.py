"""Owned execution of the embedded body float graph; no CoreML runtime imports.

Adapted from the compiled-JSON EspressoTorch executor at repository commit
938056aa4, restricted to the five operators present in the body model.
"""
import collections
import copy
from pathlib import Path
import sys

import torch
import torch.nn.functional as F
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-model-pytorch"))
from espresso_archive import UnsupportedModel, conv_weight, tensor_blob

COMMON = set("type name bottom top debug_info weights attributes".split())
FIELDS = {
    "convolution": set("C K Nx Ny n_groups n_parallel has_batch_norm has_biases blob_biases blob_weights blob_weights_f16 dilation_x dilation_y fused_relu fused_tanh pad_l pad_r pad_t pad_b pad_mode pad_fill_mode pad_value stride_x stride_y".split()),
    "activation": {"mode"},
    "elementwise": {"alpha", "beta", "operation", "fused_relu"},
    "concat": {"axis"},
    "upsample": set("mode align_corners is_legacy_mode use_fractional_scale_factors fractional_scaling_factor_x fractional_scaling_factor_y scaling_factor_x scaling_factor_y".split()),
}


def names(*, value):
    return value.split(",") if value else []


def require(*, layer, key, values, default=0):
    if layer.get(key, default) not in values:
        raise UnsupportedModel(f"{layer['name']}: unsupported {key}={layer.get(key)}")


def positive_integer(*, layer, key, default=None):
    value = layer.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= 65536:
        raise ValueError(f"{layer['name']}: invalid {key}={value}")


def validate_layer(*, layer):
    kind = layer["type"]
    if kind not in FIELDS:
        raise UnsupportedModel(f"unsupported body operator: {kind}")
    unknown = set(layer) - COMMON - FIELDS[kind]
    if unknown or set(layer.get("attributes", {})) - {"is_output"}:
        raise UnsupportedModel(f"{layer['name']}: unknown fields {sorted(unknown)}")
    if kind != "convolution" and layer.get("weights"):
        raise UnsupportedModel("unexpected operator weights")
    bottoms = names(value=layer["bottom"])
    expected = 2 if kind == "elementwise" else 1
    if (kind != "concat" and len(bottoms) != expected) or not bottoms:
        raise ValueError(f"{layer['name']}: invalid input arity")
    if len(names(value=layer["top"])) != 1:
        raise ValueError("body operators require one output")
    for key in ("fused_relu", "fused_tanh"):
        require(layer=layer, key=key, values={0, 1})
    if kind == "convolution":
        for key in ("pad_mode", "pad_fill_mode", "pad_value", "has_batch_norm"):
            require(layer=layer, key=key, values={0})
        require(layer=layer, key="n_parallel", values={1}, default=1)
        require(layer=layer, key="has_biases", values={0, 1})
        for key in ("K", "C", "Nx", "Ny", "n_groups"):
            positive_integer(layer=layer, key=key)
        for key in ("stride_x", "stride_y", "dilation_x", "dilation_y"):
            positive_integer(layer=layer, key=key, default=1)
        for edge in ("l", "r", "t", "b"):
            value = layer.get("pad_" + edge, 0)
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 65536:
                raise ValueError("invalid convolution padding")
        if layer["K"] % layer["n_groups"] or layer["C"] % layer["n_groups"]:
            raise ValueError("invalid convolution groups")
        count = layer["C"] * (layer["K"] // layer["n_groups"]) * layer["Nx"] * layer["Ny"]
        if count > 64 * 1024 * 1024:
            raise ValueError("convolution exceeds conversion size limit")
    if kind == "elementwise":
        require(layer=layer, key="operation", values={0})
        require(layer=layer, key="alpha", values={1}, default=1)
        require(layer=layer, key="beta", values={0})
    if kind == "activation":
        require(layer=layer, key="mode", values={0})
    if kind == "concat":
        require(layer=layer, key="axis", values={1}, default=1)
    if kind == "upsample":
        require(layer=layer, key="mode", values={1})
        for key in ("align_corners", "is_legacy_mode", "use_fractional_scale_factors"):
            require(layer=layer, key=key, values={0})
        for key in ("fractional_scaling_factor_x", "fractional_scaling_factor_y"):
            require(layer=layer, key=key, values={1}, default=1)
        for key in ("scaling_factor_x", "scaling_factor_y"):
            positive_integer(layer=layer, key=key)


class BodyFloatRefine(nn.Module):
    def __init__(self, *, spec, blobs, precision="float32"):
        super().__init__()
        if precision not in {"float32", "float16"}:
            raise ValueError("unsupported compute precision")
        if spec.get("quantization_profile") != "espresso-u8-fma-f32-to-f16":
            raise UnsupportedModel("unknown weight quantization profile")
        self.spec = copy.deepcopy(spec)
        self.precision = precision
        self.compute_dtype = torch.float16 if precision == "float16" else torch.float32
        self.ops = nn.ModuleDict()
        available = set(spec["inputs"])
        for index, layer in enumerate(spec["layers"]):
            validate_layer(layer=layer)
            if any(name not in available for name in names(value=layer["bottom"])):
                raise ValueError(f"invalid graph dependency at {layer['name']}")
            available.add(layer["top"])
            if layer["type"] == "convolution":
                module = nn.Conv2d(layer["K"], layer["C"], (layer["Ny"], layer["Nx"]),
                    stride=(layer.get("stride_y", 1), layer.get("stride_x", 1)),
                    dilation=(layer.get("dilation_y", 1), layer.get("dilation_x", 1)),
                    groups=layer["n_groups"], bias=bool(layer.get("has_biases", 0)))
                with torch.no_grad():
                    module.weight.copy_(conv_weight(layer=layer, blobs=blobs))
                    if module.bias is not None:
                        module.bias.copy_(tensor_blob(blobs=blobs, key=layer["blob_biases"]))
                self.ops[str(index)] = module.to(dtype=self.compute_dtype)
        if not spec["outputs"] or any(name not in available for name in spec["outputs"]):
            raise ValueError("missing graph output")

    def forward(self, inputs):
        if set(inputs) != set(self.spec["inputs"]):
            raise ValueError("input names do not match model schema")
        for name, schema in self.spec["inputs"].items():
            value = inputs[name]
            if list(value.shape) != schema["shape"] or value.dtype != torch.float32:
                raise ValueError(f"input shape/dtype mismatch: {name}")
            if not bool(torch.isfinite(value).all()):
                raise ValueError("non-finite model input")
        values = {name: value.to(dtype=self.compute_dtype) for name, value in inputs.items()}
        uses = collections.Counter(name for layer in self.spec["layers"] for name in names(value=layer["bottom"]))
        uses.update(self.spec["outputs"])
        for index, layer in enumerate(self.spec["layers"]):
            bottoms = names(value=layer["bottom"])
            args = [values[name] for name in bottoms]
            out = self.execute(index=index, layer=layer, args=args)
            shape = self.spec["shapes"][layer["top"]]
            if list(out.shape) != [shape[key] for key in ("n", "k", "h", "w")]:
                raise ValueError(f"output shape mismatch: {layer['name']}")
            values[layer["top"]] = out
            for name in bottoms:
                uses[name] -= 1
                if uses[name] == 0 and name != layer["top"]:
                    values.pop(name)
        return {name: values[name].float() for name in self.spec["outputs"]}

    def execute(self, *, index, layer, args):
        kind = layer["type"]
        if kind == "convolution":
            pad = tuple(layer.get("pad_" + edge, 0) for edge in ("l", "r", "t", "b"))
            out = self.ops[str(index)](F.pad(args[0], pad))
        elif kind == "activation":
            out = F.relu(args[0])
        elif kind == "elementwise":
            if args[0].shape != args[1].shape:
                raise ValueError("body residual addition must not broadcast")
            out = args[0] + args[1]
        elif kind == "concat":
            out = torch.cat(args, dim=1)
        elif kind == "upsample":
            out = F.interpolate(args[0], scale_factor=(layer["scaling_factor_y"], layer["scaling_factor_x"]),
                                mode="bilinear", align_corners=False)
        else:
            raise UnsupportedModel(kind)
        if layer.get("fused_relu"):
            out = F.relu(out)
        if layer.get("fused_tanh"):
            out = torch.tanh(out)
        return out
