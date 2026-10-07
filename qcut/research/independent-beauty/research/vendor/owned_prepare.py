"""研究代码的函数级原样摘录（QCut a466330e7）。

原文件的 import 链会拉进原生采集探针，所以只摘需要的两个函数，函数体一字未改：
- prepare            ← research/local-model-pytorch/face_preprocess_replay.py:28-61
- resize_candidates  ← research/local-model-pytorch/face_alignment_input_verify.py:29-36
"""
import numpy as np

from espresso_preprocess_probe import separable_bilinear_truncating
from face_geometry import crop_pixels, crop_region


def resize_candidates(*, crop, network_size):
    width, height = network_size
    # Reciprocal evaluation changes floor at exact-looking integer boundaries.
    rows = np.floor(np.arange(height) * (1 / (height / crop.shape[0]))).astype(int)
    columns = np.floor(np.arange(width) * (1 / (width / crop.shape[1]))).astype(int)
    nearest = crop[rows[:, None], columns]
    linear = separable_bilinear_truncating(crop.astype(np.float64), width, height).astype(np.uint8)
    return nearest, linear


def prepare(*, frame, call):
    if (not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or
            frame.shape[2] != 4 or not all(1 <= side <= 4096 for side in frame.shape[:2]) or
            frame.nbytes > 16 * 1024**2 or not isinstance(call, dict)):
        raise ValueError("bounded uint8 algorithm RGBA and observed call required")
    if (type(call.get("format")) is not int or call["format"] != 0 or
            type(call.get("orientation")) is not int or call["orientation"] != 0 or
            not isinstance(call.get("target"), list) or call["target"] != [160, 160] or
            any(type(value) is not int for value in call["target"])):
        raise ValueError("only observed format-0/orientation-0/160 profile is accepted")
    flags = call.get("flags")
    if (not isinstance(flags, list) or len(flags) != 3 or
            any(type(value) is not int or value not in (0, 1) for value in flags) or flags[2] != 0):
        raise ValueError("typed observed flags required; allocator-flag-1 profile unverified")
    rect = call.get("rect")
    if not isinstance(rect, dict) or not isinstance(rect.get("values"), list) or len(rect["values"]) != 4:
        raise ValueError("observed pre-crop Rect required, not an inverse-derived Rect")
    if any(type(value) not in (int, float) or not np.isfinite(value) for value in rect["values"]):
        raise ValueError("finite typed pre-crop Rect required")
    expansion = call.get("expansion")
    if type(expansion) not in (int, float) or not np.isfinite(expansion) or not 0 < expansion <= 4:
        raise ValueError("finite bounded actual expansion required")
    source = np.ascontiguousarray(frame[:, :, :3][:, :, ::-1])
    region = crop_region(rect=rect["values"], frame_size=(frame.shape[1], frame.shape[0]),
                         expansion=expansion, legacy_anchor=bool(flags[1]))
    if region.size * region.size * 3 > 16 * 1024**2:
        raise ValueError("generated crop exceeds blob budget")
    crop = crop_pixels(frame=source, region=region)
    nearest, linear = resize_candidates(crop=crop, network_size=(160, 160))
    use_linear = flags[0] == 1 and crop.shape[0] < 160
    resized = np.ascontiguousarray(linear if use_linear else nearest)
    tensor = (resized.astype(np.int16) - 128).astype(np.int8)[None]
    return dict(source=source, crop=crop, resized=resized, tensor=tensor,
                post_crop_rect=list(region.rect), resize="linear" if use_linear else "nearest")
