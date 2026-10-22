"""Opt-in CPU research candidate for the observed Swing one-shot first call.

This is not a production profile or an implementation of all external force events.
The input is independently produced pixels; no native points enter the candidate.
"""
from body_skeleton_sequence import BodySkeletonSequence


class ColdStartSkeletonCandidate(BodySkeletonSequence):
    def update(self, *, algorithm):
        first_call = self.frame == 0
        result = super().update(algorithm=algorithm)
        if first_call and self.points is not None:
            self.frame = 0
            result = super().update(algorithm=algorithm)
        return result
