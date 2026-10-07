"""Owned, bounded 2D slim-face field; this is not the native FaceReshape mesh."""
from dataclasses import dataclass

import numpy as np


MAX_CONTRACTION = 0.22


def validate_intensity(*, intensity):
    if isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, (int, float, np.integer, np.floating)):
        raise ValueError("slim-face intensity must be a number in 0..100")
    if not np.isfinite(intensity) or not 0 <= intensity <= 100:
        raise ValueError("slim-face intensity must be a number in 0..100")
    return float(intensity)


@dataclass(frozen=True)
class SlimFaceField:
    center: np.ndarray
    axis: np.ndarray
    perpendicular: np.ndarray
    radii: np.ndarray
    strength: float

    def coordinates(self, *, points):
        offset = np.asarray(points, dtype=np.float64) - self.center
        return offset @ self.axis, offset @ self.perpendicular

    def forward(self, *, points):
        points = np.asarray(points, dtype=np.float64)
        lateral, vertical = self.coordinates(points=points)
        weight = np.maximum(0, 1 - (lateral / self.radii[0]) ** 2
                            - (vertical / self.radii[1]) ** 2) ** 3
        return points - (self.strength * lateral * weight)[..., None] * self.axis

    def inverse(self, *, points):
        points = np.asarray(points, dtype=np.float64)
        target, vertical = self.coordinates(points=points)
        active = (target / self.radii[0]) ** 2 + (vertical / self.radii[1]) ** 2 < 1
        if self.strength == 0 or not np.any(active):
            return points.copy(), np.zeros(target.shape, dtype=bool)
        lateral, depth = target[active], vertical[active]
        low = np.full(lateral.shape, -self.radii[0])
        high = -low
        # The determinant is at least 1-strength: each destination has one source.
        for _ in range(24):
            middle = (low + high) * 0.5
            weight = np.maximum(0, 1 - (middle / self.radii[0]) ** 2
                                - (depth / self.radii[1]) ** 2) ** 3
            mapped = middle * (1 - self.strength * weight)
            low = np.where(mapped < lateral, middle, low)
            high = np.where(mapped < lateral, high, middle)
        displacement = np.zeros(target.shape)
        displacement[active] = (low + high) * 0.5 - lateral
        return points + displacement[..., None] * self.axis, active

    def describe(self):
        return {"center": self.center.tolist(), "axis": self.axis.tolist(),
                "perpendicular": self.perpendicular.tolist(), "radii": self.radii.tolist(),
                "strength": self.strength, "minimum_jacobian_determinant_bound": 1 - self.strength,
                "space": "analysis-image-pixel-centers-top-left-origin",
                "algorithm": "owned-elliptical-C2-lateral-contraction-v1",
                "native_geometry_parity_verified": False}


def build_field(*, points, intensity):
    intensity = validate_intensity(intensity=intensity)
    points = np.asarray(points, dtype=np.float64)
    if points.shape != (106, 2) or not np.all(np.isfinite(points)) or np.max(np.abs(points)) > 1e6:
        raise ValueError("expected 106 finite image landmarks")
    midpoint = (points[0] + points[32]) * 0.5
    across = points[32] - points[0]
    width = np.linalg.norm(across)
    if width < 8:
        raise ValueError("face contour is degenerate or too small")
    axis = across / width
    perpendicular = np.array([-axis[1], axis[0]])
    depth = float((points[16] - midpoint) @ perpendicular)
    if depth < 0:
        perpendicular = -perpendicular
        depth = -depth
    if not 0.15 * width < depth < 2.5 * width:
        raise ValueError("face contour has unsupported geometry")
    center = midpoint + perpendicular * depth * 0.46
    values = [center, axis, perpendicular, np.array([width * 1.1, depth * 0.98])]
    for value in values:
        value.setflags(write=False)
    return SlimFaceField(*values, strength=MAX_CONTRACTION * intensity / 100)
