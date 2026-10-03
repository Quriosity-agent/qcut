"""Run the complete alignment ONNX artifacts without Torch or native inference."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
import onnxruntime

import espresso_oracle
from espresso_graph import analyze
from espresso_onnx_runtime import session
from face_alignment_heads_parity import FLOAT_LIMITS, comparisons


def no_torch():
    if importlib.util.find_spec("torch") is not None or any(
            name == "torch" or name.startswith("torch.") for name in sys.modules):
        raise ValueError("standalone verification requires no installed or imported Torch")


def compare_integer(*, actual, expected, descriptor, raw):
    if (actual.shape != expected.shape or actual.size == 0 or actual.dtype != np.int64
            or not np.issubdtype(expected.dtype, np.integer)
            or tuple(raw) != (descriptor["type"], descriptor["fraction"])):
        return {"passed": False, "reason": "integer output contract mismatch"}
    difference = np.abs(actual - expected.astype(np.int64))
    return {"passed": not bool(difference.any()), "elements": int(actual.size),
            "mismatches": int(np.count_nonzero(difference)), "max_abs": int(difference.max())}


def original_outputs(*, directory, graph, graph_hash, arena_hash):
    response = json.loads((directory / "response.json").read_text())
    if (not isinstance(response, dict) or response.get("version") != 2
            or response.get("runtime_sha256") != espresso_oracle.RUNTIME_SHA256
            or response.get("graph_sha256") != graph_hash or response.get("arena_sha256") != arena_hash):
        raise ValueError("original response provenance mismatch")
    names = {name for layer in graph["layers"] if layer["op"] != "Input" for name in layer["outputs"]}
    records = response.get("outputs")
    if not isinstance(records, list) or len(records) != len(names):
        raise ValueError("complete original intermediate outputs required")
    result = {}
    for item in records:
        if not isinstance(item, dict) or item.get("name") not in names or item["name"] in result:
            raise ValueError("unknown or duplicate original output")
        name, file = item["name"], item.get("file")
        descriptor = graph["descriptors"][name]
        raw = (descriptor["type"], descriptor["fraction"])
        n, h, w, c = graph["shapes"][name]
        if (item.get("raw") != list(raw) or item.get("dims_nwhc") != [n, w, h, c]
                or not isinstance(file, str) or not file or Path(file).name != file or file in (".", "..")):
            raise ValueError("original output storage, shape or path mismatch")
        value = np.fromfile(directory / file, dtype=espresso_oracle.DTYPES[raw[0]])
        if value.size != n * h * w * c or not np.isfinite(value).all():
            raise ValueError("original output bytes or finiteness mismatch")
        result[name] = value.reshape(n, h, w, c), raw
    return result


def run(*, root, networks, output):
    no_torch()
    root, output = (espresso_oracle.private_path(path=path) for path in (root, output))
    if output.exists():
        raise ValueError("refusing to overwrite standalone ONNX evidence")
    summary = json.loads((root / "summary.json").read_text())
    if (not isinstance(summary, dict) or summary.get("passed") is not True
            or summary.get("native_oracle_sha256") != espresso_oracle.RUNTIME_SHA256
            or summary.get("float_policies") != {key: list(value) for key, value in FLOAT_LIMITS.items()}
            or set(summary.get("networks", {})) != {"120", "160"}):
        raise ValueError("passed complete alignment evidence required")
    reports = {}
    for size, metadata in summary["networks"].items():
        directory = root / f"align-{size}"
        candidates = [path for path in Path(networks).glob("*/graph.txt")
                      if espresso_oracle.sha256(path=path) == metadata["graph_sha256"]]
        if len(candidates) != 1:
            raise ValueError("one hash-matched source graph required")
        graph_path = candidates[0]
        if espresso_oracle.sha256(path=graph_path.with_name("arena.bin")) != metadata["arena_sha256"]:
            raise ValueError("source arena hash mismatch")
        graph = analyze(graph_path.read_text())
        checkers = comparisons(graph=graph)
        names = [name for layer in graph["layers"] if layer["op"] != "Input" for name in layer["outputs"]]
        terminals = metadata["terminal_names"]
        inputs = [layer for layer in graph["layers"] if layer["op"] == "Input"]
        if len(inputs) != 1 or len(names) != 96 or len(terminals) != 5:
            raise ValueError("expected complete alignment graph")
        for file in ("model.onnx", "all-layers.onnx"):
            path = directory / "artifacts" / file
            if espresso_oracle.sha256(path=path) != summary["artifacts"].get(str(path.relative_to(root))):
                raise ValueError("ONNX artifact hash mismatch")
        all_session = session(path=directory / "artifacts/all-layers.onnx")
        terminal_session = session(path=directory / "artifacts/model.onnx")
        try:
            for label, report in metadata["cases"].items():
                if label not in {"seed-17", "seed-41", "seed-509", "black", "neutral", "white", "recorded-face"}:
                    raise ValueError("unknown alignment input case")
                value = np.load(directory / label / "input.npy", allow_pickle=False)
                source = inputs[0]
                if (value.shape != source["shape"] or not np.issubdtype(value.dtype, np.signedinteger)
                        or value.min() < -128 or value.max() > 127
                        or hashlib.sha256(value.tobytes()).hexdigest() != report["input_sha256"][source["name"]]):
                    raise ValueError("recorded case input contract or hash mismatch")
                expected = original_outputs(directory=directory / label / "native", graph=graph,
                                            graph_hash=metadata["graph_sha256"], arena_hash=metadata["arena_sha256"])
                feed = {source["name"]: value.astype(np.int64)}
                checks = {}
                for provider, runner, outputs in (("all", all_session, names), ("terminal", terminal_session, terminals)):
                    if [item.name for item in runner.get_outputs()] != outputs:
                        raise ValueError("ONNX output names mismatch")
                    for name, actual in zip(outputs, runner.run(None, feed), strict=True):
                        original, raw = expected[name]
                        checker = checkers.get(name, compare_integer)
                        checks[provider + "/" + name] = checker(actual=actual, expected=original,
                                                              descriptor=graph["descriptors"][name], raw=raw)
                reports[size + "/" + label] = {"passed": all(check["passed"] for check in checks.values()), "checks": checks}
        finally:
            all_session = terminal_session = None
    no_torch()
    if len(reports) != 14:
        raise ValueError("all fourteen standalone input cases required")
    result = {"passed": all(report["passed"] for report in reports.values()),
              "torch_installed": False, "torch_imported": False, "native_inference_called": False,
              "cases": reports, "checks": sum(len(report["checks"]) for report in reports.values()),
              "source_summary_sha256": espresso_oracle.sha256(path=root / "summary.json"),
              "versions": {"numpy": np.__version__, "onnxruntime": onnxruntime.__version__}}
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--networks", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = run(root=args.root, networks=args.networks, output=args.out)
    print(json.dumps({key: result[key] for key in ("passed", "torch_installed", "torch_imported", "checks")}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
