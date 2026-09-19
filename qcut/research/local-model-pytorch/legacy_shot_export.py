#!/usr/bin/env python3
"""Export the hash-pinned 128-pixel / 11-frame legacy shot detector."""
import argparse
import json
import pathlib
import sys

import numpy as np
import torch
from torch import nn

from legacy_shot_probe import PRIVATE, ROOT, RUNTIME, SOURCES, digest, header, private_output

sys.path.insert(0, str(ROOT / "research/jianying-shot-split-probe"))
from arena_weights import ATTENTION_SCALE_BEFORE, install, to_torch_weight, weight_count
from torch_backbone import Backbone
from torch_predhead import PredHead, read_trace

FORMAT = "qcut-private-legacy-shot-pytorch"
HIDDEN = 256
WINDOW = 11


def read_layers(*, path):
    rows = []
    for line in path.read_text(errors="replace").splitlines():
        row = line.split("\t")
        if len(row) >= 11 and row[0].isdigit():
            rows.append(row)
    if [int(row[0]) for row in rows] != list(range(len(rows))):
        raise ValueError("layer table is incomplete, duplicated, or out of order")
    return rows


def specs_from_rows(*, rows):
    specs = []
    for row in rows:
        if row[2] not in ("Convolution", "DepthwiseSeparableConvolution"):
            continue
        k, kw, ci, co = map(int, row[3:7])
        stride = [int(x) for x in row[9].split(",")]
        pad = [int(x) for x in row[10].split(",")]
        depthwise = row[2] == "DepthwiseSeparableConvolution"
        if not (k == kw and k in (1, 3, 5) and 0 < ci <= 384 and 0 < co <= 384
                and len(stride) == 2 and stride[0] == stride[1] and stride[0] in (1, 2)
                and len(pad) == 2 and pad[0] == pad[1] and 0 <= pad[0] <= 2
                and (not depthwise or ci == co)):
            raise ValueError(f"unsupported convolution spec: {row[1]}")
        specs.append({"name": row[1], "k": k, "cin": ci, "cout": co,
                      "stride": stride[0], "pad": pad[0], "depthwise": depthwise})
    return specs


class LegacyGRU(nn.Module):
    def __init__(self, *, block=None):
        super().__init__()
        self.hidden = HIDDEN
        count = 6 * HIDDEN * HIDDEN + 4 * HIDDEN
        if block is None:
            block = np.zeros(count, dtype=np.float32)
        if len(block) != count:
            raise ValueError("invalid legacy GRU block length")
        h = HIDDEN
        gate = torch.from_numpy(block[:4 * h * h].copy()).reshape(2 * h, 2 * h)
        self.Wr = nn.Parameter(gate[:h, :h].clone())
        self.Wz = nn.Parameter(gate[h:, :h].clone())
        self.Rr = nn.Parameter(gate[:h, h:].clone())
        self.Rz = nn.Parameter(gate[h:, h:].clone())
        self.Wn = nn.Parameter(torch.from_numpy(block[4 * h * h:5 * h * h].copy()).reshape(h, h))
        self.Rn = nn.Parameter(torch.from_numpy(block[5 * h * h:6 * h * h].copy()).reshape(h, h))
        self.bias = nn.Parameter(torch.from_numpy(block[6 * h * h:].copy()).reshape(4, h))

    def forward(self, seq):
        state = seq.new_zeros(self.hidden)
        outputs = []
        for item in seq:
            reset = torch.sigmoid(self.Wr @ item + self.Rr @ state + self.bias[0])
            update = torch.sigmoid(self.Wz @ item + self.Rz @ state + self.bias[1])
            candidate = torch.tanh(self.Wn @ item + self.bias[2] + reset * (self.Rn @ state + self.bias[3]))
            state = (1 - update) * candidate + update * state
            outputs.append(state)
        return torch.stack(outputs)


