"""Fresh-photo algorithm image and min-side detector geometry, orientation zero."""
import numpy as np

from algorithm_frame import resize_rgba, validate_frame
from vendor.espresso_preprocess_probe import separable_bilinear_truncating


def algorithm_size(*, size):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 32 <= side <= 4096 for side in size)):
        raise ValueError("bounded original photo dimensions required")
    width, height = size
    scale = min(1, 640 / max(width, height))
    result = (max(1, int(width * scale)), max(1, int(height * scale)))
    if min(result) < 16:
        raise ValueError("algorithm image aspect exceeds supported scope")
    return result


def detector_size(*, size):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 16 <= side <= 640 for side in size)):
        raise ValueError("bounded algorithm image dimensions required")
    short, long = min(size), max(size)
    scaled = int(np.float32(long) * np.float32(320 / short))
    quotient, remainder = divmod(scaled, 32)
    # Native integer extent truncates first; an exact half-block rounds down.
    aligned = (quotient + (remainder > 16)) * 32
    if not 320 <= aligned <= 2048:
        raise ValueError("detector aspect exceeds supported network budget")
    target = (320, aligned) if size[0] < size[1] else (aligned, 320)
    scales = np.array([target[0] / size[0], target[1] / size[1]], np.float32)
    return target, scales


def prepare_detection(*, rgba):
    if not isinstance(rgba, np.ndarray) or rgba.ndim != 3:
        raise ValueError("packed RGBA photo required")
    size = algorithm_size(size=(rgba.shape[1], rgba.shape[0]))
    validate_frame(frame=rgba, size=size)
    algorithm = resize_rgba(frame=rgba, size=size)
    bgr = np.ascontiguousarray(algorithm[:, :, :3][:, :, ::-1])
    target, scales = detector_size(size=size)
    prepared = separable_bilinear_truncating(bgr.astype(np.float64), *target).astype(np.uint8)
    tensor = (prepared.astype(np.int16) - 128).astype(np.int8)[None]
    return {"algorithm": algorithm, "source": bgr, "prepared": prepared, "tensor": tensor,
            "algorithm_size": size, "network_size": target, "scales": scales}
