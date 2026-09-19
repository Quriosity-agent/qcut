"""Diagnostic bandou kernel substitution; this module does not approve bundles."""
import argparse
import json
from pathlib import Path
import time

import numpy as np
import torch

from bandou_phase5_probe import comparison, pinned_candidate, read_tensors
from bandou_phase5_torch import substitute
from bytenn_oracle import sha256
from vision_batch_export import fresh_directory


def replay(*, run, out, cases, ordered_resize=False):
    run = Path(run).resolve()
    out = fresh_directory(path=out)
    model, evidence = pinned_candidate(run=run)
    model = substitute(model=model, ordered_resize=ordered_resize)
    report = {"format": "qcut-bandou-phase5-candidate-v1", "status": "running",
              "scope": "full-original-graph-with-ordered-convolution-vs-frozen-native",
              "candidate_enabled": False, "tolerance": {"atol": 1e-4, "rtol": 1e-4},
              **evidence, "ordered_resize": ordered_resize, "cases": []}
    for name in cases:
        if not name or Path(name).name != name:
            raise ValueError("case must be a basename")
        source = run / f"case-{name}"
        inputs = read_tensors(path=source / "inputs.npz")
        expected = read_tensors(path=source / "native.npz")
        started = time.monotonic()
        with torch.inference_mode():
            actual = model(inputs)
        seconds = time.monotonic() - started
        directory = out / f"case-{name}"
        directory.mkdir()
        np.savez(directory / "pytorch.npz", **{key: value.numpy() for key, value in actual.items()})
        result = comparison(native=expected, actual=actual)
        result.update(case=name, seconds=seconds, input_sha256=sha256(path=source / "inputs.npz"),
                      reference_sha256=sha256(path=source / "native.npz"))
        report["cases"].append(result)
        print(json.dumps(result), flush=True)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    report["status"] = "diagnostic-pass" if bool(cases) and all(item["passed"] for item in report["cases"]) else "verification-failed"
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cases", nargs="+", required=True)
    parser.add_argument("--ordered-resize", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    replay(run=args.run, out=args.out, cases=args.cases, ordered_resize=args.ordered_resize)


if __name__ == "__main__":
    main()
