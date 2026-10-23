"""Cold one-shot refinement with independently selected per-detector backends."""

from body_skeleton_sequence import BodySkeletonSequence


class SwingBodySkeleton(BodySkeletonSequence):
    def _coarse(self, *, rgb):
        return self.networks.detect(network='coarse', rgb=rgb)

    def _refine(self, *, rgb, box):
        return self.networks.detect(network='refine', rgb=rgb, box=box)

    def update(self, *, algorithm):
        first_call = self.frame == 0
        result = super().update(algorithm=algorithm)
        passes = [self.last_debug]
        if first_call and self.points is not None:
            self.frame -= 1
            result = super().update(algorithm=algorithm)
            passes.append(self.last_debug)
        self.last_debug = {**self.last_debug, 'detectorPasses': passes}
        return result
