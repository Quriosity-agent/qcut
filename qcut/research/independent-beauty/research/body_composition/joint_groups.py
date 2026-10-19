"""Public descriptor groups admit visible joints strictly inside the image."""
import numpy as np


def frame_joint_groups(*, coords, visibility, width, height):
    extent = np.asarray([width, height], np.float32)
    points = np.asarray(coords, np.float32).reshape(18, 2) * extent
    visible = np.asarray(visibility, bool) & np.all((points > 0) & (points < extent), axis=1)
    groups = []
    for ids in ((2, 5), (8, 11), (9, 12)):
        indices = np.asarray(ids)
        groups.append(points[indices[visible[indices]]])
    return points, tuple(groups)
