"""Isolated synthetic full-resolution softmax sweep against the pinned CPU."""
import argparse
import json
from pathlib import Path

import torch

from matting_cpu_export import (compare, compile_oracle, fresh_directory, read_tensor,
                                run_oracle, write_schema, write_tensor)
from matting_cpu_math import two_channel_softmax

SCOPE = "synthetic two-channel CPU Softmax only, fixed 256x256 vectorized profile"
CASE_NAMES = ("case-000-zero", "case-001-ramp", "case-002-holdout-random", "case-003-holdout-extreme")


def verify(*, out: Path):
    out = fresh_directory(path=out)
    shape = (1, 2, 256, 256)
    graph = out / "synthetic-graph.private.txt"
    graph.write_text("D\\n\n1 1 0\\n\nDataV2 data 1 256 256 2 4 0 0\\n\nSoftmax result data result\\n\n")
    arena = out / "synthetic-arena.private.bin"
    arena.write_bytes(b"\0" * 4)
    write_schema(path=out / "inputs.tsv", shapes={"data": shape})
    write_schema(path=out / "outputs.tsv", shapes={"result": shape})
    actuals = {}
    generator = torch.Generator().manual_seed(93847)
    values = {"zero": torch.zeros(shape), "ramp": torch.linspace(-40, 40, 131072).reshape(shape),
              "holdout-random": torch.rand(shape, generator=generator) * 24 - 12,
              "holdout-extreme": torch.rand(shape, generator=generator) * 2000 - 1000}
    if tuple(f"case-{index:03d}-{name}" for index, name in enumerate(values)) != CASE_NAMES:
        raise ValueError("synthetic proof case set drifted from the published contract")
    for index, (name, value) in enumerate(values.items()):
        directory = out / f"case-{index:03d}-{name}"
        directory.mkdir()
        write_tensor(path=directory / "in-data.f32", value=value)
        actuals[directory] = two_channel_softmax(value=value)
    native = run_oracle(binary=compile_oracle(out=out), graph=graph, arena=arena, out=out)
    cases = []
    if native["status"] == "completed":
        for directory, actual in actuals.items():
            expected = read_tensor(path=directory / "out-result.f32", shape=shape)
            result = compare(actual=actual, expected=expected)
            result.update(case=directory.name, bit_exact=torch.equal(actual, expected),
                          input_echo_exact=(directory / "in-data.f32").read_bytes() == (directory / "echo-data.f32").read_bytes())
            cases.append(result)
    report = {"status": "native-parity-passed" if cases and all(case["passed"] and case["input_echo_exact"] for case in cases) else "native-parity-failed",
              "native": native, "cases": cases, "scope": SCOPE,
              "tolerances": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = verify(out=args.out)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
