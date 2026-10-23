"""Recompute local raw-tensor evidence without running or modifying native code."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from compare_body_default_profile import difference


def load_tensor(*, directory, metadata):
    path = directory / metadata["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ValueError("tensor identity mismatch")
    dtype = {2: np.dtype("<i2"), 4: np.dtype("<f4")}[metadata["storage"]]
    return np.fromfile(path, dtype=dtype).reshape(metadata["shape"])


def values(*, directory, metadata):
    array = load_tensor(directory=directory, metadata=metadata)
    return array.astype(np.float32) / np.float32(2 ** metadata["fraction"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    root = args.evidence
    profiles = ("default", "cpu", "coreml-cpu-input")
    traces = {name: json.loads((root / name / "trace.json").read_text()) for name in profiles}
    owned = json.loads((root / "owned-comparison.json").read_text())
    observations = []
    for call_index, call in enumerate(traces["default"]["calls"]):
        for pass_index, stage in enumerate(call["passes"]):
            own_meta = owned["rows"][call_index]["ownedPoints"]["cold"]["inferences"][pass_index]
            own_path = root / own_meta["file"]
            if hashlib.sha256(own_path.read_bytes()).hexdigest() != own_meta["sha256"]:
                raise ValueError("owned tensor identity mismatch")
            with np.load(own_path, allow_pickle=False) as candidate:
                default_input = load_tensor(directory=root / "default", metadata=stage["inputTensors"][0])
                own_input = candidate["input"] if stage["inputTensors"][0]["storage"] == 2 else candidate["owned_coreml_input"]
                row = {"call": call_index, "pass": pass_index, "network": stage["network"],
                       "defaultInputStorage": stage["inputTensors"][0]["storage"],
                       "defaultInputVsOwned": difference(left=default_input, right=own_input), "outputs": []}
                cpu_stage = traces["cpu"]["calls"][call_index]["passes"][pass_index]
                controlled = traces["coreml-cpu-input"]["calls"][call_index]["passes"][pass_index]
                cpu_input = load_tensor(directory=root / "cpu", metadata=cpu_stage["inputTensors"][0])
                row["cpuInputVsOwned"] = difference(left=cpu_input, right=candidate["input"])
                if default_input.dtype == np.float32:
                    restored = np.rint((default_input.astype(np.float64) + 2) * 63.75) - 128
                    row["defaultRecoveredPixelsVsCpuInput"] = difference(left=restored, right=cpu_input)
                    changed_input = load_tensor(directory=root / "coreml-cpu-input", metadata=controlled["inputTensors"][0])
                    row["controlledInputVsCpuPhysicalValues"] = difference(left=changed_input, right=cpu_input.astype(np.float32) / 64)
                output_names = ("heatmap_output_0", "vectormap_output_0") if stage["network"] == "coarse" else ("output_0",)
                for index, key in enumerate(output_names):
                    native = values(directory=root / "default", metadata=stage["outputTensors"][index])
                    cpu = values(directory=root / "cpu", metadata=cpu_stage["outputTensors"][index])
                    altered = values(directory=root / "coreml-cpu-input", metadata=controlled["outputTensors"][index])
                    row["outputs"].append({"name": key, "shape": list(native.shape),
                        "defaultVsCpu": difference(left=native, right=cpu),
                        "cpuVsOwned": difference(left=cpu, right=candidate[key].astype(np.float32) / 1024),
                        "controlledVsCpu": difference(left=altered, right=cpu),
                        "defaultVsControlled": difference(left=native, right=altered)})
                observations.append(row)
    report = {"scope": "Raw model tensors before pose decode; later frames may inherit different crops",
              "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "rows": observations}
    (root / "tensor-comparison.json").write_text(json.dumps(report, indent=2))
    first_float = next(row for row in observations if row["defaultInputStorage"] == 4)
    print(json.dumps({"firstFloatCall": first_float, "stages": len(observations)}, indent=2))


if __name__ == "__main__":
    main()
