"""Bounded, hash-bound bandou prefix and same-input convolution diagnostics."""
import argparse
import json
from pathlib import Path
import time

import numpy as np
import torch
from torch.nn import functional as F

from bytenn_oracle import LIBRARY, predict, sha256
from classifier_export import compare_outputs
from ocr_rec_numeric import ordered_convolution
from vision_batch_export import fresh_directory
from vision_batch_profiles import PROFILES, RUNTIME_SHA256
from vision_batch_torch import VisionGraph, load_model, state_digest

ARENA_SHA256 = "6b318af6d358caf4e7bcf3dc85015d1b076afedd9086d0b1a255e2a2d53f9729"


def read_tensors(*, path):
    with np.load(path, allow_pickle=False) as archive:
        if not archive.files or len(archive.files) != len(set(archive.files)):
            raise ValueError("empty or duplicate tensors")
        tensors = {key: torch.from_numpy(archive[key].copy()) for key in archive.files}
    if any(value.dtype != torch.float32 or not torch.isfinite(value).all() for value in tensors.values()):
        raise ValueError("finite FP32 tensors required")
    return tensors


def pinned_candidate(*, run):
    run = Path(run).resolve()
    report_path = run / "report.json"
    report = json.loads(report_path.read_text())
    spec = PROFILES["bandou"]
    if report.get("profile") != "bandou" or any(report.get(key) != spec[key] for key in
                                               ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256")):
        raise ValueError("unexpected bandou report identity")
    files = {Path(report["source"]): spec["source_sha256"],
             run / "network.private.bm": spec["bm_sha256"],
             run / "graph.private.txt": spec["graph_sha256"],
             run / "arena.private.bin": ARENA_SHA256, LIBRARY: RUNTIME_SHA256,
             Path(report["artifact"]): report["artifact_sha256"]}
    if any(sha256(path=path) != expected for path, expected in files.items()):
        raise ValueError("bandou source, graph, arena, runtime or artifact changed")
    model = load_model(path=report["artifact"], expected_sha256=report["artifact_sha256"], allow_unverified=True)
    if state_digest(state=model.state_dict()) != spec["state_sha256"]:
        raise ValueError("bandou state changed")
    evidence = {"source_sha256": spec["source_sha256"], "state_sha256": spec["state_sha256"],
                "parent_report_sha256": sha256(path=report_path),
                "files_sha256": {str(path): value for path, value in files.items()}}
    return model, evidence


def comparison(*, native, actual):
    result = compare_outputs(expected=native, actual=actual)
    for name, reference in native.items():
        if name not in actual or not result["outputs"].get(name, {}).get("finite_and_shape_valid"):
            continue
        candidate = actual[name]
        error = (reference.double() - candidate.double()).abs()
        index = int(error.flatten().argmax())
        result["outputs"][name].update(equal_elements=int((reference == candidate).sum()),
                                        max_error_flat_index=index,
                                        reference_at_max=float(reference.flatten()[index]),
                                        actual_at_max=float(candidate.flatten()[index]))
    return result


def output_differs(*, item):
    """A nonfinite or unshaped capture is a difference, not a skipped comparison."""
    if not item.get("finite_and_shape_valid"):
        return True
    return item.get("equal_elements") != item.get("compared_elements")


def prefix_text(*, nodes, index):
    if type(index) is not int or not 1 <= index < len(nodes):
        raise ValueError("bounded nonempty prefix required")
    return "D\\n\n" + f"1 {index} 0\\n\n" + "\n".join(" ".join(row) + "\\n" for row in nodes[:index + 1]) + "\n"


def kernel_variants(*, value, layer, limit):
    if type(limit) is not int or not 1 <= limit <= layer.out_channels:
        raise ValueError("invalid bounded output-channel count")
    groups = layer.groups
    weight, bias = layer.weight[:limit], layer.bias[:limit]
    if groups != 1:
        if groups != layer.in_channels or groups != layer.out_channels:
            raise ValueError("only regular or depthwise kernels supported")
        value, groups = value[:, :limit].contiguous(), limit
    config = {"stride": layer.stride, "padding": layer.padding, "groups": groups}
    yield "torch-contiguous", F.conv2d(value.contiguous(), weight.contiguous(), bias, **config)
    yield "torch-channels-last", F.conv2d(value.contiguous(memory_format=torch.channels_last),
                                          weight.contiguous(memory_format=torch.channels_last), bias, **config)
    yield "fp64-sum", F.conv2d(value.double(), weight.double(), bias.double(), **config).float()
    # Reuse the recognizer's observed kernel as a hypothesis, not as native parity proof.
    yield "ordered-ocr-reference", ordered_convolution(value=value, weight=weight, bias=bias, **config)


def probe(*, run, out, case, indices, kernels=(), channels=8, ordered=False, ordered_resize=False, stop_at_difference=False):
    run = Path(run).resolve()
    model, evidence = pinned_candidate(run=run)
    if ordered:
        from bandou_phase5_candidate import substitute
        model = substitute(model=model, ordered_resize=ordered_resize)
    if not indices or len(indices) != len(set(indices)) or any(type(i) is not int or not 1 <= i < len(model.nodes) for i in indices):
        raise ValueError("unique bounded prefix indices required")
    if any(i not in indices or str(i) not in model.layers for i in kernels):
        raise ValueError("kernel index must also be a convolution prefix")
    if not case or Path(case).name != case:
        raise ValueError("case must be a basename")
    out = fresh_directory(path=out)
    inputs_path = run / f"case-{case}" / "inputs.npz"
    inputs = read_tensors(path=inputs_path)
    with torch.inference_mode():
        values = model(inputs, capture=True)
    report = {"format": "qcut-bandou-phase5-prefix-v1", "scope": "derived-prefix-and-same-input-kernel-only",
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "candidate_enabled": False,
              "case": case, "input_sha256": sha256(path=inputs_path), **evidence,
              "ordered_candidate": ordered, "ordered_resize": ordered_resize, "prefixes": [], "kernels": []}
    references = {0: inputs}
    requested = sorted(set(indices) | {i - 1 for i in kernels if i > 1})
    for index in requested:
        started = time.monotonic()
        text = prefix_text(nodes=model.nodes, index=index)
        graph = out / f"prefix-{index}.private.txt"
        graph.write_text(text)
        shape_model = VisionGraph(nodes=model.nodes[:index + 1])
        native = predict(graph=graph, arena=run / "arena.private.bin", inputs=inputs,
                         output_shapes=shape_model.output_shapes, out=out / f"native-{index}")
        references[index] = native
        np.savez(out / f"native-{index}.npz", **{key: value.numpy() for key, value in native.items()})
        result = comparison(native=native, actual={key: values[key] for key in native})
        result.update(index=index, op=model.steps[index]["op"], seconds=time.monotonic() - started,
                      graph_sha256=sha256(path=graph))
        report["prefixes"].append(result)
        print(json.dumps({"prefix": index, **result}), flush=True)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        if stop_at_difference and any(output_differs(item=item) for item in result["outputs"].values()):
            if kernels:
                raise ValueError("stop-at-difference cannot be combined with kernels")
            break
    for index in kernels:
        layer, step = model.layers[str(index)], model.steps[index]
        value = references[index - 1][step["inputs"][0]]
        limit = min(channels, layer.out_channels)
        expected = references[index][step["output"]][:, :limit]
        modes = {}
        with torch.inference_mode():
            for mode, actual in kernel_variants(value=value, layer=layer, limit=limit):
                actual = actual.relu() if step["params"]["relu"] else actual
                modes[mode] = comparison(native={"output": expected}, actual={"output": actual})
                print(json.dumps({"kernel": index, "mode": mode, **modes[mode]}), flush=True)
        report["kernels"].append({"index": index, "output_channels": limit, "modes": modes})
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    if any(sha256(path=path) != expected for path, expected in evidence["files_sha256"].items()):
        raise ValueError("evidence changed during diagnostic")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--case", default="random-17")
    parser.add_argument("--indices", type=int, nargs="+", required=True)
    parser.add_argument("--kernels", type=int, nargs="*", default=[])
    parser.add_argument("--channels", type=int, default=8)
    parser.add_argument("--ordered", action="store_true")
    parser.add_argument("--ordered-resize", action="store_true")
    parser.add_argument("--stop-at-difference", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(2)
    probe(run=args.run, out=args.out, case=args.case, indices=args.indices, kernels=args.kernels, channels=args.channels,
          ordered=args.ordered, ordered_resize=args.ordered_resize, stop_at_difference=args.stop_at_difference)


if __name__ == "__main__":
    main()
