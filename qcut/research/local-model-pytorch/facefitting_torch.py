"""Strict CPU reproduction of one locally audited face-fitting subnetwork."""
import hashlib
from pathlib import Path

import numpy as np
import torch
from torch import nn

FORMAT = "qcut-private-facefitting3d-pytorch-v1"
SOURCE_SHA256 = "b92958fdf04059110cae7899005b4550ad3ce95d00f5027e7235542971f06e93"
BM_SHA256 = "398bc6d292cc2bcec63797e1f5bcce33f63b5f0dde6007c358641587c89010dc"
INPUT_SHAPE = (1, 212)
OUTPUT_SHAPE = (1, 442)
ARENA_FLOATS = 598459


def parse_spec(*, text):
    lines = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    if len(lines) != 9 or lines[0] != ["D"] or lines[1][:2] != ["1", "6"] or len(lines[1]) != 3:
        raise ValueError("unsupported face-fitting graph header")
    rows = lines[2:]
    if len(rows[0]) != 10 or rows[0][0] != "DataV2" or rows[0][2:] != ["1", "1", "1", "212", "4", "0", "0", "2"]:
        raise ValueError("unsupported face-fitting input")
    source = rows[0][1]
    input_name = source
    names = {source}
    for index, cout in enumerate((512, 512, 442), start=1):
        row = rows[index]
        if (len(row) != 13 or row[0] != "InnerProduct" or row[2:11] !=
                [str(cout), "1", "1" if index < 3 else "0", "4", "0", "4", "0", "4", "0"]
                or row[11] != source or row[12] in names):
            raise ValueError("unsupported dense graph topology")
        source = row[12]
        names.add(source)
    sigmoid, constant, multiply = rows[4:]
    if len(sigmoid) != 6 or sigmoid[0] != "Sigmoid" or sigmoid[2] != source or sigmoid[4:] != ["4", "0"]:
        raise ValueError("unsupported sigmoid")
    if len(constant) != 10 or constant[0] != "Constant" or constant[2:7] != ["0", "1", "1", "1", "1"] or constant[8:] != ["4", "0"]:
        raise ValueError("unsupported scalar constant")
    if (len(multiply) != 8 or multiply[0] != "OnnxOp2" or multiply[2:5] != ["Mul", sigmoid[3], constant[7]]
            or multiply[6:] != ["4", "0"]):
        raise ValueError("unsupported graph output")
    if len(names | {sigmoid[3], constant[7], multiply[5]}) != 7:
        raise ValueError("duplicate graph tensors")
    return {"input_name": input_name, "output_name": multiply[5],
            "input_shape": list(INPUT_SHAPE), "output_shape": list(OUTPUT_SHAPE),
            "dense_sizes": [212, 512, 512, 442], "activations": ["relu", "relu", "sigmoid"]}


class FaceFittingGraph(nn.Module):
    def __init__(self, *, spec, weights=None):
        super().__init__()
        if (spec.get("input_shape") != list(INPUT_SHAPE) or spec.get("output_shape") != list(OUTPUT_SHAPE)
                or spec.get("dense_sizes") != [212, 512, 512, 442]
                or spec.get("activations") != ["relu", "relu", "sigmoid"]
                or not isinstance(spec.get("input_name"), str) or not spec["input_name"]
                or not isinstance(spec.get("output_name"), str) or not spec["output_name"]):
            raise ValueError("unsupported face-fitting specification")
        self.spec = dict(spec)
        self.layers = nn.ModuleList([nn.Linear(cin, cout) for cin, cout in ((212, 512), (512, 512), (512, 442))])
        self.register_buffer("scale", torch.zeros(()))
        if weights is not None:
            if weights.dtype != np.float32 or weights.ndim != 1 or len(weights) != ARENA_FLOATS or not np.isfinite(weights).all():
                raise ValueError("invalid face-fitting weight arena")
            cursor = 0
            with torch.no_grad():
                for layer in self.layers:
                    size = layer.in_features * layer.out_features
                    layer.weight.copy_(torch.from_numpy(weights[cursor:cursor + size].copy()).reshape(layer.out_features, layer.in_features))
                    cursor += size
                    layer.bias.copy_(torch.from_numpy(weights[cursor:cursor + layer.out_features].copy()))
                    cursor += layer.out_features
                if cursor + 1 != len(weights):
                    raise ValueError("unconsumed face-fitting weights")
                self.scale.copy_(torch.tensor(float(weights[cursor]), dtype=torch.float32))

    def forward(self, inputs):
        if set(inputs) != {self.spec["input_name"]}:
            raise ValueError("exactly the declared input is required")
        value = inputs[self.spec["input_name"]]
        if value.device.type != "cpu" or value.dtype != torch.float32 or tuple(value.shape) != INPUT_SHAPE or not torch.isfinite(value).all():
            raise ValueError("expected finite CPU float32 input shaped [1,212]")
        value = self.layers[0](value).relu()
        value = self.layers[1](value).relu()
        value = self.layers[2](value).sigmoid() * self.scale
        return {self.spec["output_name"]: value}


def load_model(*, path, expected_sha256=None):
    path = Path(path)
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("oversized face-fitting bundle")
    if expected_sha256 is not None and hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("face-fitting artifact hash mismatch")
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    if (bundle.get("format") != FORMAT or bundle.get("source_sha256") != SOURCE_SHA256
            or bundle.get("bm_sha256") != BM_SHA256 or bundle.get("local_only") is not True):
        raise ValueError("unsupported face-fitting bundle provenance")
    model = FaceFittingGraph(spec=bundle["spec"])
    for value in bundle["state_dict"].values():
        if not isinstance(value, torch.Tensor) or value.dtype != torch.float32 or not torch.isfinite(value).all():
            raise ValueError("invalid face-fitting state tensor")
    model.load_state_dict(bundle["state_dict"], strict=True)
    return model.cpu().eval()
