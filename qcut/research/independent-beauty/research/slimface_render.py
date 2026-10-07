"""Inverse-map RGBA sampler for the owned slim-face geometry."""
import numpy as np

from slimface_geometry import SlimFaceField


def validate_rgba(*, rgba):
    if not isinstance(rgba, np.ndarray) or rgba.dtype != np.uint8 or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("expected uint8 HxWx4 RGBA")
    height, width = rgba.shape[:2]
    if min(height, width) < 1 or max(height, width) > 4096 or rgba.nbytes > 16 * 1024 * 1024:
        raise ValueError("image exceeds the analysis-frame budget")


def sample_rgba(*, rgba, points):
    height, width = rgba.shape[:2]
    x = np.clip(points[:, 0], 0, width - 1)
    y = np.clip(points[:, 1], 0, height - 1)
    left, top = np.floor(x).astype(np.intp), np.floor(y).astype(np.intp)
    right, bottom = np.minimum(left + 1, width - 1), np.minimum(top + 1, height - 1)
    fx, fy = (x - left)[:, None], (y - top)[:, None]
    samples = [rgba[top, left], rgba[top, right], rgba[bottom, left], rgba[bottom, right]]
    weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]
    accumulated = np.zeros((len(points), 4), dtype=np.float64)
    for sample, weight in zip(samples, weights):
        premultiplied = sample.astype(np.float64)
        premultiplied[:, :3] *= premultiplied[:, 3:4] / 255
        accumulated += premultiplied * weight
    alpha = accumulated[:, 3:4]
    accumulated[:, :3] = np.divide(accumulated[:, :3] * 255, alpha,
                                   out=np.zeros_like(accumulated[:, :3]), where=alpha > 0)
    return np.clip(np.rint(accumulated), 0, 255).astype(np.uint8)


def render(*, rgba, field: SlimFaceField):
    validate_rgba(rgba=rgba)
    output = rgba.copy()
    changed_coordinates = 0
    maximum_displacement = 0.0
    maximum_inverse_error = 0.0
    height, width = rgba.shape[:2]
    if field.strength > 0:
        for start in range(0, height, 64):
            y, x = np.mgrid[start:min(start + 64, height), :width]
            destination = np.stack([x, y], axis=-1).astype(np.float64)
            source, active = field.inverse(points=destination)
            if not np.any(active):
                continue
            selected = source[active]
            output[start:start + len(y)][active] = sample_rgba(rgba=rgba, points=selected)
            changed_coordinates += int(np.count_nonzero(active))
            maximum_displacement = max(maximum_displacement, float(np.max(np.linalg.norm(
                selected - destination[active], axis=-1))))
            maximum_inverse_error = max(maximum_inverse_error, float(np.max(np.linalg.norm(
                field.forward(points=selected) - destination[active], axis=-1))))
    changed = np.any(output != rgba, axis=-1)
    return output, {"affected_coordinate_count": changed_coordinates,
                    "changed_pixel_count": int(np.count_nonzero(changed)),
                    "maximum_sampling_displacement_px": maximum_displacement,
                    "maximum_inverse_residual_px": maximum_inverse_error,
                    "minimum_jacobian_determinant_bound": 1 - field.strength,
                    "outside_support_bitwise_identity": True,
                    "sampling": "bilinear-premultiplied-RGBA-clamp-to-image-edge"}
