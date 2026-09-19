"""Strict executor for the nine Espresso operators observed in local models."""
import collections
import copy

import torch
import torch.nn.functional as F
from torch import nn

from espresso_archive import UnsupportedModel, conv_weight, tensor_blob

FORMAT = "qcut-private-espresso-pytorch"
VERSION = 1
COMMON_FIELDS = set("type name bottom top debug_info weights attributes".split())
PADDING_FIELDS = set("pad_l pad_r pad_t pad_b pad_mode pad_fill_mode pad_value stride_x stride_y".split())
CONV_FIELDS = PADDING_FIELDS | set("C K Nx Ny n_groups n_parallel has_batch_norm has_biases blob_biases blob_weights blob_weights_f16 dilation_x dilation_y fused_relu fused_tanh".split())
OP_FIELDS = {
    "convolution": CONV_FIELDS,
    "deconvolution": CONV_FIELDS | {"deconv_out_height", "deconv_out_width", "hint_fallback_from_metal"},
    "activation": {"mode", "alpha", "beta"},
    "elementwise": {"alpha", "beta", "operation", "fused_relu"},
    "concat": {"axis"},
    "upsample": set("mode align_corners is_legacy_mode use_fractional_scale_factors fractional_scaling_factor_x fractional_scaling_factor_y scaling_factor_x scaling_factor_y".split()),
    "split_nd": {"nd_axis"} | {f"begin_{index}" for index in range(128)},
    "load_constant": set("constant_blob n k h w nd_rank".split()),
    "pool": PADDING_FIELDS | set("average_count_exclude_padding avg_or_max size_x size_y top_shape_style".split()),
}


def names(*, value):
    return value.split(",") if value else []


def require(*, layer, key, values, default=0):
    if layer.get(key, default) not in values:
        raise UnsupportedModel(f"{layer['name']}: unsupported {key}={layer.get(key)}")


def require_positive(*, layer, key, integer=False):
    """Fields that _execute indexes directly must be present at construction time."""
    value = layer.get(key)
    valid = isinstance(value, int) if integer else isinstance(value, (int, float))
    if isinstance(value, bool) or not valid or value <= 0:
        raise UnsupportedModel(f"{layer['name']}: missing or invalid {key}={value}")


