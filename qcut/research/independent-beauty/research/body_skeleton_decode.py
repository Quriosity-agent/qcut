"""Body keypoints of a still frame, as the smart-body effect computes them.

The effect first scales the frame so its long side is 640 (aspect kept, native linear
resize; exact halvings take the 2x2 area path). On that image the coarse network finds
people (18 joint heatmaps and 19 limb vector fields, grouped as in the native decoder);
the first person seeds a tracker that never reports this coarse pose. Two refinement
passes follow on the same frame: each crops a box around the current pose (aspect-fit
into 144x192), runs the refine network (17 COCO joints), converts to the 18-joint layout
and smooths against the previous pose. The second pass is the pose the effect uses.
Coordinates are integer pixels of the 640 image; every arithmetic step rounds to float32
as the native code does. QCut-owned port, verified on real render tensors.
"""
import math

import numpy as np

from body_skeleton_kernels import (f32, fcvtzs, fma, find_candidate_limbs, find_coarse_peaks,
                                   find_max_by_mask, find_max_by_mask_single, resize_cubic, resize_nearest,
                                   LIMB_JOINTS)
from body_skeleton_preprocess import resize_linear_u8, skeleton005_auto

ALGORITHM_LONG_SIDE = 640
REFINE_SIZE = (144, 192)
REFINE_PASSES = 2
SMOOTH_SIGMA = .035
COCO_TO_CPM = [0, -1, 6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]


def group_joints_by_limbs(limbs, candidate_count, joint_count=18):
    """Sequential limb grouping in affinity order; scores are the mean of recorded limbs."""
    if len(limbs) > len(LIMB_JOINTS):
        raise ValueError('topology supports up to 19 limb types')
    owners = [-1] * candidate_count
    groups, histories = [], []
    for limb_type, candidates in enumerate(limbs):
        ja, jb = LIMB_JOINTS[limb_type]
        for li, (a, b, score) in enumerate(candidates):
            ga, gb = owners[a], owners[b]
            if ga == -1 and gb == -1:
                group = [-1] * joint_count
                group[ja], group[jb] = a, b
                history = [-1] * len(limbs)
                history[limb_type] = li
                owners[a] = owners[b] = len(groups)
                groups.append(group)
                histories.append(history)
            elif ga == -1:
                if groups[gb][ja] != -1:
                    continue
                groups[gb][ja] = a
                owners[a] = gb
                histories[gb][limb_type] = li
            elif gb == -1:
                if groups[ga][jb] != -1:
                    continue
                groups[ga][jb] = b
                owners[b] = ga
                histories[ga][limb_type] = li
            elif ga != gb:
                if any(x != -1 and y != -1 for x, y in zip(groups[ga], groups[gb])):
                    continue
                for j, c in enumerate(groups[gb]):
                    if groups[ga][j] == -1:
                        groups[ga][j] = c
                    if c != -1:
                        owners[c] = ga
                for t, h in enumerate(histories[gb]):
                    if h != -1:
                        histories[ga][t] = h
                groups[gb], histories[gb] = [], []
    kept, scores = [], []
    for group, history in zip(groups, histories):
        if not group:
            continue
        score, count = 0.0, 0
        for t, li in enumerate(history):
            if li != -1:
                score = f32(score + f32(limbs[t][li][2]))
                count += 1
        kept.append(group)
        scores.append(f32(score / count))
    return kept, scores


def _compatible(a, b, candidate_xy):
    shared = False
    for ai, bi in zip(a, b):
        if ai == -1 or bi == -1:
            continue
        (ax, ay), (bx, by) = candidate_xy[ai], candidate_xy[bi]
        if abs(ax - bx) > 1 or abs(ay - by) > 1:
            return False
        shared = True
    return shared


def filter_joint_groups(groups, scores, candidate_xy):
    """Keep groups with >= 4 joints and score >= 0.4; compatible rejected fragments fill their holes."""
    kept, kept_scores, rejected = [], [], []
    for group, score in zip(groups, map(f32, scores)):
        if score < f32(.4) or sum(i != -1 for i in group) < 4:
            rejected.append(list(group))
        else:
            kept.append(list(group))
            kept_scores.append(score)
    for group in kept:
        for fragment in rejected:
            if _compatible(group, fragment, candidate_xy):
                group[:] = [b if a == -1 else a for a, b in zip(group, fragment)]
    return kept, kept_scores


