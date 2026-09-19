#!/usr/bin/env python3
"""Reuse recovered shot-split modules; export a standalone, weights-only bundle."""
import argparse
import json
import pathlib
import sys

import torch

from espresso_archive import sha256

SHOT_CODE = pathlib.Path(__file__).resolve().parents[1] / "jianying-shot-split-probe"
sys.path.insert(0, str(SHOT_CODE))
from torch_backbone import Backbone, build
from torch_predhead import PredHead, read_trace

FORMAT = "qcut-private-shot-pytorch"
SOURCES = {
    "backbone": ("jy_compressShotDetectBackbone_new_v1.0_size0.bytenn", "2223cfd12a876800bee1334a500a988a7f27bb5c24ba785845fda5daf6cd2ab2"),
    "predhead": ("jy_compressShotDetectPredHead_new_v1.0_size0.bytenn", "a898a4aeb19630598b6a87a7c00f423ccccdf679cbf26ca3b40145750efb9c3a"),
}


def load_shots(*, path):
    bundle = torch.load(path, weights_only=True, map_location="cpu")
    if bundle.get("format") != FORMAT or bundle.get("version") != 1:
        raise ValueError("unsupported shot bundle")
    backbone = Backbone(bundle["backbone"]["specs"])
    backbone.scales = bundle["backbone"]["scales"]
    backbone.load_state_dict(bundle["backbone"]["state_dict"], strict=True)
    head = PredHead(bundle=bundle["predhead"])
    return backbone.eval(), head.eval()


def export_shots(*, runtime, tables, output, traces=None):
    paths = {name: runtime / "Resources/models" / source[0] for name, source in SOURCES.items()}
    hashes = {name: sha256(path=path) for name, path in paths.items()}
    for name, digest in hashes.items():
        if digest != SOURCES[name][1]:
            raise ValueError(f"{name}: unsupported model hash; fixed arena offsets must not be guessed")
    backbone_table, head_table = tables / "engine-4/params.tsv", tables / "engine-5/params.tsv"
    backbone = build(paths["backbone"], backbone_table)
    head = PredHead(paths["predhead"], head_table).eval()
    bundle = {"format": FORMAT, "version": 1, "local_only": True, "source_sha256": hashes,
              "table_sha256": {"backbone": sha256(path=backbone_table), "predhead": sha256(path=head_table)},
              "backbone": {"specs": backbone.specs, "scales": backbone.scales, "state_dict": backbone.state_dict()},
              "predhead": {"conv_specs": head.conv_specs, "alphas": head.alphas, "state_dict": head.state_dict()}}
    output.mkdir(parents=True, exist_ok=True)
    path = output / "shot-split.pt"
    torch.save(bundle, path)
    restored_backbone, restored_head = load_shots(path=path)
    for original, restored in ((backbone, restored_backbone), (head, restored_head)):
        if any(not torch.equal(value, restored.state_dict()[name]) for name, value in original.state_dict().items()):
            raise ValueError("shot parameter roundtrip mismatch")
    cases = []
    for seed in range(3):
        inputs = torch.rand((7, 3, 96, 96), generator=torch.Generator().manual_seed(seed)) * 2 - 1
        with torch.inference_mode():
            features = backbone(inputs)
            restored_features = restored_backbone(inputs)
            probability = head(features)
            equal = torch.equal(features, restored_features) and torch.equal(probability, restored_head(restored_features))
        if not equal or not torch.isfinite(probability):
            raise ValueError("shot forward roundtrip mismatch")
        cases.append({"seed": seed, "roundtrip": True, "probability": probability.item()})
    report = {"artifact": str(path.resolve()), "sha256": sha256(path=path), "source_sha256": hashes,
              "networks": 2, "roundtrip": cases, "native": "unverified", "local_only": True}
    if traces:
        with torch.inference_mode():
            bb_traces = sorted((traces / "trace-bb").glob("*/features.tsv"))
            if not bb_traces:
                raise ValueError("no backbone layer-forward traces found")
            backbone_errors = []
            for table in bb_traces:
                bb_input = read_trace(table.parent, "data").permute(0, 3, 1, 2)
                expected_features = read_trace(table.parent, "Flatten_212").flatten()
                features = restored_backbone(bb_input).flatten()
                backbone_errors.append((features - expected_features).abs().max().item())
            head_trace = traces / "trace-head2"
            head_input = read_trace(head_trace, "data").reshape(128, 7).T
            expected_probability = read_trace(head_trace, "Sigmoid_52").flatten()[0]
            probability = restored_head(head_input)
        bb_error = max(backbone_errors)
        head_error = (probability - expected_probability).abs().item()
        report["native"] = {"source": "previous recorded layer-forward tensors, not a new native run",
                            "backbone_traces": len(backbone_errors),
                            "backbone_max_abs": bb_error, "predhead_max_abs": head_error,
                            "passed": bb_error <= 0.0001 and head_error <= 0.0001}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=pathlib.Path, default=pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingShotSplit/current")
    parser.add_argument("--tables", type=pathlib.Path, required=True)
    parser.add_argument("--traces", type=pathlib.Path)
    parser.add_argument("--out", type=pathlib.Path, default=SHOT_CODE.parents[1] / ".local/jianying-model-pytorch/shots")
    args = parser.parse_args()
    torch.set_num_threads(4)
    report = export_shots(runtime=args.runtime, tables=args.tables, output=args.out, traces=args.traces)
    print(json.dumps(report, indent=2))
    return int(isinstance(report["native"], dict) and not report["native"]["passed"])


if __name__ == "__main__":
    sys.exit(main())
