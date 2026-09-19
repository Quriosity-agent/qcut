"""Private prefix probes: diagnostic evidence, never full-graph parity claims."""
import argparse
import json
from pathlib import Path
import struct

import numpy as np
import torch

from tracking_graph import compile_graph
from tracking_probe import compile_oracle, make_cases, private_directory, recover, run_oracle
from tracking_torch import NETWORKS, TrackingGraph


def diagnose(*, name, out, start):
    out = private_directory(out=out)
    text, arena, _ = recover(name=name, out=out)
    binary = compile_oracle(out=out)
    lines = text.splitlines()
    records = []
    for length in range(start, len(lines) - 2):
        rows = [lines[0], f"1 {length} 1\\n", *lines[2:3 + length]]
        prefix = "\n".join(rows) + "\n"
        spec, _ = compile_graph(text=prefix)
        partial_arena = arena[:spec["arena_bytes_consumed"]] + struct.pack("<I", 1)
        model = TrackingGraph(text=prefix, arena=partial_arena)
        last = spec["nodes"][-1]
        outputs = last.get("outputs", [last.get("output")])
        directory = out / f"prefix-{length:03d}"
        directory.mkdir()
        (directory / "graph.private.txt").write_text(prefix)
        (directory / "weights.private.bin").write_bytes(partial_arena)
        (directory / "requests.txt").write_text("\n".join([*model.input_schema, *outputs]) + "\n")
        input_name = next(iter(model.input_schema))
        n, c, h, w = model.input_schema[input_name]["shape"]
        array = make_cases(shape=(n, h, w, c), fixed=spec["fixed"])["random-17"]
        case = directory / "case-random-17"
        case.mkdir()
        array.tofile(case / "input.bin")
        result = run_oracle(out=directory, binary=binary)
        tensors = {input_name: torch.from_numpy(array.transpose(0, 3, 1, 2).copy())}
        for node in spec["nodes"]:
            model._execute(node=node, values=tensors)
        entry = {"prefix_layers": length, "operator": last["op"], "name": last["name"], "returncode": result, "outputs": {}}
        if result:
            records.append(entry)
            break
        for output in outputs:
            actual = tensors[output].detach().numpy().transpose(0, 2, 3, 1).reshape(-1).astype(np.float64)
            native = np.fromfile(case / f"native-{output}.bin", dtype="<i2" if spec["fixed"] else "<f4").astype(np.float64)
            actual.astype("<f8").tofile(case / f"pytorch-{output}.f64")
            entry["outputs"][output] = {"passed": bool(np.allclose(actual, native, atol=1e-4, rtol=1e-4)),
                                         "max_abs": float(np.max(np.abs(actual - native))),
                                         "mae": float(np.mean(np.abs(actual - native)))}
        print(json.dumps(entry), flush=True)
        records.append(entry)
        if not all(value["passed"] for value in entry["outputs"].values()):
            break
    (out / "diagnosis.json").write_text(json.dumps({"scope": "derived-prefix-not-full-graph", "records": records}, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--name", choices=NETWORKS, required=True)
    parser.add_argument("--start", type=int, default=1)
    args = parser.parse_args()
    torch.set_num_threads(2)
    diagnose(name=args.name, out=args.out, start=args.start)


if __name__ == "__main__":
    main()
