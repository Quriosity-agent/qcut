"""Recorded Stage1 ONNX -> diagnostic replay; not independent host inference.

Native crop/warp/mean/order/inverse are locked fixtures. Final consumer points
are compared unchanged, never used to fit or correct the produced coordinates.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sys

import numpy as np

import espresso_oracle
from face_alignment_heads_parity import FLOAT_LIMITS
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry import map_points, reorder_landmarks
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256
from face_render_consumer_probe import COORDINATE_SPACE, GRAPHICS_SHA256, GRAPHICS_UUID, validate_replay
from face_render_injection_inventory import LIBRARY_SHA256 as CORE_SHA256, UUID

HEADS = {"fc_landmark_s1": 212, "fc_visible": 106, "prob": 3, "fc_yaw": 1, "fc_pitch": 1}
NORMALIZATION = "x/width, 1-y/height; no endpoint correction or fitted transform"
UNRESOLVED = [
    "Recorded crop/warp is explicit base/detection geometry, not the final host route.",
    "Missing host-selected per-update Stage1 input, inverse, mean/order and their face-ID association.",
    "Stage2/iris/refinement, temporal filtering and host quality acceptance are not isolated.",
    "Full-dimension normalization is an explicit convention, not a verified native conversion ABI.",
]


def torch_imported():
    return any(name == "torch" or name.startswith("torch.") for name in sys.modules)


def strict_json(*, data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON field")
            result[key] = value
        return result

    def nonfinite(value):
        raise ValueError(f"non-finite JSON number: {value}")

    value = json.loads(data, object_pairs_hook=pairs, parse_constant=nonfinite)

    def finite(item):
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("non-finite JSON exponent")
        if isinstance(item, dict):
            for child in item.values():
                finite(child)
        if isinstance(item, list):
            for child in item:
                finite(child)

    finite(value)
    return value


def valid_hash(*, value):
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def object_field(*, value, name):
    result = value.get(name) if isinstance(value, dict) else None
    if not isinstance(result, dict):
        raise ValueError(f"object field required: {name}")
    return result


class LockedFiles:
    def __init__(self):
        self.files = {}
        self.identities = {}

    def read(self, *, path, maximum=32 * 1024**2, expected=None):
        path = Path(path).absolute()
        resolved = path.resolve(strict=True)
        before = resolved.stat()
        if not resolved.is_file() or not 0 < before.st_size <= maximum:
            raise ValueError(f"missing or oversized fixture: {path}")
        with resolved.open("rb") as stream:
            data = stream.read(maximum + 1)
        digest = hashlib.sha256(data).hexdigest()
        identity = (str(resolved), before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        after = resolved.stat()
        if (len(data) != before.st_size or len(data) > maximum or path.resolve(strict=True) != resolved
                or (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != identity[1:]):
            raise ValueError("fixture changed while reading")
        if expected is not None and (not valid_hash(value=expected) or digest != expected):
            raise ValueError(f"fixture hash mismatch: {path.name}")
        if str(path) in self.files and (self.files[str(path)] != digest or self.identities[str(path)] != identity):
            raise ValueError("fixture changed between reads")
        self.files[str(path)], self.identities[str(path)] = digest, identity
        return data

    def json(self, *, path, expected=None):
        value = strict_json(data=self.read(path=path, expected=expected))
        if not isinstance(value, dict):
            raise ValueError("fixture JSON must be an object")
        return value

    def array(self, *, path, shape, dtype, expected):
        if not valid_hash(value=expected):
            raise ValueError("array fixture hash required")
        value = np.load(io.BytesIO(self.read(path=path, maximum=1024**2, expected=expected)), allow_pickle=False)
        if (not isinstance(value, np.ndarray) or value.shape != shape or value.dtype != np.dtype(dtype)
                or not np.isfinite(value).all()):
            raise ValueError(f"fixture array contract mismatch: {Path(path).name}")
        return value

    def verify(self):
        for name, digest in tuple(self.files.items()):
            self.read(path=Path(name), maximum=128 * 1024**2, expected=digest)


def native_provenance(*, summary):
    if (summary.get("passed") is not True or summary.get("runtime_sha256") != LIBRARY_SHA256
            or summary.get("model_sha256") != MODEL_SHA256
            or not isinstance(summary.get("loaded_bytenn"), dict)
            or summary["loaded_bytenn"].get("sha256") != BYTENN_SHA256):
        raise ValueError("recorded geometry provenance mismatch")


def selected_reference(*, summary, size):
    if type(size) is not int or size not in (120, 160):
        raise ValueError("Stage1 profile must be 120 or 160")
    records = summary.get("cases" if size == 120 else "seeds")
    if not isinstance(records, list) or not 1 <= len(records) <= 64:
        raise ValueError("bounded reference records required")
    selected = [(index, record) for index, record in enumerate(records)
                if isinstance(record, dict) and record.get("expansion") == 1.5
                and record.get("optimized") is False
                and (size == 160 or (type(record.get("step")) is int and record["step"] == 1))]
    if len(selected) != 1:
        raise ValueError("one ordinary recorded geometry path required")
    index, record = selected[0]
    if (record.get("passed") is not True or type(record.get("threshold")) is not float
            or record["threshold"] != 0.0 or type(record.get("confidence")) is not float
            or not math.isfinite(record["confidence"])):
        raise ValueError("passed threshold=0 reference required")
    return index, record


def recorded_bundle(*, locked, root, reference, decode_reference, size):
    exported = locked.json(path=root / "summary.json")
    networks = object_field(value=exported, name="networks")
    if (exported.get("passed") is not True or exported.get("native_oracle_sha256") != espresso_oracle.RUNTIME_SHA256
            or exported.get("float_policies") != {name: list(value) for name, value in FLOAT_LIMITS.items()}
            or set(networks) != {"120", "160"}):
        raise ValueError("passed complete Stage1 export required")
    network = object_field(value=networks, name=str(size))
    recorded = object_field(value=object_field(value=network, name="cases"), name="recorded-face")
    if network.get("terminal_names") != list(HEADS) or recorded.get("alignment_gate") is not True:
        raise ValueError("verified five-head recorded case required")
    geometry = locked.json(path=reference / "summary.json")
    native_provenance(summary=geometry)
    index, record = selected_reference(summary=geometry, size=size)
    directory = reference / f"{'case' if size == 120 else 'seed'}-{index:03d}"
    specs = {"network-input": ((1, size, size, 3), np.int16 if size == 120 else np.int8),
             "prepared-bgr": ((size, size, 3), np.uint8), "raw": ((106, 2), np.float32),
             "stage1": ((106, 2), np.float32), "inverse": ((2, 3), np.float32),
             "original-points": ((106, 2), np.float32)}
    arrays = {}
    for name, (shape, dtype) in specs.items():
        field = "recorded_input" if name in ("network-input", "prepared-bgr", "raw") else "point_reference"
        expected = object_field(value=network, name=field).get(name)
        if not valid_hash(value=expected) or record.get(name + "_sha256") != expected:
            raise ValueError(f"export-to-geometry linkage mismatch: {name}")
        arrays[name] = locked.array(path=directory / f"{name}.npy", shape=shape, dtype=dtype, expected=expected)
    if not np.array_equal(arrays["network-input"], (arrays["prepared-bgr"].astype(np.int16) - 128).astype(specs["network-input"][1])[None]):
        raise ValueError("recorded BGR signed preprocessing mismatch")
    if abs(float(np.linalg.det(arrays["inverse"][:, :2]))) < 1e-12 or np.max(np.abs(arrays["inverse"])) > 32768:
        raise ValueError("singular or unbounded recorded inverse")
    tables = object_field(value=exported, name="decode_tables")
    table_files = object_field(value=tables, name="files")
    if any(not valid_hash(value=value) for value in (tables.get("summary_sha256"), table_files.get("mean"), table_files.get("order"))):
        raise ValueError("locked decode summary/mean/order hashes required")
    decoded = locked.json(path=decode_reference / "summary.json", expected=tables["summary_sha256"])
    native_provenance(summary=decoded)
    mean_hash = table_files["mean"]
    if object_field(value=decoded, name="means").get("base") != mean_hash or decoded.get("order_is_identity") is not True:
        raise ValueError("decode table linkage mismatch")
    arrays["mean"] = locked.array(path=decode_reference / "original-base.npy", shape=(106, 2), dtype=np.float32, expected=mean_hash)
    arrays["order"] = locked.array(path=decode_reference / "original-order.npy", shape=(106,), dtype=np.int32,
                                  expected=table_files["order"])
    if not ((arrays["mean"] > 0) & (arrays["mean"] < 256)).all() or not np.array_equal(arrays["order"], np.arange(106)):
        raise ValueError("unsupported recorded mean/order")
    artifact = f"align-{size}/artifacts/model.onnx"
    model_hash = object_field(value=exported, name="artifacts").get(artifact)
    if not valid_hash(value=model_hash):
        raise ValueError("locked ONNX artifact hash required")
    locked.read(path=root / artifact, maximum=128 * 1024**2, expected=model_hash)
    return arrays, geometry, record


def decode_stage1(*, raw, mean, order, inverse, size):
    if (type(size) is not int or size not in (120, 160) or raw.shape != (106, 2) or raw.dtype != np.float32
            or mean.shape != (106, 2) or mean.dtype != np.float32 or not np.isfinite(mean).all()
            or (mean < 0).any() or (mean > 256).any()
            or inverse.shape != (2, 3) or inverse.dtype != np.float32 or not np.isfinite(inverse).all()
            or abs(float(np.linalg.det(inverse[:, :2]))) < 1e-12 or np.max(np.abs(inverse)) > 32768):
        raise ValueError("invalid Stage1 decode profile/tables/inverse")
    decoded = reorder_landmarks(raw_pairs=raw, destinations=order)
    stage = (decoded.astype(np.float64) + mean.astype(np.float64) / 256 * size).astype(np.float32) if size == 120 else decoded
    mapped = map_points(points=stage, inverse=inverse).astype(np.float32)
    if not np.isfinite(mapped).all() or np.max(np.abs(mapped)) > 32768:
        raise ValueError("unbounded original-frame points")
    return stage, mapped


def normalized_points(*, points, width, height):
    if (any(type(side) is not int or not 1 <= side <= 4096 for side in (width, height))
            or points.shape != (106, 2) or points.dtype != np.float32 or not np.isfinite(points).all()):
        raise ValueError("bounded frame and 106 float32 pixel points required")
    result = points.astype(np.float64) / [width, height]
    result[:, 1] = 1 - result[:, 1]
    if (result < 0).any() or (result > 1).any():
        raise ValueError("mapped points leave normalized frame; no clipping permitted")
    return result.astype(np.float32)


def point_difference(*, actual, expected, tolerance):
    if (actual.shape != (106, 2) or expected.shape != (106, 2)
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()
            or type(tolerance) not in (int, float) or not math.isfinite(tolerance) or tolerance < 0):
        raise ValueError("matching 106 finite point pairs required")
    delta = actual.astype(np.float64) - expected.astype(np.float64)
    absolute, distance = np.abs(delta), np.linalg.norm(delta, axis=1)
    return {"exact": bool((delta == 0).all()), "max_abs": float(absolute.max()),
            "mean_l2": float(distance.mean()), "max_l2": float(distance.max()),
            "worst_point_index": int(distance.argmax()), "tolerance": tolerance,
            "within": bool((absolute <= tolerance).all()), "signed_delta": delta.tolist()}


def capture_reference(*, locked, capture, geometry, image, metadata=None, records=None):
    if capture.is_dir():
        metadata = capture / "control/report.json" if metadata is None else metadata
        records = capture / "control/clone-audit/records.jsonl" if records is None else records
        capture = capture / "native-replay.json"
    if metadata is None:
        raise ValueError("native replay JSON requires --capture-metadata")
    summary = locked.json(path=metadata)
    sources = summary.get("source_sha256")
    if (summary.get("passed") is not True or summary.get("mode") != "owned-conversion"
            or summary.get("owned_result_rendered") is not True or summary.get("native_analysis_bypassed") is not False
            or not isinstance(sources, dict) or not sources or any(not valid_hash(value=value) for value in sources.values())):
        raise ValueError("passed owned-conversion metadata/source hashes required")
    for key, expected in (("runtime_sha256", CORE_SHA256), ("runtime_uuid", UUID),
                          ("graphics_sha256", GRAPHICS_SHA256), ("graphics_uuid", GRAPHICS_UUID)):
        if key in summary and summary[key] != expected:
            raise ValueError("final consumer runtime provenance mismatch")
    image_hash = hashlib.sha256(locked.read(path=image, maximum=128 * 1024**2)).hexdigest()
    if image_hash != geometry.get("portrait_sha256") or image_hash != summary.get("image_sha256"):
        raise ValueError("geometry and consumer must reference identical original image bytes")
    width, height = summary.get("width"), summary.get("height")
    if any(type(side) is not int or not 1 <= side <= 4096 for side in (width, height)):
        raise ValueError("bounded captured frame dimensions required")
    rgba_hash = summary.get("input_rgba_sha256")
    if not valid_hash(value=rgba_hash):
        raise ValueError("captured input RGBA hash required")
    rgba = locked.read(path=metadata.parent / "input.rgba", maximum=128 * 1024**2, expected=rgba_hash)
    if len(rgba) != width * height * 4:
        raise ValueError("captured input RGBA dimensions mismatch")
    replay = locked.json(path=capture)
    validate_replay(value=replay, width=width, height=height, image_hash=image_hash)
    frames = replay["frames"]
    if type(summary.get("owned_face_conversions")) is not int or summary["owned_face_conversions"] != len(frames):
        raise ValueError("metadata conversion count differs from native replay")
    if records is not None:
        lines = locked.read(path=records, maximum=4 * 1024**2).splitlines()
        if not 1 <= len(lines) <= 512:
            raise ValueError("bounded consumer event trace required")
        events = [strict_json(data=line) for line in lines]
        if any(not isinstance(event, dict) for event in events):
            raise ValueError("consumer events must be objects")
        conversions = [event for event in events if event.get("event") == "owned_face_conversion"]
        before = [{"timestamp_us": event.get("timestamp_us"), "faces": event.get("faces_before")} for event in conversions]
        if (before != frames or any(event.get("external_points") is not False
                or type(event.get("eye_shift")) not in (int, float) or event.get("eye_shift") != 0
                or any(event.get(key) is not True for key in ("raw_clone_verified", "source_points_unchanged", "owned_points_isolated"))
                or event.get("native_analysis_bypassed") is not False for event in conversions)):
            raise ValueError("replay is not the unmodified full native conversion capture")
    if any(len(frame["faces"]) != 1 for frame in frames) or len({frame["faces"][0]["id"] for frame in frames}) != 1:
        raise ValueError("one recorded crop cannot be assigned to multiple/changing face IDs or no-face updates")
    return replay, {"event": "owned_face_conversion", "source_field": "faces_before",
                    "stream_crosschecked": records is not None, "recording_source_sha256": sources,
                    "explicit_runtime_identity_in_metadata": all(key in summary for key in (
                        "runtime_sha256", "runtime_uuid", "graphics_sha256", "graphics_uuid"))}


def produce_frames(*, capture, points):
    normalized = normalized_points(points=points, width=capture["width"], height=capture["height"])
    frames, diagnostics = [], []
    for index, frame in enumerate(capture["frames"]):
        face = frame["faces"][0]
        expected = np.asarray(face["points"], np.float64)
        pixel_reference = expected * [capture["width"], capture["height"]]
        pixel_reference[:, 1] = capture["height"] - pixel_reference[:, 1]
        pixel_actual = normalized.astype(np.float64) * [capture["width"], capture["height"]]
        pixel_actual[:, 1] = capture["height"] - pixel_actual[:, 1]
        diagnostics.append({"conversion_index": index, "timestamp_us": frame["timestamp_us"], "face_id": face["id"],
                            "normalized": point_difference(actual=normalized, expected=expected, tolerance=0.0),
                            "pixels": point_difference(actual=pixel_actual, expected=pixel_reference, tolerance=0.002)})
        frames.append({"timestamp_us": frame["timestamp_us"], "faces": [{"id": face["id"], "points": normalized.tolist()}]})
    replay = {key: capture[key] for key in ("version", "coordinate_space", "width", "height", "image_sha256")}
    replay["frames"] = frames
    return replay, diagnostics


def infer(*, model, inputs, size):
    import onnxruntime
    from espresso_onnx_runtime import session

    if onnxruntime.__version__ != "1.22.1":
        raise ValueError("locked ORT 1.22.1 required; newer runtime teardown is unverified")
    if (type(size) is not int or size not in (120, 160) or inputs.shape != (1, size, size, 3)
            or inputs.dtype != np.dtype(np.int16 if size == 120 else np.int8)
            or inputs.min() < -128 or inputs.max() > 127):
        raise ValueError("recorded signed NHWC input required")
    runner = session(path=model)
    head_shapes = {**HEADS, "prob": 3 if size == 120 else 5}
    source = runner.get_inputs()
    outputs = runner.get_outputs()
    if (len(source) != 1 or source[0].name != "data" or source[0].shape != [1, size, size, 3]
            or source[0].type != "tensor(int64)" or [item.name for item in outputs] != list(HEADS)
            or any(item.shape != [1, 1, 1, head_shapes[item.name]] or item.type != "tensor(float)" for item in outputs)):
        raise ValueError("ONNX input/output metadata mismatch")
    values = runner.run(None, {"data": inputs.astype(np.int64)})
    if len(values) != len(HEADS):
        raise ValueError("incomplete ONNX heads")
    for name, value in zip(HEADS, values, strict=True):
        if value.shape != (1, 1, 1, head_shapes[name]) or value.dtype != np.float32 or not np.isfinite(value).all():
            raise ValueError("ONNX output values mismatch")
    return values[0].reshape(106, 2), {"onnxruntime": onnxruntime.__version__, "numpy": np.__version__,
                                     "providers": runner.get_providers(), "head_names": list(HEADS), "head_channels": head_shapes}


def run(*, root, reference, decode_reference, capture, image, size, output, capture_metadata=None, capture_records=None):
    if type(size) is not int or size not in (120, 160):
        raise ValueError("Stage1 profile must be 120 or 160")
    if torch_imported():
        raise ValueError("replay producer must not import Torch")
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite replay evidence")
    root, reference, decode_reference, capture = [espresso_oracle.private_path(path=path)
                                                for path in (root, reference, decode_reference, capture)]
    capture_metadata = espresso_oracle.private_path(path=capture_metadata) if capture_metadata is not None else None
    capture_records = espresso_oracle.private_path(path=capture_records) if capture_records is not None else None
    locked = LockedFiles()
    for name in (Path(__file__).name, "face_geometry.py", "espresso_oracle.py", "espresso_onnx_runtime.py",
                 "face_alignment_heads_parity.py", "face_render_consumer_probe.py", "face_geometry_native.py",
                 "face_alignment_warp_native.py", "face_render_injection_inventory.py"):
        locked.read(path=Path(__file__).with_name(name), maximum=1024**2)
    arrays, geometry, record = recorded_bundle(locked=locked, root=root, reference=reference,
                                              decode_reference=decode_reference, size=size)
    captured, capture_evidence = capture_reference(locked=locked, capture=capture, geometry=geometry, image=image,
                                                 metadata=capture_metadata, records=capture_records)
    raw, versions = infer(model=root / f"align-{size}/artifacts/model.onnx", inputs=arrays["network-input"], size=size)
    stage, points = decode_stage1(raw=raw, mean=arrays["mean"], order=arrays["order"], inverse=arrays["inverse"], size=size)
    checks = {"raw": point_difference(actual=raw, expected=arrays["raw"], tolerance=0.0001),
              "stage1": point_difference(actual=stage, expected=arrays["stage1"], tolerance=0.0001),
              "backmap": point_difference(actual=points, expected=arrays["original-points"], tolerance=0.002)}
    replay, diagnostics = produce_frames(capture=captured, points=points)
    payload = validate_replay(value=replay, width=replay["width"], height=replay["height"], image_hash=replay["image_sha256"])
    locked.verify()
    if torch_imported():
        raise ValueError("replay producer imported Torch during inference")
    passed = all(check["within"] for check in checks.values())
    result = {"passed": passed, "passed_scope": "recorded Stage1 numerical gates and replay protocol only",
              "final_consumer_parity": all(item["pixels"]["within"] for item in diagnostics),
              "end_to_end_independence": False, "native_analysis_bypassed": False, "native_inference_called": False,
              "native_geometry_used": True, "fixed_points_repeated_across_captured_conversions": True,
              "torch_imported": False, "torch_installed": importlib.util.find_spec("torch") is not None,
              "size": size, "coordinate_space": COORDINATE_SPACE, "normalization": NORMALIZATION,
              "versions": versions, "stage1_checks": checks, "consumer_comparisons": diagnostics,
              "capture_evidence": capture_evidence,
              "source_reference_scope": geometry.get("scope"), "reference_controls": {key: record[key] for key in ("expansion", "optimized", "threshold", "confidence")},
              "source_sha256": dict(locked.files), "unresolved": UNRESOLVED,
              "replay_json": str(output / "replay.json") if passed else None,
              "replay_binary_sha256": hashlib.sha256(payload).hexdigest() if passed else None}
    output.mkdir(parents=True)
    if passed:
        (output / "replay.json").write_text(json.dumps(replay, separators=(",", ":"), allow_nan=False) + "\n")
        result["replay_json_sha256"] = espresso_oracle.sha256(path=output / "replay.json")
    (output / "report.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "reference", "decode-reference", "capture", "image", "out"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--size", type=int, choices=(120, 160), required=True)
    parser.add_argument("--capture-metadata", type=Path)
    parser.add_argument("--capture-records", type=Path)
    args = parser.parse_args()
    result = run(root=args.root, reference=args.reference, decode_reference=args.decode_reference,
                 capture=args.capture, image=args.image, size=args.size, output=args.out,
                 capture_metadata=args.capture_metadata, capture_records=args.capture_records)
    print(json.dumps({key: result[key] for key in ("passed", "passed_scope", "final_consumer_parity", "replay_json")}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
