"""Owned NanoDet postprocessing with inclusive pixel boxes and explicit profiles.

No weights, runtime, landmark-order table or model-specific configuration is
embedded. Equal-score proposals use stable input order, not libc++'s unstable
sort; comparisons must explicitly report any resulting selection difference.
"""
import numpy as np


def validate_heads(*, heads, image_size, strides):
    if (len(image_size) != 2 or not all(isinstance(v, int) and not isinstance(v, bool)
                                      and 1 <= v <= 4096 for v in image_size)
            or len(strides) != 3 or len(heads) != 6
            or not all(isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 128 for v in strides)):
        raise ValueError("three scales, six HWC heads and bounded image dimensions required")
    width, height = image_size
    bins = None
    for index, stride in enumerate(strides):
        regression, reg_fraction = heads[index]
        scores, cls_fraction = heads[index + 3]
        spatial = ((height + stride - 1) // stride, (width + stride - 1) // stride)
        for value, fraction in ((regression, reg_fraction), (scores, cls_fraction)):
            if (not isinstance(value, np.ndarray) or value.dtype not in (np.dtype("int8"), np.dtype("int16"), np.dtype("float32"))
                    or value.ndim != 3 or value.shape[:2] != spatial
                    or not isinstance(fraction, int) or isinstance(fraction, bool) or not -16 <= fraction <= 24
                    or not np.isfinite(value).all()):
                raise ValueError("invalid head shape, dtype, fraction or finite values")
        channels = regression.shape[2]
        if scores.shape[2] != 1 or channels % 4 or not 1 <= channels // 4 <= 32:
            raise ValueError("one score channel and four distance distributions required")
        if bins is not None and channels != bins:
            raise ValueError("distance bins must agree across scales")
        bins = channels
        if regression.dtype != scores.dtype:
            raise ValueError("regression and score storage must agree")
    if sum(value.size for value, _ in heads) > 8_000_000:
        raise ValueError("detector heads exceed the bounded memory scope")


def dequantize(*, values, fraction):
    result = values.astype(np.float32) * np.float32(2.0 ** -fraction)
    # The reference's unshifted expf cannot safely represent arbitrary float logits.
    if not np.isfinite(result).all() or (np.abs(result) > 80).any():
        raise ValueError("logits exceed the finite reference exponential scope")
    return result


def distribution_distance(*, logits):
    if logits.shape[-1] == 1:
        return logits[..., 0]
    exponentials = np.exp(logits.astype(np.float64)).astype(np.float32)
    total = np.zeros(logits.shape[:-1], dtype=np.float32)
    for index in range(logits.shape[-1]):
        total = total + exponentials[..., index]
    if not np.isfinite(total).all() or (total <= 0).any():
        raise ValueError("distribution normalization is not finite")
    probabilities = exponentials / total[..., None]
    distances = np.zeros_like(total)
    for index in range(logits.shape[-1]):
        distances = distances + np.float32(index) * probabilities[..., index]
    return distances


def proposals(*, heads, image_size, strides, minimum_sizes, confidence):
    validate_heads(heads=heads, image_size=image_size, strides=strides)
    if (len(minimum_sizes) != 3 or not all(isinstance(v, int) and not isinstance(v, bool)
                                        and 1 <= v <= 4096 for v in minimum_sizes)
            or not np.isfinite(confidence) or not 0 <= confidence <= 1):
        raise ValueError("invalid confidence or minimum proposal size")
    width, height = image_size
    result = []
    for index, (stride, minimum) in enumerate(zip(strides, minimum_sizes)):
        regression, fraction = heads[index]
        scores, score_fraction = heads[index + 3]
        logits = dequantize(values=regression, fraction=fraction)
        distances = np.maximum(distribution_distance(logits=logits.reshape(*logits.shape[:2], 4, -1)), 0)
        score_logits = dequantize(values=scores, fraction=score_fraction)[..., 0]
        probabilities = np.float32(1) / (np.float32(1) + np.exp(-score_logits.astype(np.float64)).astype(np.float32))
        row, column = np.nonzero(probabilities >= np.float32(confidence))
        centers = np.stack((column * stride + stride // 2, row * stride + stride // 2), axis=-1).astype(np.float32)
        offsets = distances[row, column] * np.float32(stride)
        endpoints = np.concatenate((centers - offsets[:, :2], centers + offsets[:, 2:]), axis=-1)
        endpoints = np.clip(np.trunc(endpoints), 0, [width - 1, height - 1, width - 1, height - 1]).astype(np.float32)
        valid = np.all(endpoints[:, 2:] - endpoints[:, :2] + np.float32(1) >= minimum, axis=1)
        result.append(np.column_stack((endpoints[valid], probabilities[row[valid], column[valid]])))
    return np.concatenate(result).astype(np.float32)


def validate_nms(*, boxes, before, after, threshold):
    values = np.asarray(boxes, dtype=np.float32)
    if (values.ndim != 2 or values.shape[1] != 5 or len(values) > 20000
            or not np.isfinite(values).all() or (values[:, 2:4] < values[:, :2]).any()
            or (np.abs(values[:, :4]) > 32768).any()
            or (values[:, 4] < 0).any() or (values[:, 4] > 1).any()
            or not all(isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 20000 for v in (before, after))
            or not np.isfinite(threshold) or not 0 <= threshold <= 1):
        raise ValueError("invalid NMS boxes, limits or threshold")
    return values


def suppress_ordered(*, boxes, before, after, threshold):
    values = validate_nms(boxes=boxes, before=before, after=after, threshold=threshold)[:before]
    suppressed = np.zeros(len(values), dtype=bool)
    selected = []
    one = np.float32(1)
    for index, box in enumerate(values):
        if suppressed[index]:
            continue
        selected.append(index)
        if len(selected) == after:
            break
        others = values[index + 1:]
        intersection_sides = np.maximum(np.minimum(box[2:4], others[:, 2:4])
                                        - np.maximum(box[:2], others[:, :2]) + one, 0)
        intersection = intersection_sides[:, 0] * intersection_sides[:, 1]
        area = (box[2] - box[0] + one) * (box[3] - box[1] + one)
        other_sides = others[:, 2:4] - others[:, :2] + one
        other_area = other_sides[:, 0] * other_sides[:, 1]
        iou = intersection / (area + other_area - intersection)
        suppressed[index + 1:] |= iou > np.float32(threshold)
    return values[selected].copy()


def decode(*, heads, image_size, strides, minimum_sizes, confidence, before, after, iou):
    values = proposals(heads=heads, image_size=image_size, strides=strides,
                       minimum_sizes=minimum_sizes, confidence=confidence)
    order = np.argsort(-values[:, 4], kind="stable")
    return suppress_ordered(boxes=values[order], before=before, after=after, threshold=iou)


def frame_rectangles(*, boxes, scales):
    values = np.asarray(boxes, dtype=np.float32)
    factors = np.asarray(scales, dtype=np.float32)
    if (values.ndim != 2 or values.shape[1] != 5 or not np.isfinite(values).all()
            or factors.shape != (2,) or not np.isfinite(factors).all() or (factors <= 0).any()
            or (values[:, 2:4] < values[:, :2]).any() or (np.abs(values[:, :4]) > 32768).any()
            or (factors < 1e-6).any()):
        raise ValueError("finite boxes and positive native resize scales required")
    inverse = (np.float64(1) / factors.astype(np.float64)).astype(np.float32)
    endpoints = np.trunc(values[:, :4] * np.tile(inverse, 2)).astype(np.float32)
    if (np.abs(endpoints) > 32768).any():
        raise ValueError("mapped rectangles exceed the bounded pixel scope")
    return np.column_stack((endpoints[:, :2], endpoints[:, 2:] - endpoints[:, :2] + np.float32(1)))
