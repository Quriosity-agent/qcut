"""Recompute skeleton profile differences from source pixels, with private local models."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

from body_coreml_normalization import normalize_body_coreml_input


class RecordedNetworks:
    def __init__(self, *, networks):
        self.networks = networks
        self.provenance = networks.provenance
        self.calls = []

    def infer(self, *, tensor, network):
        result = self.networks.infer(tensor=tensor, network=network)
        self.calls.append({"network": network, "input": tensor.copy(), **{key: value.copy() for key, value in result.items()}})
        return result


def difference(*, left, right):
    delta = np.abs(left.astype(np.float64) - right.astype(np.float64))
    return {"exact": np.array_equal(left, right), "count": int(np.count_nonzero(delta)),
            "maximum": float(delta.max(initial=0)), "mean": float(delta.mean()) if delta.size else 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.engine))
    from body_mesh_renderer import algorithm_image
    from body_skeleton_model import load_networks
    from body_skeleton_sequence import BodySkeletonSequence
    from body_cold_start_candidate import ColdStartSkeletonCandidate
    from body_algorithm_size import body_algorithm_size

    provenance = json.loads((args.evidence / "provenance.json").read_text())
    input_paths = [Path(path) for path in provenance["inputs"]]
    traces = {name: json.loads((args.evidence / name / "trace.json").read_text()) for name in provenance["profiles"]}
    engines = {"warm": BodySkeletonSequence(networks=RecordedNetworks(networks=load_networks(runtime=args.runtime))),
               "cold": ColdStartSkeletonCandidate(networks=RecordedNetworks(networks=load_networks(runtime=args.runtime)))}
    output = args.evidence / "owned"
    output.mkdir(exist_ok=False)
    report = {"scope": "Source-independent CPU skeleton diagnostics; not complete pixel parity", "rows": [],
              "nativeLibrarySha256": provenance["library"]["sha256"], "candidateSources": {},
              "nativePointsUsedAsInput": False, "nativeAlgorithmUsedAsInput": False,
              "networkProvenance": engines["warm"].networks.provenance,
              "uniqueSourceHashes": len(set(provenance["inputs"].values())),
              "sourceFrameCount": len(input_paths), "nativeCallCount": len(traces["default"]["calls"])}
    for path in sorted(args.engine.rglob("*.py")):
        report["candidateSources"][str(path.relative_to(args.engine))] = hashlib.sha256(path.read_bytes()).hexdigest()
    report["probeSources"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in Path(__file__).parent.glob("*body*profile*.py")}
    for name in ("body_cold_start_candidate.py", "test_body_cold_start_candidate.py", "body_coreml_normalization.py", "test_body_coreml_normalization.py"):
        path = Path(__file__).parent / name
        report["probeSources"][name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if any(len(trace["calls"]) != 2 * len(input_paths) for trace in traces.values()):
        raise ValueError("comparison requires the measured two-call production host schedule")
    width, height = provenance.get("width", 1080), provenance.get("height", 1920)
    last_source = None
    for index, call in enumerate(traces["default"]["calls"]):
        source = input_paths[index // 2]
        if source != last_source:
            rgba = np.fromfile(source, np.uint8).reshape(height, width, 4)
            size = body_algorithm_size(size=(width, height), source_changed=False)
            algorithm, raster_receipt = algorithm_image(rgba=rgba, runtime=args.runtime, output_size=size)
            raster_path = output / ("algorithm-%03d.rgba" % (index // 2))
            algorithm.tofile(raster_path)
            (raster_path.with_suffix(".json")).write_text(json.dumps(raster_receipt, indent=2))
            last_source = source
        native_algorithm = np.fromfile(args.evidence / "default" / call["algorithmFile"], np.uint8).reshape(call["height"], call["stride"] // 4, 4)[:, :call["width"]]
        row = {"call": index, "source": str(source), "algorithm": difference(left=algorithm, right=native_algorithm),
               "ownedAlgorithmFile": str(raster_path.relative_to(args.evidence)),
               "ownedAlgorithmSha256": hashlib.sha256(algorithm.tobytes()).hexdigest(), "candidates": {}, "ownedPoints": {}}
        for name, engine in engines.items():
            engine.networks.calls.clear()
            body = engine.update(algorithm=algorithm)
            actual = body["sdkPoints"] if body is not None else np.empty((0, 4), np.float32)
            point_path = output / ("%s-%03d.npy" % (name, index))
            np.save(point_path, actual, allow_pickle=False)
            row["ownedPoints"][name] = {"file": str(point_path.relative_to(args.evidence)),
                                        "sha256": hashlib.sha256(point_path.read_bytes()).hexdigest(),
                                        "shape": list(actual.shape), "bodyPresent": body is not None}
            inferences = []
            for pass_index, inference in enumerate(engine.networks.calls):
                tensors = {key: value for key, value in inference.items() if key != "network"}
                bgr = (inference["input"][0].astype(np.int32) + 128).astype(np.uint8)
                tensors["owned_coreml_input"] = normalize_body_coreml_input(bgr=bgr)[None]
                path = output / ("%s-%03d-pass%d.npz" % (name, index, pass_index))
                np.savez_compressed(path, **tensors)
                inferences.append({"file": str(path.relative_to(args.evidence)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                   "network": inference["network"]})
            row["ownedPoints"][name]["inferences"] = inferences
            comparisons = {}
            for profile, trace in traces.items():
                native = trace["calls"][index]["public"]
                expected = np.asarray(native[0], np.float32) if native else np.empty((0, 4), np.float32)
                comparisons[profile] = {"presenceExact": actual.shape == expected.shape}
                if actual.shape == expected.shape:
                    comparisons[profile]["points"] = difference(left=actual, right=expected)
                    comparisons[profile]["coordinates"] = difference(left=actual[:, :2], right=expected[:, :2])
                    comparisons[profile]["confidence"] = difference(left=actual[:, 2], right=expected[:, 2])
            row["candidates"][name] = comparisons
        report["rows"].append(row)
        print(json.dumps(row), flush=True)
    (args.evidence / "owned-comparison.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
