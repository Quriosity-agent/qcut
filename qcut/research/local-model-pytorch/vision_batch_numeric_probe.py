"""Compare execution layouts against frozen native outputs without changing tolerances."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from classifier_export import compare_outputs
from vision_batch_export import fresh_directory
from vision_batch_torch import load_model


def diagnose(*, run, out, cases):
    out = fresh_directory(path=out)
    report = json.loads((run / "report.json").read_text())
    results = []
    for layout in ("contiguous", "channels-last"):
        model = load_model(path=report["artifact"], expected_sha256=report["artifact_sha256"], allow_unverified=True)
        memory_format = torch.contiguous_format if layout == "contiguous" else torch.channels_last
        model.to(memory_format=memory_format)
        for case in cases:
            directory = run / f"case-{case}"
            with np.load(directory / "inputs.npz", allow_pickle=False) as archive:
                inputs = {k: torch.from_numpy(archive[k].copy()).contiguous(memory_format=memory_format) for k in archive.files}
            with np.load(directory / "native.npz", allow_pickle=False) as archive:
                expected = {k: torch.from_numpy(archive[k].copy()) for k in archive.files}
            with torch.inference_mode():
                actual = model(inputs)
            result = compare_outputs(expected=expected, actual=actual)
            result.update(layout=layout, case=case, scope="diagnostic-only-existing-frozen-native-reference")
            results.append(result)
            print(json.dumps(result), flush=True)
            (out / "report.json").write_text(json.dumps(results, indent=2, allow_nan=False) + "\n")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cases", nargs="+", default=["random-17", "holdout-normal-509"])
    args = parser.parse_args()
    torch.set_num_threads(2)
    diagnose(run=args.run, out=args.out, cases=args.cases)


if __name__ == "__main__":
    main()