def validate_layer(*, layer):
    kind = layer["type"]
    if kind not in OP_FIELDS:
        raise UnsupportedModel(f"unsupported operator: {kind}")
    unknown = set(layer) - COMMON_FIELDS - OP_FIELDS[kind]
    if unknown:
        raise UnsupportedModel(f"{layer['name']}: unknown fields {sorted(unknown)}")
    if set(layer.get("attributes", {})) - {"is_output"}:
        raise UnsupportedModel("unknown operator attributes")
    if kind not in {"convolution", "deconvolution"} and layer.get("weights"):
        raise UnsupportedModel("unexpected operator weights")
    bottoms = names(value=layer["bottom"])
    expected = 0 if kind == "load_constant" else 2 if kind == "elementwise" else 1
    if kind != "concat" and len(bottoms) != expected:
        raise ValueError(f"{kind}: invalid input arity")
    if kind == "concat" and not bottoms:
        raise ValueError("empty concat")
    for key in ("fused_relu", "fused_tanh"):
        require(layer=layer, key=key, values={0, 1})
    if kind in {"convolution", "deconvolution", "pool"}:
        for key in ("pad_mode", "pad_fill_mode", "pad_value", "has_batch_norm"):
            require(layer=layer, key=key, values={0})
        require(layer=layer, key="n_parallel", values={1}, default=1)
    if kind in {"convolution", "deconvolution"}:
        for key in ("K", "C", "Nx", "Ny", "n_groups"):
            if not isinstance(layer[key], int) or not 0 < layer[key] <= 65536:
                raise ValueError(f"invalid convolution dimension: {key}")
        if layer["K"] % layer["n_groups"] or layer["C"] % layer["n_groups"]:
            raise ValueError("invalid convolution groups")
        parameter_count = layer["C"] * (layer["K"] // layer["n_groups"]) * layer["Nx"] * layer["Ny"]
        if parameter_count > 64 * 1024 * 1024:
            raise ValueError("convolution exceeds local conversion size limit")
        if kind == "deconvolution" and not layer["K"] == layer["C"] == layer["n_groups"]:
            raise UnsupportedModel("only observed depthwise deconvolutions are supported")
    if kind == "elementwise":
        require(layer=layer, key="operation", values={0, 1})
        require(layer=layer, key="alpha", values={1}, default=1)
        require(layer=layer, key="beta", values={0})
    if kind == "activation":
        require(layer=layer, key="mode", values={0, 3, 6})
    if kind == "concat":
        require(layer=layer, key="axis", values={1}, default=1)
    if kind == "upsample":
        require(layer=layer, key="mode", values={1})
        for key in ("align_corners", "is_legacy_mode", "use_fractional_scale_factors"):
            require(layer=layer, key=key, values={0})
        for key in ("fractional_scaling_factor_x", "fractional_scaling_factor_y"):
            require(layer=layer, key=key, values={1}, default=1)
        for key in ("scaling_factor_x", "scaling_factor_y"):
            require_positive(layer=layer, key=key)
    if kind == "split_nd":
        require(layer=layer, key="nd_axis", values={-3, 1})
        if any(value != 0 for key, value in layer.items() if key.startswith("begin_")):
            raise UnsupportedModel("nonzero split offsets")
    if kind == "pool":
        require(layer=layer, key="avg_or_max", values={1})
        require(layer=layer, key="top_shape_style", values={2})
        if any(layer.get("pad_" + edge, 0) for edge in ("l", "r", "t", "b")):
            raise UnsupportedModel("padded pooling")
        for key in ("size_x", "size_y", "stride_x", "stride_y"):
            require_positive(layer=layer, key=key, integer=True)
    if kind == "load_constant":
        require(layer=layer, key="nd_rank", values={1, 4}, default=4)
        if layer.get("nd_rank") == 1 and any(layer[key] != 1 for key in ("n", "k", "h", "w")):
            raise UnsupportedModel("only scalar rank-1 constants are supported")


class EspressoTorch(nn.Module):
    def __init__(self, *, spec, blobs=None):
        super().__init__()
        if spec.get("quantization_profile", "espresso-u8-fma-f32-to-f16") != "espresso-u8-fma-f32-to-f16":
            raise UnsupportedModel("unknown quantization profile")
        self.spec = copy.deepcopy(spec)
        self.ops = nn.ModuleDict()
        available = set(spec["inputs"])
        for index, layer in enumerate(spec["layers"]):
            validate_layer(layer=layer)
            bottoms = names(value=layer["bottom"])
            tops = names(value=layer["top"])
            if not tops or any(name not in available for name in bottoms):
                raise ValueError(f"invalid graph dependency at {layer['name']}")
            available.update(tops)
            kind = layer["type"]
            if kind in {"convolution", "deconvolution"}:
                module_type = nn.ConvTranspose2d if kind == "deconvolution" else nn.Conv2d
                module = module_type(layer["K"], layer["C"], (layer["Ny"], layer["Nx"]),
                                     stride=(layer.get("stride_y", 1), layer.get("stride_x", 1)),
                                     dilation=(layer.get("dilation_y", 1), layer.get("dilation_x", 1)),
                                     groups=layer["n_groups"], bias=bool(layer.get("has_biases", 0)))
                if blobs is not None:
                    with torch.no_grad():
                        module.weight.copy_(conv_weight(layer=layer, blobs=blobs))
                        if module.bias is not None:
                            module.bias.copy_(tensor_blob(blobs=blobs, key=layer["blob_biases"]))
                self.ops[str(index)] = module
            if kind == "load_constant":
                shape = tuple(layer[key] for key in ("n", "k", "h", "w"))
                value = torch.zeros(shape) if blobs is None else tensor_blob(
                    blobs=blobs, key=layer["constant_blob"]).reshape(shape)
                self.register_buffer(f"constant_{index}", value)
        if any(name not in available for name in spec["outputs"]):
            raise ValueError("missing graph output")

    def forward(self, inputs):
        if set(inputs) != set(self.spec["inputs"]):
            raise ValueError("input names do not match model schema")
        for name, schema in self.spec["inputs"].items():
            allowed = schema["allowed_shapes"] or [schema["shape"]]
            if list(inputs[name].shape) not in allowed or inputs[name].dtype != torch.float32:
                raise ValueError(f"input shape/dtype mismatch: {name}")
        values = dict(inputs)
        uses = collections.Counter(name for layer in self.spec["layers"] for name in names(value=layer["bottom"]))
        uses.update(self.spec["outputs"])
        for index, layer in enumerate(self.spec["layers"]):
            bottoms, tops = names(value=layer["bottom"]), names(value=layer["top"])
            args = [values[name] for name in bottoms]
            result = self._execute(index=index, layer=layer, args=args)
            results = result if isinstance(result, tuple) else (result,)
            if len(results) != len(tops):
                raise ValueError(f"output arity mismatch at {layer['name']}")
            values.update(zip(tops, results, strict=True))
            for name in bottoms:
                uses[name] -= 1
                if uses[name] == 0 and name not in tops:
                    values.pop(name)
        return {name: values[name] for name in self.spec["outputs"]}

    def _execute(self, *, index, layer, args):
        kind = layer["type"]
        if kind in {"convolution", "deconvolution"}:
            pad = tuple(layer.get("pad_" + edge, 0) for edge in ("l", "r", "t", "b"))
            if kind == "convolution":
                out = self.ops[str(index)](F.pad(args[0], pad))
            else:
                out = self.ops[str(index)](args[0])
                left, right, top, bottom = pad
                out = out[:, :, top:out.shape[2] - bottom, left:out.shape[3] - right]
                if "deconv_out_height" in layer and list(out.shape[-2:]) != [layer["deconv_out_height"], layer["deconv_out_width"]]:
                    raise ValueError("deconvolution output shape mismatch")
        elif kind == "activation":
            mode = layer["mode"]
            out = F.relu(args[0]) if mode == 0 else torch.sigmoid(args[0]) if mode == 3 else args[0] * layer.get("alpha", 1) + layer.get("beta", 0)
        elif kind == "elementwise":
            if len(args) != 2:
                raise ValueError("elementwise needs two operands")
            out = args[0] + args[1] if layer["operation"] == 0 else args[0] * args[1]
        elif kind == "concat":
            out = torch.cat(args, dim=1)
        elif kind == "upsample":
            out = F.interpolate(args[0], scale_factor=(layer["scaling_factor_y"], layer["scaling_factor_x"]), mode="bilinear", align_corners=False)
        elif kind == "pool":
            out = F.max_pool2d(args[0], (layer["size_y"], layer["size_x"]), (layer["stride_y"], layer["stride_x"]), ceil_mode=True)
        elif kind == "split_nd":
            sizes = [self.spec["shapes"][name]["k"] for name in names(value=layer["top"])]
            return torch.split(args[0], sizes, dim=1)
        elif kind == "load_constant":
            out = getattr(self, f"constant_{index}")
        else:
            raise UnsupportedModel(kind)
        if layer.get("fused_relu"):
            out = F.relu(out)
        if layer.get("fused_tanh"):
            out = torch.tanh(out)
        return out

    def bundle(self, *, provenance):
        return {"format": FORMAT, "version": VERSION, "spec": self.spec,
                "state_dict": self.state_dict(), "provenance": provenance}


def load_model(*, path):
    bundle = torch.load(path, map_location="cpu", weights_only=True)
    if bundle.get("format") != FORMAT or bundle.get("version") != VERSION:
        raise ValueError("unsupported PyTorch bundle")
    model = EspressoTorch(spec=bundle["spec"])
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.eval()
