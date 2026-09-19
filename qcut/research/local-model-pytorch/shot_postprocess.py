"""Shared seven-frame shot head postprocessing; cut indices end the preceding shot."""

WINDOW = 7
CENTER_OFFSET = 3
FIRST_SCORED_FRAME = 7
FLAT_EPS = 0.1


def cut_points(scores, diffs, threshold):
    centers = sorted(scores)
    probabilities = [scores[center] for center in centers]

    def difference(index):
        return diffs[index] if 0 <= index < len(diffs) else 0.0

    cuts, carry = [], 0
    for index in range(1, len(probabilities) - 1):
        previous, current, following = probabilities[index - 1:index + 2]
        rising = int(previous < current) | carry
        carry = int(current <= following) & rising
        if current <= following or not rising:
            continue
        if not current > threshold:
            carry = 0
            continue
        center = centers[index]
        if abs(current - previous) < FLAT_EPS and difference(center - 1) > 2 * difference(center - 2):
            center -= 1
        elif abs(current - following) < FLAT_EPS and difference(center) < 2 * difference(center + 1):
            center += 1
        cuts.append(center)
    return cuts
