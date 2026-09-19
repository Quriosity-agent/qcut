"""Retain explicitly requested graph tensors and locate strict CPU mismatches."""
import argparse
import json
from pathlib import Path

import torch

from matting_cpu_export import (INPUT_SHAPES, compare, compile_oracle, fresh_directory,
                                read_tensor, run_oracle, synthetic_cases, write_schema, write_tensor)
from matting_torch import load_model
from matting_cpu_math import two_channel_softmax
from matting_cpu_boundary import bucket_witnesses, channels_last_experiment, convolution_profiles, teacher_forced


def diagnose(*, run: Path, out: Path, case: str, case_dir: Path | None = None) -> dict[str, object]:
    out = fresh_directory(path=out)
    run = run.resolve()
    source_report = json.loads((run / "report.json").read_text())
    model = load_model(path=run / "matting-gru.pt", expected_sha256=source_report["artifact_sha256"], allow_unverified=True)
    inputs = (synthetic_cases()[case] if case_dir is None else
              {name: read_tensor(path=case_dir / f"applied-{name}.f32", shape=shape) for name, shape in INPUT_SHAPES.items()})
    with torch.inference_mode():
        trace = model(inputs, trace=True)
    intermediates = {name: value for name, value in trace.items() if name not in inputs}
    write_schema(path=out / "inputs.tsv", shapes=INPUT_SHAPES)
    write_schema(path=out / "outputs.tsv", shapes={name: tuple(value.shape) for name, value in intermediates.items()})
    directory = out / "case-000-trace"
    directory.mkdir()
    for name, value in inputs.items():
        write_tensor(path=directory / f"in-{name}.f32", value=value)
    native = run_oracle(binary=compile_oracle(out=out), graph=run / "graph.private.txt",
                        arena=run / "arena-fp32.private.bin", out=out)
    cases = []
    if native["status"] == "completed":
        for name, value in intermediates.items():
            expected = read_tensor(path=directory / f"out-{name}.f32", shape=tuple(value.shape))
            write_tensor(path=directory / f"pytorch-{name}.f32", value=value)
            result = compare(actual=value, expected=expected)
            result["tensor"] = name
            cases.append(result)
    isolated = None
    local_arithmetic = []
    profiles = []
    boundaries = None
    layout_experiment = None
    if native["status"] == "completed":
        logits = read_tensor(path=directory / "out-main.decode_head.up_cls.f32", shape=(1, 2, 256, 256))
        expected = read_tensor(path=directory / "out-nn_3.f32", shape=(1, 2, 256, 256))
        isolated = compare(actual=two_channel_softmax(value=logits), expected=expected)
        native_trace = {name: read_tensor(path=directory / f"out-{name}.f32", shape=tuple(value.shape))
                        for name, value in intermediates.items()}
        native_trace.update(inputs)
        local_arithmetic = teacher_forced(model=model, native=native_trace, propagated=trace)
        profiles = convolution_profiles(model=model, native=native_trace)
        layout_experiment = channels_last_experiment(model=model, inputs=inputs, native=native_trace)
        boundaries = bucket_witnesses(actual_logits=trace["main.decode_head.up_cls"], native_logits=logits,
                                      native_probabilities=expected)
    report = {"case": str(case_dir) if case_dir else case, "native": native, "tensor_comparisons": cases,
              "first_failure": next((item for item in cases if not item["passed"]), None),
              "isolated_cpu_softmax_on_native_logits": isolated,
              "local_arithmetic": local_arithmetic, "convolution_profiles": profiles,
              "first_local_bit_difference": next((item for item in local_arithmetic if not item["same_native_inputs"]["bitwise_equal"]), None),
              "bucket_boundary": boundaries,
              "channels_last_experiment": layout_experiment,
              "source_sha256": source_report["source_sha256"], "artifact_sha256": source_report["artifact_sha256"],
              "scope": "same full graph with every intermediate explicitly retained in CreateNet output names",
              "tolerances": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--case", default="random-17", choices=tuple(synthetic_cases()))
    parser.add_argument("--case-dir", type=Path)
    args = parser.parse_args()
    torch.set_num_threads(2)
    result = diagnose(run=args.run, out=args.out, case=args.case, case_dir=args.case_dir)
    print(json.dumps({"native": result["native"], "first_failure": result["first_failure"]}, indent=2))


if __name__ == "__main__":
    main()
