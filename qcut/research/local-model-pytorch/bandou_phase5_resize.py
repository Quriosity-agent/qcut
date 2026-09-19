"""Bounded half-pixel x2 interpolation arithmetic experiments on frozen prefixes."""
import argparse
import itertools
import json
from pathlib import Path

import torch

from bandou_phase5_probe import comparison, read_tensors
from bandou_phase5_numeric import blend, neighbours
from bytenn_oracle import sha256
from vision_batch_export import fresh_directory


def variants(*, value):
    (a, b, c, d), weights, dx, dy = neighbours(value=value)
    for horizontal_first in (True, False):
        for first_fused, second_fused in itertools.product((False, True), repeat=2):
            if horizontal_first:
                first = blend(left=a, right=b, ratio=dx, fused=first_fused)
                second = blend(left=c, right=d, ratio=dx, fused=first_fused)
                result = blend(left=first, right=second, ratio=dy, fused=second_fused)
            else:
                first = blend(left=a, right=c, ratio=dy, fused=first_fused)
                second = blend(left=b, right=d, ratio=dy, fused=first_fused)
                result = blend(left=first, right=second, ratio=dx, fused=second_fused)
            yield f"separable-{'xy' if horizontal_first else 'yx'}-{first_fused}-{second_fused}", result
    terms = (a, b, c, d)
    for order in itertools.permutations(range(4)):
        for fused in (False, True):
            result = terms[order[0]] * weights[order[0]]
            for index in order[1:]:
                result = (result.double() + terms[index].double() * weights[index].double()).float() if fused else result + terms[index] * weights[index]
            yield f"direct-{''.join(map(str, order))}-fused-{fused}", result


def probe(*, source, target, out):
    out = fresh_directory(path=out)
    inputs, expected = read_tensors(path=source), read_tensors(path=target)
    if len(inputs) != 1 or len(expected) != 1:
        raise ValueError("single-tensor frozen prefixes required")
    records = {}
    for name, actual in variants(value=next(iter(inputs.values()))):
        result = comparison(native={"output": next(iter(expected.values()))}, actual={"output": actual})
        records[name] = result
    report = {"scope": "arithmetic-hypotheses-only-not-full-network-parity", "candidate_enabled": False,
              "input_sha256": sha256(path=source), "reference_sha256": sha256(path=target), "modes": records}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    best = sorted(records, key=lambda key: records[key]["outputs"]["output"]["mae"])[:8]
    print(json.dumps({key: records[key] for key in best}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    with torch.inference_mode():
        probe(source=args.source, target=args.target, out=args.out)


if __name__ == "__main__":
    main()
