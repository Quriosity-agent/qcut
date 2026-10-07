"""Fresh Base106 algorithm pixels to the original-image TotalFace ABI."""
import numpy as np

from alignment_decode import normalized


def total_face_points(*, points, algorithm_size, original_size):
    for size in (algorithm_size, original_size):
        if (not isinstance(size, (tuple, list)) or len(size) != 2
                or any(type(side) is not int or not 1 <= side <= 4096 for side in size)):
            raise ValueError("bounded integer image dimensions required")
    points = np.asarray(points)
    if points.shape != (106, 2) or points.dtype != np.float32 or not np.isfinite(points).all():
        raise ValueError("finite float32 primary106 points required")
    coordinates = normalized(points=points, size=tuple(algorithm_size))
    output = np.empty((106, 2), np.float32)
    width, height = original_size
    output[:, 0] = coordinates[:, 0] * np.float32(width)
    # The consumer promotes inverted normalized Y to double before scaling.
    output[:, 1] = (1.0 - coordinates[:, 1].astype(np.float64)) * height
    return output
