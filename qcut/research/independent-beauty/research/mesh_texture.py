"""Linear straight-RGBA texture sampling with clamp-to-edge addressing."""
import numpy as np


def linear_samples(*, rgba, coordinates, premultiply=False):
    if type(premultiply) is not bool:
        raise ValueError("explicit floating premultiplication profile required")
    height, width = rgba.shape[:2]
    x = np.clip(coordinates[:, 0] - .5, 0, width - 1)
    y = np.clip(coordinates[:, 1] - .5, 0, height - 1)
    left, top = np.floor(x).astype(np.intp), np.floor(y).astype(np.intp)
    right, bottom = np.minimum(left + 1, width - 1), np.minimum(top + 1, height - 1)
    fx, fy = (x - left)[:, None], (y - top)[:, None]
    color = np.zeros((len(coordinates), 4), np.float64)
    for sample, weight in ((rgba[top, left], (1 - fx) * (1 - fy)),
                           (rgba[top, right], fx * (1 - fy)),
                           (rgba[bottom, left], (1 - fx) * fy),
                           (rgba[bottom, right], fx * fy)):
        if premultiply:
            sample = sample.astype(np.float64)
            sample[:, :3] *= sample[:, 3:4]/255
        color += sample * weight
    return color


def sample_texture(*, rgba, coordinates):
    color = linear_samples(rgba=rgba, coordinates=coordinates)
    return np.clip(np.rint(color), 0, 255).astype(np.uint8)
