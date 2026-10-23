"""Small isolated dark-spot softening using reliable surrounding body skin."""
import hashlib

import numpy as np
from PIL import Image, ImageFilter

if __package__:
    from .skin_mask import lab_to_rgb, rgb_to_lab
else:
    from skin_mask import lab_to_rgb, rgb_to_lab


def _components(*, candidates):
    height, width = candidates.shape
    seeds = np.flatnonzero(candidates).tolist()
    remaining = set(seeds)
    for seed in seeds:
        if seed not in remaining:
            continue
        remaining.remove(seed)
        component, pending = [seed], [seed]
        while pending:
            point = pending.pop()
            y, x = divmod(point, width)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not (0 <= y + dy < height and 0 <= x + dx < width):
                        continue
                    neighbor = (y + dy) * width + x + dx
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        component.append(neighbor)
                        pending.append(neighbor)
        yield np.divmod(np.asarray(component, np.int32), width)


def _spot_patch(*, lab, mask, ys, xs, radius):
    height, width = mask.shape
    span_x, span_y = int(np.ptp(xs)) + 1, int(np.ptp(ys)) + 1
    if max(span_x, span_y) > 2 * radius + 1 or len(xs) > (2 * radius + 1) ** 2:
        return None
    if max(span_x, span_y) > max(3, min(span_x, span_y) * 3):
        return None
    if len(xs) >= 4:
        coordinates = np.column_stack((xs - xs.mean(), ys - ys.mean()))
        eigenvalues = np.linalg.eigvalsh(coordinates.T @ coordinates / len(xs))
        if eigenvalues[1] > max(.5, eigenvalues[0]) * 8:
            return None
    margin = max(3, radius + 1)
    x0, x1 = int(xs.min()) - margin, int(xs.max()) + margin + 1
    y0, y1 = int(ys.min()) - margin, int(ys.max()) + margin + 1
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height:
        return None
    spot = np.zeros((y1 - y0, x1 - x0), np.uint8)
    spot[ys - y0, xs - x0] = 255
    expanded = np.array(Image.fromarray(spot).filter(ImageFilter.MaxFilter(3))) > 0
    surrounding = ~expanded
    reliable = mask[y0:y1, x0:x1] >= .25
    if np.mean(reliable[surrounding]) < .95 or not np.all(reliable[spot > 0]):
        return None
    patch = lab[y0:y1, x0:x1]
    yy, xx = np.mgrid[:spot.shape[0], :spot.shape[1]].astype(np.float64)
    xx -= xx.mean()
    yy -= yy.mean()
    design = np.stack((np.ones_like(xx), xx, yy), axis=-1)
    ring = surrounding & reliable
    values = patch[ring].astype(np.float64)
    model = np.linalg.lstsq(design[ring], values, rcond=None)[0]
    error = values - design[ring] @ model
    deviation = np.median(np.abs(error[:, 0] - np.median(error[:, 0]))) * 1.4826
    clean = np.abs(error[:, 0]) <= max(2., deviation * 2.5)
    if clean.mean() < .85:
        return None
    model = np.linalg.lstsq(design[ring][clean], values[clean], rcond=None)[0]
    error = values - design[ring] @ model
    # A planar ring can model gentle shading, but not a garment/shadow boundary.
    if np.percentile(np.abs(error[:, 0]), 90) > max(3., deviation * 2.8) or deviation > 3:
        return None
    if np.percentile(np.linalg.norm(error[:, 1:], axis=-1), 90) > 4:
        return None
    prediction = design @ model
    deficit = prediction[..., 0] - patch[..., 0]
    contrast = float(np.median(deficit[spot > 0]))
    if contrast < max(4., deviation * 3):
        return None
    core = spot > 0
    weight = np.where(core, 1., np.clip((deficit - max(1.5, deviation * 2)) / 4, 0, 1))
    weight *= expanded & reliable & (deficit > max(1., deviation))
    return (slice(y0, y1), slice(x0, x1)), prediction, weight.astype(np.float32)


