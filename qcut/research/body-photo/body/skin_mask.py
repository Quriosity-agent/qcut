"""Face-seeded, conservative body skin candidates; not semantic skin segmentation."""
import hashlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


POLICY = "face-seeded-coherent-lab-body-support-v2"
LIMITATION = "Skin-coloured fabric, tattoos and coloured lighting remain ambiguous; this is not a learned skin segmentation model."


def rgb_to_lab(*, rgb):
    values = np.asarray(rgb, np.float32) / 255
    linear = np.where(values <= .04045, values / 12.92, ((values + .055) / 1.055) ** 2.4)
    matrix = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750],
                       [.0193339, .1191920, .9503041]], np.float32)
    xyz = linear @ matrix.T / np.array([.95047, 1, 1.08883], np.float32)
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack((116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])), axis=-1)


def lab_to_rgb(*, lab):
    values = np.asarray(lab, np.float32)
    fy = (values[..., 0] + 16) / 116
    f = np.stack((fy + values[..., 1] / 500, fy, fy - values[..., 2] / 200), axis=-1)
    xyz = np.where(f > 6 / 29, f ** 3, 3 * (6 / 29) ** 2 * (f - 4 / 29))
    xyz *= np.array([.95047, 1, 1.08883], np.float32)
    matrix = np.array([[3.2404542, -1.5371385, -.4985314], [-.969266, 1.8760108, .041556],
                       [.0556434, -.2040259, 1.0572252]], np.float32)
    linear = np.maximum(xyz @ matrix.T, 0)
    srgb = np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055)
    return np.clip(srgb * 255, 0, 255)


def validate_rgba(*, rgba):
    if (not isinstance(rgba, np.ndarray) or rgba.dtype != np.uint8 or rgba.ndim != 3
            or rgba.shape[2] != 4 or min(rgba.shape[:2]) < 16
            or max(rgba.shape[:2]) > 4096 or rgba.shape[0] * rgba.shape[1] > 8_294_400):
        raise ValueError("bounded uint8 HxWx4 photo required")


def normalize_person_mask(*, person_mask, shape):
    value = np.asarray(person_mask)
    if value.shape != shape:
        raise ValueError("person mask must match the original photo dimensions")
    if value.dtype == np.bool_:
        return value.astype(np.float32)
    if value.dtype == np.uint8:
        return value.astype(np.float32) / 255
    if value.dtype.kind != "f" or not np.isfinite(value).all() or np.any(value < 0) or np.any(value > 1):
        raise ValueError("person mask must be uint8 or finite normalized floating point")
    return value.astype(np.float32)


def _hull(*, points):
    ordered = sorted(set(map(tuple, points.tolist())))
    if len(ordered) < 3:
        return []

    def cross(*, first, second, third):
        return ((second[0] - first[0]) * (third[1] - first[1])
                - (second[1] - first[1]) * (third[0] - first[0]))

    halves = []
    for sequence in (ordered, reversed(ordered)):
        half = []
        for point in sequence:
            while len(half) >= 2 and cross(first=half[-2], second=half[-1], third=point) <= 0:
                half.pop()
            half.append(point)
        halves.extend(half[:-1])
    return halves


