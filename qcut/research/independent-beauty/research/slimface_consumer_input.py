"""Validate a live TotalFace capture before independent same-input replay."""
import hashlib

import numpy as np

from slimface_geometry import validate_intensity


def consumer_request(*, record, intensity, size, assets):
    intensity = validate_intensity(intensity=intensity)
    if intensity == 0:
        raise ValueError("positive TotalFace capture required")
    if [record["width"], record["height"]] != list(size):
        raise ValueError("consumer dimensions differ from the uploaded frame")
    points = np.asarray(record["points"], dtype="<f4")
    mesh = np.asarray(record["mesh"], dtype="<f4")
    if points.shape != (212,) or mesh.shape != (1555,) or not np.isfinite(points).all() or not np.isfinite(mesh).all():
        raise ValueError("invalid consumer point or mesh buffer")
    for name, values in (("points", points), ("mesh", mesh)):
        if hashlib.sha256(values.tobytes()).hexdigest() != record[f"{name}_sha256"]:
            raise ValueError(f"consumer {name} hash mismatch")
    if record["input_unchanged"] is not True or record["flags"] != [2, 1, 1]:
        raise ValueError("unexpected consumer mutation or mode")
    expected = np.zeros(22, np.float32)
    expected[[1, 10, 16, 20]] = np.array([.08, -.2, -.01, -.2]) * (intensity / 100)
    degrees = np.asarray(record["degrees"], np.float32)
    if degrees.shape != (22,) or not np.allclose(degrees, expected, rtol=0, atol=1e-7):
        raise ValueError("capture contains other active controls or wrong strength")
    weights = np.asarray(record["weights"], np.float32)
    if weights.shape != (62, 3) or not np.array_equal(weights, assets["weights"]):
        raise ValueError("consumer weights differ from validated local assets")
    yaw, pitch = record["yaw"], record["pitch"]
    if (any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in (yaw, pitch))
            or not np.isfinite([yaw, pitch]).all() or abs(yaw) > 50 or pitch != 0):
        raise ValueError("unsupported live consumer pose")
    return {"size": list(size), "intensity": intensity, "yaw": yaw, "pitch": pitch,
            "points": points.reshape(106, 2).tolist()}