class LegacyHead(PredHead):
    def __init__(self, *, specs, alphas, state=None):
        nn.Module.__init__(self)
        self.gru1, self.gru2 = LegacyGRU(), LegacyGRU()
        self.conv_specs, self.alphas = specs, alphas
        self.convs = nn.ModuleList([
            nn.Conv2d(s["cin"], s["cout"], s["k"], s["stride"], s["pad"],
                      groups=s["cin"] if s["depthwise"] else 1)
            for s in specs
        ])
        if state is not None:
            self.load_state_dict(state, strict=True)

    def similarity_map(self, seq):
        # Legacy groups interleave channels; the new model uses contiguous groups.
        groups = seq.reshape(WINDOW, HIDDEN // 4, 4).permute(0, 2, 1)
        dot = torch.einsum("igd,jgd->gij", groups, groups)
        squares = (groups * groups).sum(-1).T
        return (dot / torch.sqrt(squares.unsqueeze(2) * squares.unsqueeze(1))).unsqueeze(0)

    def forward(self, feats):
        if tuple(feats.shape) != (WINDOW, HIDDEN):
            raise ValueError("legacy head expects 11 frames of 256 features")
        return super().forward(feats)


def arena_for(*, path, role):
    if digest(path=path) != SOURCES[role][1]:
        raise ValueError(f"{role}: unsupported legacy model hash")
    raw = path.read_bytes()
    info = header(raw=raw)
    return np.frombuffer(raw, dtype="<f4", count=info["arena_floats"], offset=info["arena_offset"]).copy()


def build_backbone(*, arena, rows):
    specifications = specs_from_rows(rows=rows)
    if len(rows) != 118 or len(specifications) != 61 or rows[-1][1] != "Flatten_212":
        raise ValueError("unexpected legacy backbone graph")
    specs = {s["name"]: {k: v for k, v in s.items() if k != "name"} for s in specifications}
    if specs["backbone.embedding"]["cout"] != HIDDEN or int(rows[1][7]) != 128:
        raise ValueError("legacy backbone dimensions disagree")
    position, table, scales = 0, {}, []
    for name, spec in specs.items():
        if name in ATTENTION_SCALE_BEFORE:
            scales.append(float(arena[position]))
            position += 1
        count = weight_count(spec)
        table[name] = (arena[position:position + count], arena[position + count:position + count + spec["cout"]])
        position += count + spec["cout"]
    if position != len(arena) - 1 or scales != [0.125, 0.125]:
        raise ValueError("legacy backbone arena consumption mismatch")
    model = Backbone(specs)
    install(model, table, specs)
    model.scales = scales
    return model.eval()


def build_head(*, arena, rows):
    specs = specs_from_rows(rows=rows)
    if len(rows) != 39 or len(specs) != 10 or rows[-1][1] != "Reshape_54":
        raise ValueError("unexpected legacy head graph")
    if specs[0]["cout"] != HIDDEN or int(next(r for r in rows if r[1] == "Conv_29")[7]) != WINDOW:
        raise ValueError("legacy temporal dimensions disagree")
    size = 6 * HIDDEN * HIDDEN + 4 * HIDDEN
    model = LegacyHead(specs=specs, alphas=[])
    model.gru1, model.gru2 = LegacyGRU(block=arena[:size]), LegacyGRU(block=arena[size:2 * size])
    position = 2 * size
    with torch.no_grad():
        for conv, spec in zip(model.convs, specs):
            count = weight_count(spec)
            conv.weight.copy_(to_torch_weight(arena[position:position + count], spec))
            position += count
            conv.bias.copy_(torch.from_numpy(arena[position:position + spec["cout"]].copy()))
            position += spec["cout"]
            if spec["name"] in ("classifier.0", "classifier.2"):
                model.alphas.append(float(arena[position]))
                position += 1
    if position != len(arena) - 1 or len(model.alphas) != 2:
        raise ValueError("legacy head arena consumption mismatch")
    return model.eval()


def load_legacy(*, path):
    bundle = torch.load(path, map_location="cpu", weights_only=True)
    if bundle.get("format") != FORMAT or bundle.get("version") != 1:
        raise ValueError("unsupported legacy bundle")
    if bundle.get("source_sha256") != {key: value[1] for key, value in SOURCES.items()}:
        raise ValueError("unsupported legacy provenance")
    backbone = Backbone(bundle["backbone"]["specs"])
    backbone.scales = bundle["backbone"]["scales"]
    backbone.load_state_dict(bundle["backbone"]["state_dict"], strict=True)
    head = LegacyHead(specs=bundle["head"]["specs"], alphas=bundle["head"]["alphas"], state=bundle["head"]["state_dict"])
    return backbone.eval(), head.eval()


def export_legacy(*, runtime, evidence):
    output = private_output(path=evidence)
    tables = [read_layers(path=path) for path in sorted((output / "params").glob("*/params.tsv"))]
    roles = {"backbone": 118, "predhead": 39}
    models = {}
    for role, count in roles.items():
        matches = [rows for rows in tables if len(rows) == count]
        if len(matches) != 1:
            raise ValueError(f"expected exactly one {role} native layer table")
        arena = arena_for(path=runtime / "Resources/models" / SOURCES[role][0], role=role)
        models[role] = (build_backbone if role == "backbone" else build_head)(arena=arena, rows=matches[0])
    backbone, head = models["backbone"], models["predhead"]
    bundle = {"format": FORMAT, "version": 1, "local_only": True,
              "source_sha256": {key: value[1] for key, value in SOURCES.items()},
              "backbone": {"specs": backbone.specs, "scales": backbone.scales, "state_dict": backbone.state_dict()},
              "head": {"specs": head.conv_specs, "alphas": head.alphas, "state_dict": head.state_dict()}}
    path = output / "legacy-shot-split.pt"
    torch.save(bundle, path)
    restored = load_legacy(path=path)
    for old, new in zip((backbone, head), restored):
        if any(not torch.equal(value, new.state_dict()[key]) for key, value in old.state_dict().items()):
            raise ValueError("legacy parameter roundtrip mismatch")
    report = {"artifact": str(path), "sha256": digest(path=path), "networks": 2, "local_only": True,
              "source_sha256": bundle["source_sha256"], "roundtrip": [], "native": []}
    with torch.inference_mode():
        for seed in (19, 41, 83):
            inputs = torch.rand((WINDOW, 3, 128, 128), generator=torch.Generator().manual_seed(seed)) * 2 - 1
            old_features, features = backbone(inputs), restored[0](inputs)
            old_score, score = head(old_features), restored[1](features)
            passed = bool(torch.equal(old_features, features) and torch.equal(old_score, score) and torch.isfinite(score))
            report["roundtrip"].append({"seed": seed, "passed": passed, "score": score.item()})
        for role, model in zip(roles, restored):
            for trace in sorted(output.glob(f"trace-{role}*")):
                if not (trace / "features.tsv").exists():
                    continue
                inputs = read_trace(trace, "data")
                inputs = inputs.permute(0, 3, 1, 2) if role == "backbone" else inputs.reshape(HIDDEN, WINDOW).T
                expected = read_trace(trace, "Flatten_212" if role == "backbone" else "Sigmoid_52").flatten()
                actual = model(inputs).flatten()
                delta = (actual - expected).abs()
                result = {"role": role, "trace": str(trace), "max_abs": delta.max().item(), "mae": delta.mean().item(),
                          "shape": list(actual.shape), "passed": bool(torch.isfinite(actual).all() and delta.max() <= 0.0001)}
                if role == "predhead":
                    sequence = model.gru2(model.gru1(inputs))
                    result["gru_output_max_abs"] = (sequence.flatten() - read_trace(trace, "Reshape_15").flatten()).abs().max().item()
                    result["similarity_max_abs"] = (model.similarity_map(sequence).flatten() - read_trace(trace, "Transpose_27").flatten()).abs().max().item()
                    result["passed"] &= max(result["gru_output_max_abs"], result["similarity_max_abs"]) <= 0.0001
                report["native"].append(result)
    verified_roles = {case["role"] for case in report["native"] if case["passed"]}
    report["status"] = "native-parity-passed" if verified_roles == set(roles) and all(x["passed"] for x in report["native"] + report["roundtrip"]) else "native-unverified-or-failed"
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=pathlib.Path, default=RUNTIME)
    parser.add_argument("--evidence", type=pathlib.Path, default=PRIVATE / "legacy-shots")
    args = parser.parse_args()
    torch.set_num_threads(4)
    report = export_legacy(runtime=args.runtime, evidence=args.evidence)
    print(json.dumps(report, indent=2))
    return int(not all(case["passed"] for case in report["roundtrip"] + report["native"]))


if __name__ == "__main__":
    sys.exit(main())