def _complete_small_holes(*, mask, guard, radius):
    positive = mask > 0
    binary = Image.fromarray(positive.astype(np.uint8) * 255)
    closed = np.array(binary.filter(ImageFilter.MaxFilter(2 * radius + 1)).filter(
        ImageFilter.MinFilter(2 * radius + 1))) > 0
    completed = mask.copy()
    holes = closed & ~positive
    if np.count_nonzero(holes) > 100000:
        return completed
    for ys, xs in _components(candidates=holes):
        if len(xs) > (2 * radius) ** 2 or max(np.ptp(xs), np.ptp(ys)) >= 2 * radius:
            continue
        x0, x1 = int(xs.min()) - 1, int(xs.max()) + 2
        y0, y1 = int(ys.min()) - 1, int(ys.max()) + 2
        if x0 < 0 or y0 < 0 or x1 > mask.shape[1] or y1 > mask.shape[0]:
            continue
        hole = np.zeros((y1 - y0, x1 - x0), np.uint8)
        hole[ys - y0, xs - x0] = 255
        border = (np.array(Image.fromarray(hole).filter(ImageFilter.MaxFilter(3))) > 0) & (hole == 0)
        surrounding = mask[y0:y1, x0:x1][border]
        if not np.all(guard[ys, xs]) or not np.all(surrounding >= .25):
            continue
        completed[ys, xs] = np.median(surrounding)
    return completed


def soften_small_spots(*, rgb, mask, value, repair_guard=None):
    """Preserve unselected pixels; small dark moles may soften along with blemishes."""
    lab = rgb_to_lab(rgb=rgb)
    luminance = Image.fromarray(np.clip(np.rint(lab[..., 0] * 2.55), 0, 255).astype(np.uint8))
    radius = max(1, min(12, int(np.ceil(min(mask.shape) / 240))))
    guard = mask > 0 if repair_guard is None else repair_guard
    effective_mask = _complete_small_holes(mask=mask, guard=guard, radius=radius)
    scales = sorted({1, max(1, radius // 2), radius})
    residual = np.zeros(mask.shape, np.float32)
    for scale in scales:
        closed = luminance.filter(ImageFilter.MaxFilter(scale * 2 + 1)).filter(
            ImageFilter.MinFilter(scale * 2 + 1))
        residual = np.maximum(residual, np.asarray(closed, np.float32) / 2.55 - lab[..., 0])
    candidates = (residual > 4.5) & (effective_mask >= .25)
    weights = np.zeros(mask.shape, np.float32)
    target = lab.copy()
    accepted = 0
    candidate_pixels = int(candidates.sum())
    over_budget = candidate_pixels > 100000
    if not over_budget:
        for ys, xs in _components(candidates=candidates):
            if residual[ys, xs].max() < 6:
                continue
            replacement = _spot_patch(lab=lab, mask=effective_mask, ys=ys, xs=xs, radius=radius)
            if replacement is None:
                continue
            region, prediction, weight = replacement
            replace = weight > weights[region]
            target[region][replace] = prediction[replace]
            weights[region][replace] = weight[replace]
            accepted += 1
    weights *= value / 100 * .95
    effective_mask = np.where(weights > 0, effective_mask, mask)
    diagnostics = {"policy": "multiscale-compact-dark-spot-v1", "scaleRadii": scales,
                   "candidatePixels": candidate_pixels, "acceptedSpots": accepted,
                   "repairPixels": int(np.count_nonzero(weights)), "candidateBudgetExceeded": over_budget,
                   "supportSha256": hashlib.sha256((weights > 0).astype(np.uint8).tobytes()).hexdigest(),
                   "baseMaskSha256": hashlib.sha256(mask.astype('<f4').tobytes()).hexdigest(),
                   "effectiveMaskSha256": hashlib.sha256(effective_mask.astype('<f4').tobytes()).hexdigest(),
                   "additionalSupportPixels": int(np.count_nonzero((mask == 0) & (effective_mask > 0))),
                   "smallDarkMarksMaySoften": True,
                   "limitation": "Local dark-spot softening, not semantic blemish diagnosis or tattoo removal; "
                                 "large marks, strong edges and unreliable surrounding skin are retained."}
    return lab_to_rgb(lab=target), weights, effective_mask, diagnostics