def _face_reference(*, faces, lab, person):
    if not isinstance(faces, dict):
        return None, "missing-face-seeds"
    try:
        box = np.asarray(faces.get("box"), np.float64)
        points = np.asarray(faces.get("landmarks"), np.float64)
        score = faces.get("score")
        if (isinstance(score, (bool, np.bool_)) or not np.isfinite(float(score)) or float(score) < .5
                or box.shape != (4,) or points.shape != (106, 2)
                or not np.isfinite(box).all() or not np.isfinite(points).all()):
            return None, "unreliable-face-seeds"
    except (ValueError, TypeError, OverflowError):
        return None, "invalid-face-seeds"
    height, width = person.shape
    x, y, w, h = box
    if (min(w, h) < 16 or x < 0 or y < 0 or x + w > width or y + h > height
            or np.any(points < 0) or np.any(points >= [width, height])):
        return None, "face-outside-photo"
    canvas = Image.new("L", (width, height))
    hull = _hull(points=points)
    if len(hull) < 3:
        return None, "collapsed-face-landmarks"
    ImageDraw.Draw(canvas).polygon(hull, fill=255)
    inside = np.asarray(canvas) > 0
    if np.count_nonzero(inside) < .2 * w * h:
        return None, "collapsed-face-landmarks"
    samples, medians = [], []
    for cx, cy in ((.29, .61), (.71, .61), (.50, .25)):
        left, right = int(x + (cx - .075) * w), int(x + (cx + .075) * w) + 1
        top, bottom = int(y + (cy - .055) * h), int(y + (cy + .055) * h) + 1
        valid = inside[top:bottom, left:right] & (person[top:bottom, left:right] >= .9)
        patch = lab[top:bottom, left:right][valid]
        if len(patch) >= 12:
            samples.append(patch)
            medians.append(np.median(patch, axis=0))
    if len(medians) < 2:
        return None, "insufficient-face-seed-pixels"
    medians = np.asarray(medians)
    centre = np.median(medians, axis=0)
    consistent = np.linalg.norm(medians[:, 1:] - centre[1:], axis=1) <= 8
    if np.count_nonzero(consistent) < 2:
        return None, "inconsistent-face-seeds"
    chosen = np.concatenate([patch for patch, keep in zip(samples, consistent) if keep])
    reference = np.median(chosen, axis=0)
    deviation = np.median(np.linalg.norm(chosen[:, 1:] - reference[1:], axis=1))
    if reference[0] < 8 or reference[0] > 95 or np.linalg.norm(reference[1:]) < 3.5 or deviation > 8:
        return None, "low-confidence-skin-colour"
    return {"lab": reference, "deviation": float(deviation), "box": box,
            "seedPixels": len(chosen), "consistentPatches": int(consistent.sum())}, None


def _body_support(*, pose, algorithm_size, shape):
    height, width = shape
    try:
        points, size = np.asarray(pose, np.float64), np.asarray(algorithm_size, np.float64)
        if (points.shape != (18, 4) or size.shape != (2,) or not np.isfinite(points).all()
                or not np.isfinite(size).all() or np.any(size < 2)):
            return None, "invalid-body-pose"
        error = abs(size[0] - size[1] * width / height)
        if error > max(1.5, 1.5 * width / height):
            return None, "pose-aspect-mismatch"
    except (TypeError, ValueError, OverflowError):
        return None, "invalid-body-pose"
    visible = (points[:, 3] == 1) & (points[:, 2] >= .2)
    visible &= np.all(points[:, :2] >= 0, axis=1) & np.all(points[:, :2] < size, axis=1)
    xy = points[:, :2] * [width, height] / size
    canvas = Image.new("L", (width, height))
    draw = ImageDraw.Draw(canvas)
    segments = 0
    for start, end, fraction in ((2, 3, .30), (3, 4, .28), (5, 6, .30), (6, 7, .28),
                                 (8, 9, .30), (9, 10, .25), (11, 12, .30), (12, 13, .25)):
        if not visible[start] or not visible[end]:
            continue
        first, last = xy[start], xy[end]
        length = float(np.linalg.norm(last - first))
        if not max(8, min(shape) * .035) <= length <= max(shape) * .6:
            continue
        radius = max(2, min(length * fraction, min(shape) * .12))
        draw.line([tuple(first), tuple(last)], fill=255, width=round(radius * 2))
        for cx, cy in (first, last):
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
        if (start, end) in ((3, 4), (6, 7)):
            hand_end = last + (last - first) * .55
            hand_radius = radius * .72
            draw.line([tuple(last), tuple(hand_end)], fill=255, width=round(hand_radius * 2))
            for cx, cy in (last, hand_end):
                draw.ellipse((cx - hand_radius, cy - hand_radius,
                              cx + hand_radius, cy + hand_radius), fill=255)
        segments += 1
    if np.all(visible[[2, 5, 8, 11]]):
        torso = xy[[2, 5, 11, 8]]
        centre = torso.mean(axis=0)
        torso = centre + (torso - centre) * [1.1, 1.06]
        draw.polygon([tuple(point) for point in torso], fill=255)
    support = np.asarray(canvas).copy()
    if segments < 1 or np.count_nonzero(support) < 64:
        return None, "insufficient-visible-body"
    return support, None