def joints_to_xys(groups, candidate_xy, heatmaps, coordinate_scale):
    coordinate_scale = f32(coordinate_scale)
    result = []
    for group in groups:
        person = []
        for joint, ci in enumerate(group):
            if ci == -1:
                person.extend([-1.0, -1.0, -1.0])
                continue
            x, y = candidate_xy[ci]
            person.extend([f32((x + .5) * coordinate_scale), f32((y + .5) * coordinate_scale), f32(heatmaps[joint][y][x])])
        result.append(person)
    return result


def postprocess(heatmaps, pafs, *, stride=4, coordinate_scale=2, paf_scale=1, single=False, joint_count=18):
    """CHW heatmaps (and vector maps) to flat [x, y, score] joint lists in network-input pixels."""
    heatmaps = heatmaps[:joint_count]  # the last coarse channel is background
    h, w = len(heatmaps[0]), len(heatmaps[0][0])
    seeds = find_coarse_peaks(heatmaps)
    prepared = [resize_cubic(m, h * stride, w * stride) for m in heatmaps]
    if single:
        best = [None] * joint_count
        for x, y, c in find_max_by_mask_single(prepared, seeds, stride):
            score = prepared[c][y][x]
            if best[c] is None or score > best[c][2]:
                best[c] = (x, y, score)
        person = []
        for peak in best:
            if peak is None:
                person.extend([-1., -1., 0.])
                continue
            x, y, s = peak
            person.extend([f32((x + .5) * f32(coordinate_scale)), f32((y + .5) * f32(coordinate_scale)), s])
        return [person]
    peaks = find_max_by_mask(prepared, seeds, stride)
    xy = [[x, y] for x, y, _ in peaks]
    ids = [[] for _ in range(18)]
    for index, (_, _, c) in enumerate(peaks):
        ids[c].append(index)
    ph, pw = int(f32(f32(h * stride) * f32(paf_scale))), int(f32(f32(w * stride) * f32(paf_scale)))
    limbs = find_candidate_limbs([resize_nearest(m, ph, pw) for m in pafs], xy, ids, paf_scale)
    groups, scores = group_joints_by_limbs(limbs, len(xy))
    groups, scores = filter_joint_groups(groups, scores, xy)
    return joints_to_xys(groups, xy, prepared, coordinate_scale)


def map_local_to_global(groups, map_size, roi):
    """Flat [x, y, score] triples to [int x, int y, score, valid] through a float32 ROI (orientation 0)."""
    mw, mh = map(f32, map_size)
    ox, oy, rw, rh = map(f32, roi)
    result = []
    for group in groups:
        group = list(map(f32, group))
        if len(group) % 3:
            raise ValueError('each person needs complete x, y, score triples')
        person = []
        for i in range(0, len(group), 3):
            x, y, score = group[i:i + 3]
            if x < 0 or not y >= 0:
                person.append([-1, -1, -1.0, 0])
                continue
            gx = f32(f32(f32(rw * x) / mw) + ox)
            gy = f32(f32(f32(rh * y) / mh) + oy)
            person.append([fcvtzs(gx), fcvtzs(gy), score, 1])
        result.append(person)
    return result


def next_body_box(points, image_size, aspect_threshold=.8, wide_margin=.4, other_margin=.2,
                  vertical_margin=.2, min_aspect=.5, min_size=(32, 32)):
    """Base joint bounds, widened for upright bodies; excludes tracking recovery margins."""
    iw, ih = image_size
    good = [p for p in points if p[3]]
    if not good:
        return None
    xmin = max(0, min([iw] + [p[0] for p in good]))
    ymin = max(0, min([ih] + [p[1] for p in good]))
    xmax = min(iw - 1, max([0] + [p[0] for p in good]))
    ymax = min(ih - 1, max([0] + [p[1] for p in good]))
    if xmax <= xmin or ymax <= ymin:
        return None
    bw, bh = xmax - xmin + 1, ymax - ymin + 1
    mx = f32(wide_margin if f32(f32(bh) * f32(aspect_threshold)) > f32(bw) else other_margin)
    my = f32(vertical_margin)
    left = max(0, fcvtzs(f32(fma(-f32(bw), mx, f32(xmin)))))
    top = max(0, fcvtzs(f32(fma(-f32(bh), my, f32(ymin)))))
    right = min(iw, fcvtzs(f32(fma(f32(bw), mx, f32(xmin + bw)))))
    bottom = min(ih, fcvtzs(f32(fma(f32(bh), my, f32(ymin + bh)))))
    width, height = right - left, bottom - top
    if width < 1 or height < 1:
        return None
    required_width = f32(f32(height) * f32(min_aspect))
    if required_width > f32(width):
        deficit = f32(required_width - f32(width))
        pad = min(left, iw - (left + width), math.trunc(float(deficit) * .5))
        left -= pad
        width += 2 * pad
    if width < min_size[0] or height < min_size[1]:
        return None
    return [left, top, width, height]


