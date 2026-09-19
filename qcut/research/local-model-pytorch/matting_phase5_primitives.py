"""Fresh full-shape activation/resize oracles, independent of graph traces."""
import argparse
import json
from pathlib import Path

import torch

from matting_cpu_boundary import metrics
from matting_cpu_export import compile_oracle, fresh_directory, read_tensor, run_oracle, write_schema, write_tensor
from matting_phase5_numeric import ordered_tanh, ordered_upsample, pinned_sigmoid


def specifications() -> list[tuple[str, tuple[int, ...]]]:
    return [(op, shape) for op, shapes in (
        ("Tanh", ((1, 80, 16, 16), (1, 56, 32, 32), (1, 32, 64, 64))),
        ("Sigmoid", ((1, 160, 16, 16), (1, 112, 32, 32), (1, 64, 64, 64))),
        ("UpSampling", ((1, 112, 16, 16), (1, 64, 32, 32), (1, 16, 64, 64), (1, 2, 128, 128))))
        for shape in shapes]


def verify(*, out: Path) -> dict[str, object]:
    out = fresh_directory(path=out)
    specs = specifications()
    inputs = {f"data{i}": shape for i, (_, shape) in enumerate(specs)}
    outputs = {f"result{i}": (shape[0], shape[1], shape[2] * 2, shape[3] * 2) if op == "UpSampling" else shape
               for i, (op, shape) in enumerate(specs)}
    lines = ["D", f"{len(inputs)} {len(outputs)} 0"]
    lines.extend(f"DataV2 {name} {n} {h} {w} {c} 4 0 0" for name, (n, c, h, w) in inputs.items())
    lines.extend(f"{op} result{i} data{i} result{i} {'LINEAR' if op == 'UpSampling' else '4 0'}" for i, (op, _) in enumerate(specs))
    graph, arena = out / "synthetic-graph.private.txt", out / "synthetic-arena.private.bin"
    graph.write_text("".join(line + "\\n\n" for line in lines))
    arena.write_bytes(b"\0" * 4)
    write_schema(path=out / "inputs.tsv", shapes=inputs)
    write_schema(path=out / "outputs.tsv", shapes=outputs)
    actuals = {}
    with torch.inference_mode():
        for number, name in enumerate(("zeros", "ramp", "holdout-90210", "holdout-81357")):
            directory = out / f"case-{number:03d}-{name}"
            directory.mkdir()
            generator = torch.Generator().manual_seed(90210 if number == 2 else 81357)
            actuals[directory] = {}
            for index, (op, shape) in enumerate(specs):
                value = (torch.zeros(shape) if number == 0 else torch.linspace(-8, 8, torch.Size(shape).numel()).reshape(shape)
                         if number == 1 else torch.rand(shape, generator=generator) * 16 - 8)
                write_tensor(path=directory / f"in-data{index}.f32", value=value)
                actual = (ordered_tanh(value=value) if op == "Tanh" else pinned_sigmoid(value=value)
                          if op == "Sigmoid" else ordered_upsample(value=value, formulation="pinned"))
                actuals[directory][f"result{index}"] = actual
                write_tensor(path=directory / f"pytorch-result{index}.f32", value=actual)
    native = run_oracle(binary=compile_oracle(out=out), graph=graph, arena=arena, out=out)
    results = []
    if native["status"] == "completed":
        for directory, actual in actuals.items():
            for index, (op, _) in enumerate(specs):
                name = f"result{index}"
                comparison = metrics(actual=actual[name], expected=read_tensor(path=directory / f"out-{name}.f32", shape=outputs[name]))
                exact_input = (directory / f"in-data{index}.f32").read_bytes() == (directory / f"echo-data{index}.f32").read_bytes()
                results.append({"case": directory.name, "operation": op, "output": name,
                                "input_echo_exact": exact_input, **comparison})
    passed = len(results) == 40 and all(row["passed"] and row["input_echo_exact"] for row in results)
    report = {"status": "native-parity-passed" if passed else "native-parity-failed", "native": native,
              "scope": "independent synthetic original-shape primitives, not a new network",
              "new_verified_networks": 0, "tolerances": {"atol": 1e-4, "rtol": 1e-4}, "comparisons": results}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = verify(out=args.out)
    print(json.dumps({"status": result["status"], "comparisons": len(result["comparisons"]),
                      "bitwise": sum(row["bitwise_equal"] for row in result["comparisons"])}))
    return 0 if result["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
