"""Roll-only view of shared native pose filtering for the video body profile."""
import numpy as np

from body_face_metadata import PoseFilter, raw_roll


class RollFilter:
    def __init__(self):
        self.pose = PoseFilter()

    def update(self, *, points):
        incoming = np.asarray([0, 0, raw_roll(points=points)], np.float32)
        return self.pose.update_degrees(incoming)[2]