def tracking_body_box(points, image_size):
    """Bach CPU tracker crop with its default missing-ankle and missing-knee recovery."""
    box = next_body_box(points, image_size)
    if box is None:
        return None
    left, top, width, height = box
    # A torso-only crop would keep the refinement network from recovering legs.
    if not points[10][3] and not points[13][3]:
        bottom = min(image_size[1], fcvtzs(f32(fma(f32(height), f32(.6), f32(top + height)))))
        height = bottom - top
    if points[0][3] and points[1][3] and not (points[9][3] and points[12][3]):
        nose_y, neck_y = points[0][1], points[1][1]
        recovered_top = max(0, fcvtzs(f32(fma(-f32(neck_y - nose_y), f32(2), f32(neck_y)))))
        new_top = min(top, recovered_top)
        height += top - new_top
        top = new_top
    return [left, top, width, height]


def crop_layout_and_roi(box, target=REFINE_SIZE):
    """Raster rectangle of `box` aspect-fitted into `target`, and the effective image ROI."""
    x, y, w, h = box
    tw, th = target
    cx, cy = f32(x + w * .5), f32(y + h * .5)
    fx, fy, fw, fh = map(f32, (x, y, w, h))
    ftw, fth = map(f32, target)
    left, top = f32(cx - fx), f32(cy - fy)
    right, bottom = f32(f32(x + w) - cx), f32(f32(y + h) - cy)
    maxdist = max(f32(f32(fth + fth) * left), f32(f32(ftw + ftw) * top), f32(f32(fth + fth) * right),
                  f32(f32(ftw + ftw) * bottom))
    ex, ey = f32(maxdist / fth), f32(maxdist / ftw)
    ox, oy = f32(fma(f32(-.5), ex, cx)), f32(fma(f32(-.5), ey, cy))
    sx = max(0, fcvtzs(f32(f32(f32(fx - ox) * ftw) / ex)))
    sy = max(0, fcvtzs(f32(f32(f32(fy - oy) * fth) / ey)))
    endx = min(tw, fcvtzs(f32(f32(f32(f32(x + w) - ox) * ftw) / ex)))
    endy = min(th, fcvtzs(f32(f32(f32(f32(y + h) - oy) * fth) / ey)))
    cw, ch = endx - sx, endy - sy
    if min(cw, ch) <= 0:
        raise ValueError('degenerate raster crop')
    roi = [f32(fx - f32(f32(fw * f32(sx)) / f32(cw))), f32(fy - f32(f32(fh * f32(sy)) / f32(ch))),
           f32(f32(fw * ftw) / f32(cw)), f32(f32(fh * fth) / f32(ch))]
    return [sx, sy, cw, ch], roi


def refine_tensor(rgb, box, out_h=192, out_w=144):
    """The refine network's int16 input: `box` aspect-fitted into 144x192, BGR minus 128."""
    x, y, w, h = map(int, box)
    (left, top, cw, ch), _ = crop_layout_and_roi(box, (out_w, out_h))
    rgba = np.concatenate((rgb, np.full((*rgb.shape[:2], 1), 255, np.uint8)), axis=-1)
    resized = resize_linear_u8(rgba, ch, cw, (x, y, w, h))[..., :3]
    data = np.zeros((out_h, out_w, 3), np.int16)
    data[top:top + ch, left:left + cw] = resized[..., ::-1].astype(np.int16) - 128
    return data


def coco17_to_cpm18(points):
    """COCO 17 joints to the 18-joint layout; the neck is the shoulders' integer midpoint."""
    out = [list(points[i]) if i >= 0 else [-1, -1, -1.0, 0] for i in COCO_TO_CPM]
    a, b = points[5], points[6]

    def average(x, y):
        value = ((x + y + 2147483648) % 4294967296) - 2147483648
        return value // 2 if value >= 0 else -((-value) // 2)

    out[1] = [average(a[0], b[0]), average(a[1], b[1]), f32(f32(f32(a[2]) + f32(b[2])) * .5),
              int(bool(a[3]) and bool(b[3]))]
    return out


