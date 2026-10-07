"""Extra affine sampling uses double inverse arithmetic before float32 tables."""
import numpy as np

from alignment_sampling import inverse_forward, quantize


def signed_extra_input(*, frame, forward):
    inverse_forward(forward=forward)
    if (not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3
            or frame.shape[2] != 4 or not all(1 <= n <= 4096 for n in frame.shape[:2])):
        raise ValueError('bounded RGBA Extra frame required')
    inverse = np.linalg.inv(np.vstack([forward.astype(np.float64), [0, 0, 1]]))[:2].astype(np.float32)
    p, q, u, r, s, v = inverse.reshape(-1)
    x = np.arange(160, dtype=np.float32)[None, :]
    y = np.arange(160, dtype=np.float32)[:, None]
    sx = quantize(values=p*x+u)+quantize(values=q*y)
    sy = quantize(values=r*x+v)+quantize(values=s*y)
    height, width = frame.shape[:2]
    valid = (sx >= 0) & (sx < width) & (sy >= 0) & (sy < height)
    output = np.zeros((160, 160, 3), dtype=np.uint8)
    output[valid] = frame[sy[valid], sx[valid], :3][:, ::-1]
    return (output.astype(np.int16)-128)[None, ...]


def warm_fitting_points(*, points, seed, size):
    from alignment_temporal import initialize, update
    if (points.dtype != np.float32 or points.shape != (240, 2) or not np.isfinite(points).all()
            or seed.dtype != np.float32 or seed.shape != (106, 2)):
        raise ValueError('owned Extra240 and seed106 required')
    parameters = {'width': size[0], 'height': size[1], 'alpha': float(np.float32(.2))}
    first, _ = update(state=initialize(points=seed[:33], escale=10, **parameters),
                      points=points[:33], optimized=False)
    state = initialize(points=seed[33:], escale=1, **parameters)
    _, state = update(state=state, points=points[33:106], optimized=False)
    last, _ = update(state=state, points=points[33:106], optimized=False)
    result = points.copy()
    result[:106] = np.concatenate([first, last])
    return result
