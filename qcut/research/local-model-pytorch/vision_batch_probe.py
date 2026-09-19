"""Localize parity differences with explicitly derived prefix-only oracle runs."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from bytenn_oracle import predict
from classifier_export import compare_outputs
from vision_batch_export import fresh_directory
from vision_batch_torch import VisionGraph, digest, load_model


def probe(*, run, out, indices, case="random-17"):
    out = fresh_directory(path=out)
    report = json.loads((run / "report.json").read_text())
    model = load_model(path=report["artifact"], expected_sha256=report["artifact_sha256"], allow_unverified=True)
    with np.load(run / f"case-{case}" / "inputs.npz", allow_pickle=False) as archive:
        inputs = {k: torch.from_numpy(archive[k].copy()) for k in archive.files}
    with torch.inference_mode():
        values = model(inputs, capture=True)
    records = []
    original_text = (run / "graph.private.txt").read_text()
    prefix = "D\\n\n" if original_text.startswith("D") else ""
    for index in indices:
        if not 1 <= index < len(model.nodes):
            raise ValueError("invalid prefix index")
        nodes = model.nodes[:index + 1]
        shape_model = VisionGraph(nodes=nodes)
        graph = out / f"prefix-{index}.private.txt"
        text = prefix + f"1 {index} 0\\n\n" + "\n".join(" ".join(row) + "\\n" for row in nodes) + "\n"
        graph.write_text(text)
        native = predict(graph=graph, arena=run / "arena.private.bin", inputs=inputs,
                         output_shapes=shape_model.output_shapes, out=out / f"native-{index}")
        np.savez(out / f"native-{index}.npz", **{k: v.numpy() for k, v in native.items()})
        expected = {k: values[k] for k in shape_model.output_shapes}
        result = compare_outputs(expected=native, actual=expected)
        result.update(index=index, op=nodes[-1][0], scope="derived-prefix-not-original-full-graph",
                      graph_sha256=digest(data=text.encode()))
        records.append(result)
        print(json.dumps(result), flush=True)
        (out / "report.json").write_text(json.dumps(records, indent=2, allow_nan=False) + "\n")
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--indices", type=int, nargs="+", required=True)
    parser.add_argument("--case", default="random-17")
    args = parser.parse_args()
    torch.set_num_threads(2)
    probe(run=args.run, out=args.out, indices=args.indices, case=args.case)


if __name__ == "__main__":
    main()