def smooth_keypoints(current, previous, scale, sigma):
    """Adaptive smoothing toward the previous pose for joints valid in both."""
    scale, sigma = f32(scale), f32(sigma)
    inverse = f32(1.0 / f32(max(scale, 1.0) * sigma))
    result = []
    for (x, y, score, valid), last in zip(current, previous):
        score = f32(score)
        if valid and last[3]:
            dx = f32(f32(_int32(x - last[0])) * inverse)
            dy = f32(f32(_int32(y - last[1])) * inverse)
            e = f32(math.exp(-f32(f32(dx * dx) + f32(dy * dy))))
            a = f32(fma(-e, score, score))
            b = f32(fma(f32(e - 1.0), score, 1.0))
            x = fcvtzs(f32(fma(f32(last[0]), b, f32(f32(x) * a))))
            y = fcvtzs(f32(fma(f32(last[1]), b, f32(f32(y) * a))))
        result.append([x, y, score, valid])
    return result


def _int32(x):
    return ((int(x) + 2147483648) % 4294967296) - 2147483648


def refine_pose(heatmaps, roi, previous, body_scale, sigma=SMOOTH_SIGMA, missing=.5, tracked=.2):
    local = postprocess(heatmaps, [], stride=4, coordinate_scale=2, paf_scale=1, single=True, joint_count=17)
    current = coco17_to_cpm18(map_local_to_global(local, REFINE_SIZE, roi)[0])
    if sum(1 for p in current if p[3] and p[2] >= 0.0) < 8:  # pruneFalseAlarm
        current = [[-1, -1, -1.0, 0] for _ in current]
    for index, point in enumerate(current):
        threshold = f32(tracked if previous[index][3] else missing)
        if point[3] and point[2] < threshold:
            current[index] = [-1, -1, 0.0, 0]
    return smooth_keypoints(current, previous, body_scale, sigma)


def algorithm_image(rgba):
    """The frame as the effect's algorithms see it: long side 640, aspect kept."""
    h, w = rgba.shape[:2]
    scale = ALGORITHM_LONG_SIDE / max(w, h)
    return resize_linear_u8(rgba, max(1, round(h * scale)), max(1, round(w * scale)))


def still_pose(*, rgba, networks):
    """The pose the effect uses on a still frame, in algorithm-image pixels, or None.

    Returns (points, details): 18 [x, y, score, valid] joints of the first coarse person
    after the two refinement passes, and what each stage saw.
    """
    return pose_from_algorithm(algorithm=algorithm_image(rgba), networks=networks, refinement_passes=REFINE_PASSES)


def pose_from_algorithm(*, algorithm, networks, refinement_passes, tracker_crop=False):
    """First coarse person refined on a caller-owned algorithm raster; fresh state per call."""
    if type(refinement_passes) is not int or not 1 <= refinement_passes <= REFINE_PASSES:
        raise ValueError("one or two refinement passes required")
    if (not isinstance(algorithm, np.ndarray) or algorithm.dtype != np.uint8 or algorithm.ndim != 3
            or algorithm.shape[2] not in (3, 4) or min(algorithm.shape[:2]) < 16
            or max(algorithm.shape[:2]) > ALGORITHM_LONG_SIDE):
        raise ValueError("bounded RGB algorithm image required")
    rgb = np.ascontiguousarray(algorithm[..., :3])
    height, width = rgb.shape[:2]
    tensor, preprocess = skeleton005_auto(rgb)
    outputs = networks.infer(tensor=tensor[None], network='coarse')
    heat = outputs['heatmap_output_0'][0].transpose(2, 0, 1).astype(np.float32) / np.float32(1024)
    paf = outputs['vectormap_output_0'][0].transpose(2, 0, 1).astype(np.float32) / np.float32(1024)
    th, tw = tensor.shape[:2]
    _, roi = crop_layout_and_roi([0, 0, width, height], (tw, th))
    people = map_local_to_global(postprocess(heat.tolist(), paf.tolist()), (tw, th), roi)
    details = {'algorithmSize': [width, height], 'coarseTensor': [tw, th], 'coarsePreprocess': preprocess,
               'coarsePeople': len(people), 'refineBoxes': []}
    if not people or sum(1 for p in people[0] if p[3] and p[2] >= 0.0) < 8:
        return None, details
    points = [list(p) for p in people[0]]
    for _ in range(refinement_passes):
        box_builder = tracking_body_box if tracker_crop else next_body_box
        box = box_builder(points, (width, height))
        if box is None:
            return None, details
        _, refine_roi = crop_layout_and_roi(box)
        details['refineBoxes'].append(box)
        refined = networks.infer(tensor=refine_tensor(rgb, box)[None], network='refine')['output_0']
        heatmaps = (refined[0].transpose(2, 0, 1).astype(np.float32) / np.float32(1024)).tolist()
        points = refine_pose(heatmaps, refine_roi, points, max(box[2:]))
        if not any(p[3] for p in points):
            return None, details
    return points, details
