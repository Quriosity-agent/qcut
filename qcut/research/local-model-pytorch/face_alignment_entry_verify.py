"""Compare original Inference-entry captures to the bounded alignment probe.

This verifies captured bytes, not an independent network or the GUI path.
The capture is produced by the existing private ByteNN interposer.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from espresso_oracle import DTYPES, private_path, sha256
from face_alignment_input_verify import difference, evidence_passed


def fields(*, record):
    pairs = [item.split("=", 1) for item in record["detail"].split() if "=" in item]
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("duplicate capture metadata fields")
    return result


def verify(*, capture, profiles):
    records = [(path, json.loads(path.read_text())) for path in sorted(Path(capture).glob("*.json"))]
    objects = {}
    for _, record in records:
        if record["kind"] != "espresso-input":
            continue
        info = fields(record=record)
        for size in (120, 160):
            if info.get("dims") == f"1,{size},{size},3":
                objects[info["self"]] = size
    if sorted(objects.values()) != [120, 160]:
        raise ValueError("exactly one captured network per 120/160 profile is required")
    expected = {}
    for size in (120, 160):
        root = Path(profiles) / f"profile-{size}"
        report = json.loads((root / "report.json").read_text())
        if report.get("size") != size or not evidence_passed(report=report):
            raise ValueError("alignment profile has not passed its original-stage controls")
        for name, filename in (("data", "actual-network-input.npy"), ("fc_landmark_s1", "actual-raw-landmarks.npy")):
            path = root / filename
            digest = report["input_sha256" if name == "data" else "landmarks_sha256"]
            if sha256(path=path) != digest:
                raise ValueError("alignment reference changed since the stage probe")
            expected[size, name] = np.load(path, allow_pickle=False)
    comparisons, completed = {}, set()
    for path, record in records:
        if record["kind"] not in ("espresso-input", "espresso-output", "espresso-inference"):
            continue
        info = fields(record=record)
        size = objects.get(info["self"])
        inference = int(info["inference"])
        if size is None or inference < 0:
            continue
        if inference not in (0, 1):
            raise ValueError("entry probe requires exactly two inferences per profile")
        if record["kind"] == "espresso-inference":
            if info.get("rc") != "0" or (size, inference) in completed:
                raise ValueError("failed or duplicate original inference")
            completed.add((size, inference))
            continue
        name = info["name"]
        if (record["kind"], name) not in (("espresso-input", "data"), ("espresso-output", "fc_landmark_s1")):
            continue
        key = (size, inference, name)
        raw = tuple(map(int, info["raw"].split(",")))
        dims = tuple(map(int, info["dims"].split(",")))
        target_raw = ((2, 6) if size == 120 else (1, 6)) if name == "data" else (4, 0)
        target_dims = (1, size, size, 3) if name == "data" else (1, 1, 1, 212)
        if raw != target_raw or dims != target_dims or key in comparisons:
            raise ValueError("unexpected or duplicate captured tensor descriptor")
        binary = path.with_suffix(".bin")
        expected_bytes = int(np.prod(dims)) * DTYPES[raw[0]].itemsize
        if record["bytes"] != expected_bytes or binary.stat().st_size != expected_bytes:
            raise ValueError("incomplete capture bytes")
        value = np.fromfile(binary, dtype=DTYPES[raw[0]]).reshape(1, dims[2], dims[1], dims[3])
        comparisons[key] = {"size": size, "inference": inference, "name": name,
                            "capture_sha256": sha256(path=binary),
                            **difference(actual=value, expected=expected[size, name])}
    required = {(size, inference, name) for size in (120, 160) for inference in (0, 1)
                for name in ("data", "fc_landmark_s1")}
    if set(comparisons) != required or completed != {(size, index) for size in (120, 160) for index in (0, 1)}:
        raise ValueError("missing input, output or successful inference evidence")
    return {"scope": "original native entry bytes vs post-inference readback, two explicit profiles",
            "cases": list(comparisons.values()), "passed": all(item["exact"] for item in comparisons.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    output = private_path(path=args.out)
    report = verify(capture=private_path(path=args.capture), profiles=private_path(path=args.profiles))
    with output.open("x") as stream:
        stream.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "tensors": len(report["cases"])}))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
