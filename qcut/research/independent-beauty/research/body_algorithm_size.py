"""Native body package algorithm extents, including the first frame after resize."""
import numpy as np

from detection_geometry import detector_size


def _fit_algorithm_size(*, source, target):
    width, height = source
    target_width, target_height = target
    if target_width * target_height >= width * height:
        return source
    if width > height and target_width < target_height:
        target_width, target_height = target_height, target_width
    aspect = np.float32(np.float32(width) / np.float32(height))
    target_aspect = np.float32(np.float32(target_width) / np.float32(target_height))
    if aspect > target_aspect:
        target_width = int(np.float32(aspect * np.float32(target_height)))
    else:
        target_height = int(np.float32(np.float32(target_width) / aspect))
    return target_width, target_height


def body_algorithm_size(*, size, source_changed=False):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 32 <= side <= 4096 for side in size)
            or type(source_changed) is not bool):
        raise ValueError('bounded body source dimensions and resize state required')
    target = (128, 224) if source_changed else (360, 640)
    # Requirement aggregation and the image producer each apply the FP32 fit.
    requested = _fit_algorithm_size(source=size, target=target)
    result = _fit_algorithm_size(source=size, target=requested)
    # The same algorithm image feeds both networks; admit only their shared budget.
    detector_size(size=result, maximum_edge=1280)
    return result
