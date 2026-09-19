#!/usr/bin/env python3
"""Inventory private model files and export readable Espresso networks to PyTorch."""
import argparse
import datetime
import json
import pathlib
import sys

import torch

from espresso_archive import UnsupportedModel, read_archive, sha256
from espresso_torch import EspressoTorch, load_model
from inventory import manifest_sources
from verify import verify_model

DEFAULT_MODELS = pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Models"
DEFAULT_OUT = pathlib.Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


def run_batch(*, sources, output, oracle=None, shots=None):
    output.mkdir(parents=True, exist_ok=True)
    report = {"created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "torch_version": str(torch.__version__), "local_only": True,
              "scope": "embedded Espresso tensor inference, not full editor parity", "models": []}
    unique = {}
    for source in sources:
        digest = sha256(path=source)
        item = {"source": str(source.resolve()), "sha256": digest, "size": source.stat().st_size}
        if digest in unique:
            item.update(status="duplicate", duplicate_of=unique[digest])
            report["models"].append(item)
            continue
        unique[digest] = str(source)
        try:
            if shots and digest in shots["source_sha256"].values():
                native_passed = isinstance(shots["native"], dict) and shots["native"]["passed"]
                item.update(status="recorded-native-parity-passed" if native_passed else "roundtrip-passed-native-unverified",
                            artifact=shots["artifact"], verification=shots)
                if isinstance(shots["native"], dict) and not shots["native"]["passed"]:
                    item["status"] = "native-parity-failed"
                report["models"].append(item)
                continue
            spec, blobs, _ = read_archive(path=source)
            directory = output / digest[:16]
            directory.mkdir(parents=True, exist_ok=True)
            model = EspressoTorch(spec=spec, blobs=blobs).eval()
            path = directory / "model.pt"
            provenance = {"source_name": source.name, "sha256": digest, "local_only": True,
                          "torch_version": str(torch.__version__)}
            torch.save(model.bundle(provenance=provenance), path)
            restored = load_model(path=path)
            state = model.state_dict()
            if any(not torch.equal(state[name], value) for name, value in restored.state_dict().items()):
                raise ValueError("parameter roundtrip mismatch")
            item.update(artifact=str(path.resolve()), artifact_sha256=sha256(path=path),
                        layers=len(spec["layers"]), parameters=sum(p.numel() for p in model.parameters()),
                        operators=sorted({layer["type"] for layer in spec["layers"]}),
                        inputs=spec["inputs"], outputs=spec["outputs"], status="exported")
            item["verification"] = verify_model(model=model, restored=restored, source=source, directory=directory, oracle=oracle)
            if oracle:
                passed = all(value["passed"] for case in item["verification"] for value in case["native"].values())
                item["status"] = "native-parity-passed" if passed else "native-parity-failed"
            else:
                item["status"] = "roundtrip-passed-native-unverified"
        except UnsupportedModel as error:
            item.update(status="unsupported", reason=str(error))
        except Exception as error:
            item.update(status="failed", reason=f"{type(error).__name__}: {error}")
            if getattr(error, "stderr", None):
                item["stderr"] = error.stderr[-4000:]
        report["models"].append(item)
        print(f"{item['status']}: {source.name}", flush=True)
        (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    report["summary"] = {status: sum(item["status"] == status for item in report["models"]) for status in sorted({item["status"] for item in report["models"]})}
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", type=pathlib.Path, default=DEFAULT_MODELS)
    parser.add_argument("--runtime-root", type=pathlib.Path, help="scan all five verified current manifests instead of --models")
    parser.add_argument("--shot-tables", type=pathlib.Path, help="enable the two already recovered shot networks")
    parser.add_argument("--shot-traces", type=pathlib.Path, help="optional recorded native layer-forward tensors")
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument("--oracle", type=pathlib.Path)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("threads must be positive")
    torch.set_num_threads(args.threads)
    sources = manifest_sources(root=args.runtime_root) if args.runtime_root else sorted(
        p for p in args.models.rglob("*") if p.is_file() and p.suffix in {".model", ".bytenn", ".tflite", ".dat"})
    if not sources:
        parser.error("no model files found")
    shots = None
    if args.shot_tables:
        from shot_export import export_shots
        root = args.runtime_root or DEFAULT_MODELS.parents[2]
        shots = export_shots(runtime=root / "JianyingShotSplit/current", tables=args.shot_tables,
                             output=args.out.resolve() / "shots", traces=args.shot_traces)
    report = run_batch(sources=sources, output=args.out.resolve(), oracle=args.oracle.resolve() if args.oracle else None, shots=shots)
    print(json.dumps(report["summary"], indent=2))
    return int(any(item["status"] in {"failed", "native-parity-failed"} for item in report["models"]))


if __name__ == "__main__":
    sys.exit(main())
