"""Reduce actual-frame failed pixels to a four-pixel native Softmax witness."""
import argparse
import json
from pathlib import Path

import torch

from matting_cpu_boundary import bucket_witnesses, metrics
from matting_cpu_export import (compile_oracle, digest, fresh_directory, read_tensor,
                                run_oracle, write_schema, write_tensor)
from matting_cpu_math import two_channel_softmax


def reproduce(*, trace: Path, out: Path) -> dict[str, object]:
    trace = trace.resolve()
    source = json.loads((trace / "report.json").read_text())
    if source["native"].get("status") != "completed" or source["native"].get("forward_type") != 0:
        raise ValueError("completed CPU full-graph trace required")
    directory = trace / "case-000-trace"
    shape = (1, 2, 256, 256)
    logits = {key: read_tensor(path=directory / f"{prefix}-main.decode_head.up_cls.f32", shape=shape)
              for key, prefix in (("native", "out"), ("pytorch", "pytorch"))}
    probability = read_tensor(path=directory / "out-nn_3.f32", shape=shape)
    witnesses = bucket_witnesses(actual_logits=logits["pytorch"], native_logits=logits["native"],
                                 native_probabilities=probability)["witnesses"]
    if len(witnesses) < 4:
        raise ValueError("four distinct failing pixels required to preserve the SIMD/no-tail path")
    coordinates = [row["pixel_nhw"] for row in witnesses[:4]]
    out = fresh_directory(path=out)
    graph, arena = out / "synthetic-graph.private.txt", out / "synthetic-arena.private.bin"
    graph.write_text("D\\n\n1 1 0\\n\nDataV2 data 1 2 2 2 4 0 0\\n\nSoftmax result data result\\n\n")
    arena.write_bytes(bytes(4))
    compact_shape = (1, 2, 2, 2)
    write_schema(path=out / "inputs.tsv", shapes={"data": compact_shape})
    write_schema(path=out / "outputs.tsv", shapes={"result": compact_shape})
    compact = {}
    paths = {}
    for index, (key, tensor) in enumerate(logits.items()):
        compact[key] = torch.stack([tensor[n, :, y, x] for n, y, x in coordinates], dim=1).reshape(compact_shape)
        paths[key] = out / f"case-{index:03d}-{key}"
        paths[key].mkdir()
        write_tensor(path=paths[key] / "in-data.f32", value=compact[key])
    native = run_oracle(binary=compile_oracle(out=out), graph=graph, arena=arena, out=out)
    cases = {}
    native_results = {}
    if native["status"] == "completed":
        for key, path in paths.items():
            expected = read_tensor(path=path / "out-result.f32", shape=compact_shape)
            native_results[key] = expected
            actual = two_channel_softmax(value=compact[key])
            echo = (path / "in-data.f32").read_bytes() == (path / "echo-data.f32").read_bytes() == (path / "applied-data.f32").read_bytes()
            cases[key] = {"input_echo_exact": echo, "portable_softmax": metrics(actual=actual, expected=expected)}
        selected_probability = torch.stack([probability[n, :, y, x] for n, y, x in coordinates], dim=1).reshape(compact_shape)
        original_exact = metrics(actual=native_results["native"], expected=selected_probability)
        jump = metrics(actual=native_results["pytorch"], expected=native_results["native"])
    else:
        original_exact, jump = None, None
    reproduced = (bool(cases) and all(row["input_echo_exact"] and row["portable_softmax"]["bitwise_equal"] for row in cases.values())
                  and original_exact["bitwise_equal"] and not jump["passed"])
    result = {"status": "diagnostic-reproduced" if reproduced else "diagnostic-not-reproduced", "native": native,
              "source_trace": str(trace), "source_trace_sha256": digest(data=(trace / "report.json").read_bytes()),
              "source_sha256": source["source_sha256"], "artifact_sha256": source["artifact_sha256"],
              "coordinates_nhw": coordinates, "cases": cases,
              "input_difference": metrics(actual=compact["pytorch"], expected=compact["native"]),
              "native_output_difference": jump, "full_graph_native_probability_replay": original_exact,
              "scope": "four actual failed pixels; native accepts two nearby input sets and produces a strict-tolerance probability jump; not a model fix",
              "tolerances": {"atol": 1e-4, "rtol": 1e-4}}
    (out / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trace", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = reproduce(trace=args.trace, out=args.out)
    print(json.dumps({key: report[key] for key in ("status", "input_difference", "native_output_difference")}, indent=2))
    return 0 if report["status"] == "diagnostic-reproduced" else 1


if __name__ == "__main__":
    raise SystemExit(main())
