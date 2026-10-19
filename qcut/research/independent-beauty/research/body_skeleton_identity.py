"""Default one-target body seed selection after native-order coarse decoding."""


def select_seed(*, people):
    # Coarse pruneFalseAlarm invalidates groups below eight nonnegative-score joints;
    # target filtering then retains the first valid group, without reordering it.
    for person in people:
        if sum(bool(point[3]) and point[2] >= 0 for point in person) >= 8:
            return [list(point) for point in person]
    return None
