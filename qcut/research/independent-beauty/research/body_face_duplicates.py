"""Ordered duplicate suppression for the pinned five-slot video face profile."""
import numpy as np

from body_face_matching import _rectangles, overlap


def containment(*, first, second):
    boxes = _rectangles(values=[first, second])
    ends = boxes[:, :2] + boxes[:, 2:]
    for outer, inner, result in ((0, 1, -1), (1, 0, 1)):
        inside = (boxes[inner, :2] > boxes[outer, :2]).all() and (ends[inner] < ends[outer]).all()
        smaller = (boxes[inner, 2:].astype(np.float64) < boxes[outer, 2:].astype(np.float64) * .5).any()
        if inside and smaller:
            return result
    return 0


def suppress_duplicates(*, slots):
    if len(slots) > 5:
        raise ValueError('at most five native face slots required')
    for slot in slots:
        _rectangles(values=[slot.box])
        if not np.isfinite(slot.confidence):
            raise ValueError('finite face confidence required')
    for first_index, first in enumerate(slots):
        if not first.active or first.new:
            continue
        for second in slots[first_index + 1:]:
            if not second.active or second.new:
                continue
            if float(overlap(first=first.box, second=second.box)) > .2:
                loser = first if first.confidence < second.confidence else second
                loser.active = False
                # Native continues this inner loop even when the outer slot loses.
    for direction in (-1, 1):
        for first_index, first in enumerate(slots):
            if not first.active or first.new:
                continue
            for second in slots[first_index + 1:]:
                if not second.active or second.new:
                    continue
                if containment(first=first.box, second=second.box) != direction:
                    continue
                if direction == -1:
                    second.active = False
                    continue
                first.active = False
                break
