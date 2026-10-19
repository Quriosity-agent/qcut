"""Score ordering of the pinned detector's Box sort, including equal scores.

The partition swaps determine which overlapping tied proposal survives NMS.
Only scores participate in comparisons; coordinates never break ties.
"""
import numpy as np


class _ScoreOrder:
    def __init__(self, *, scores):
        self.scores = scores.tolist()
        self.order = list(range(len(scores)))

    def before(self, *, left, right):
        return self.scores[self.order[left]] > self.scores[self.order[right]]

    def swap(self, *, left, right):
        self.order[left], self.order[right] = self.order[right], self.order[left]

    def small(self, *, positions):
        count = len(positions)
        if count < 2:
            return 0
        a, b = positions[:2]
        if count == 2:
            if not self.before(left=b, right=a):
                return 0
            self.swap(left=a, right=b)
            return 1
        c = positions[2]
        swaps = 0
        if not self.before(left=b, right=a):
            if self.before(left=c, right=b):
                self.swap(left=b, right=c)
                swaps = 1
                if self.before(left=b, right=a):
                    self.swap(left=a, right=b)
                    swaps = 2
        elif self.before(left=c, right=b):
            self.swap(left=a, right=c)
            swaps = 1
        else:
            self.swap(left=a, right=b)
            swaps = 1
            if self.before(left=c, right=b):
                self.swap(left=b, right=c)
                swaps = 2
        for index in range(3, count):
            for previous in range(index - 1, -1, -1):
                left, right = positions[previous:previous + 2]
                if not self.before(left=right, right=left):
                    break
                self.swap(left=left, right=right)
                swaps += 1
        return swaps

    def insertion(self, *, first, last, incomplete=False):
        count = last - first
        if count <= 5:
            self.small(positions=list(range(first, last)))
            return True
        self.small(positions=[first, first + 1, first + 2])
        moves = 0
        for index in range(first + 3, last):
            if not self.before(left=index, right=index - 1):
                continue
            item = self.order[index]
            destination = index
            while destination > first and self.scores[item] > self.scores[self.order[destination - 1]]:
                self.order[destination] = self.order[destination - 1]
                destination -= 1
            self.order[destination] = item
            moves += 1
            if incomplete and moves == 8:
                return index + 1 == last
        return True

    def equal_prefix(self, *, first, last):
        left, right = first + 1, last - 1
        if not self.before(left=first, right=right):
            while left != right and not self.before(left=first, right=left):
                left += 1
            if left == right:
                return last
            self.swap(left=left, right=right)
            left += 1
        if left == right:
            return last
        while True:
            while not self.before(left=first, right=left):
                left += 1
            right -= 1
            while self.before(left=first, right=right):
                right -= 1
            if left >= right:
                return left
            self.swap(left=left, right=right)
            left += 1

    def sift_down(self, *, start, count):
        item = self.order[start]
        while 2 * start + 1 < count:
            child = 2 * start + 1
            if child + 1 < count and self.before(left=child, right=child + 1):
                child += 1
            if self.scores[self.order[child]] > self.scores[item]:
                break
            self.order[start] = self.order[child]
            start = child
        self.order[start] = item

    def partial(self, *, count):
        for start in range((count - 2) // 2, -1, -1):
            self.sift_down(start=start, count=count)
        for index in range(count, len(self.order)):
            if self.before(left=index, right=0):
                self.swap(left=index, right=0)
                self.sift_down(start=0, count=count)
        for end in range(count - 1, 0, -1):
            self.swap(left=0, right=end)
            self.sift_down(start=0, count=end)

    def sort(self, *, first, last):
        while last - first > 30:
            count = last - first
            pivot = first + count // 2
            samples = [first, pivot, last - 1]
            if count >= 1000:
                quarter = count // 2 // 2
                samples = [first, first + quarter, pivot, pivot + quarter, last - 1]
            swaps = self.small(positions=samples)
            left, right = first, last - 1
            if not self.before(left=left, right=pivot):
                right -= 1
                while left != right and not self.before(left=right, right=pivot):
                    right -= 1
                if left == right:
                    first = self.equal_prefix(first=first, last=last)
                    continue
                self.swap(left=left, right=right)
                swaps += 1
            left += 1
            if left < right:
                while True:
                    while self.before(left=left, right=pivot):
                        left += 1
                    right -= 1
                    while not self.before(left=right, right=pivot):
                        right -= 1
                    if left > right:
                        break
                    self.swap(left=left, right=right)
                    swaps += 1
                    if pivot == left:
                        pivot = right
                    left += 1
            if left != pivot and self.before(left=pivot, right=left):
                self.swap(left=left, right=pivot)
                swaps += 1
            if swaps == 0:
                left_done = self.insertion(first=first, last=left, incomplete=True)
                right_done = self.insertion(first=left + 1, last=last, incomplete=True)
                if right_done:
                    if left_done:
                        return
                    last = left
                    continue
                if left_done:
                    first = left + 1
                    continue
            if left - first < last - left:
                self.sort(first=first, last=left)
                first = left + 1
            else:
                self.sort(first=left + 1, last=last)
                last = left
        self.insertion(first=first, last=last)


def native_score_order(*, scores, before=None):
    values = np.asarray(scores, dtype=np.float32)
    if (values.ndim != 1 or len(values) > 20000 or not np.isfinite(values).all()
            or (values < 0).any() or (values > 1).any()):
        raise ValueError("bounded finite detector scores in [0, 1] required")
    if before is not None and (not isinstance(before, int) or isinstance(before, bool)
                               or not 1 <= before <= 20000):
        raise ValueError("bounded positive proposal limit required")
    sorter = _ScoreOrder(scores=values)
    if before is not None and len(values) >= before:
        sorter.partial(count=before)
        return np.asarray(sorter.order[:before], dtype=np.intp)
    sorter.sort(first=0, last=len(values))
    return np.asarray(sorter.order, dtype=np.intp)