def build_skin_mask(*, rgba, person_mask, pose, algorithm_size, faces=None):
    validate_rgba(rgba=rgba)
    person = normalize_person_mask(person_mask=person_mask, shape=rgba.shape[:2])
    diagnostics = {"policy": POLICY, "limitation": LIMITATION, "available": False}

    def unavailable(*, reason):
        return np.zeros(person.shape, np.float32), {**diagnostics, "reasonCode": reason}

    lab = rgb_to_lab(rgb=rgba[..., :3])
    reference, reason = _face_reference(faces=faces, lab=lab, person=person)
    if reference is None:
        return unavailable(reason=reason)
    support, reason = _body_support(pose=pose, algorithm_size=algorithm_size, shape=person.shape)
    if support is None:
        return unavailable(reason=reason)
    chroma = lab[..., 1:]
    seed_chroma = reference["lab"][1:]
    magnitude = np.linalg.norm(chroma, axis=-1)
    seed_magnitude = float(np.linalg.norm(seed_chroma))
    angle = np.arccos(np.clip((chroma @ seed_chroma) /
                             np.maximum(magnitude * seed_magnitude, 1e-6), -1, 1))
    angle = np.degrees(angle)
    lightness_delta = np.abs(lab[..., 0] - reference["lab"][0])
    spatial = (support > 0) & (person >= .9) & (rgba[..., 3] == 255)
    x, y, w, h = reference["box"]
    head_box = [max(0, int(x - .1 * w)), max(0, int(y - .15 * h)),
                min(rgba.shape[1], int(np.ceil(x + 1.1 * w))),
                min(rgba.shape[0], int(np.ceil(y + 1.06 * h)))]
    spatial[head_box[1]:head_box[3], head_box[0]:head_box[2]] = False
    candidate = (spatial & (angle < 22) & (magnitude > max(4, seed_magnitude * .28))
                 & (magnitude < seed_magnitude * 1.6) & (lightness_delta < 40))
    # Close small shadow/texture gaps, but never cross a strong colour rejection.
    loose = (spatial & (angle < 29) & (magnitude > max(3, seed_magnitude * .2))
             & (magnitude < seed_magnitude * 1.8) & (lightness_delta < 45))
    radius = max(1, min(8, round(min(person.shape) / 200)))
    hard = Image.fromarray(candidate.astype(np.uint8) * 255)
    coherent = hard.filter(ImageFilter.MaxFilter(radius * 2 + 1)).filter(ImageFilter.MinFilter(radius * 2 + 1))
    candidate = (np.asarray(coherent) > 0) & loose
    hard = Image.fromarray(candidate.astype(np.uint8) * 255)
    inset = hard.filter(ImageFilter.MinFilter(radius * 2 + 1))
    feather = np.asarray(inset.filter(ImageFilter.GaussianBlur(max(1, radius))), np.float32) / 255
    anatomical_radius = max(2, min(24, round(min(person.shape) / 65)))
    anatomical = Image.fromarray(support).filter(ImageFilter.GaussianBlur(anatomical_radius))
    anatomical_weight = np.clip((np.asarray(anatomical, np.float32) / 255 - .5) * 2, 0, 1)
    mask = feather * candidate * anatomical_weight
    mask[mask < .025] = 0
    minimum = max(64, round(person.size * .00015))
    if np.count_nonzero(mask) < minimum:
        return unavailable(reason="no-confident-body-skin")
    diagnostics.update(available=True, reasonCode=None, selectedPixels=int(np.count_nonzero(mask)),
                       hardCandidatePixels=int(np.count_nonzero(candidate)),
                       maskSha256=hashlib.sha256(np.ascontiguousarray(mask, dtype="<f4").tobytes()).hexdigest(),
                       supportSha256=hashlib.sha256(candidate.astype(np.uint8).tobytes()).hexdigest(),
                       personMaskSha256=hashlib.sha256(np.ascontiguousarray(person, dtype="<f4").tobytes()).hexdigest(),
                       seedLab=reference["lab"].tolist(), seedPixels=reference["seedPixels"],
                       consistentSeedPatches=reference["consistentPatches"], hueToleranceDegrees=22,
                       headProtectedBoxXYXY=head_box, featherRadius=radius,
                       anatomicalFeatherRadius=anatomical_radius, handExtension=.55,
                       maskCoordinateSpace="original-photo-top-left")
    return mask.astype(np.float32), diagnostics
