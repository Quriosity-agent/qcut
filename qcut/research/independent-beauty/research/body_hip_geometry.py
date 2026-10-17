"""Hip shape: the axis-aligned displacement, and the smoothstep the other parts share."""
import numpy as np, math
f = np.float32

def smooth(x):
    x = f(max(0, min(float(x), 1)))
    return f((3.0 - (float(x) + float(x))) * float(f(x * x)))

def deform(src, intensity, center, radii, bounds, profile=(0.5, 0.2, 0.5, 0.3, 0.3), destination=None, width=None, height=None):
    src = np.asarray(src, np.float32)
    dst = src.copy() if destination is None else np.asarray(destination, np.float32).copy()
    rows, cols = np.array(src.shape[:2]) - 1
    w = f(src[0, -1, 0] if width is None else width)
    h = f(src[-1, 0, 1] if height is None else height)
    if abs(f(intensity)) < np.finfo(np.float32).eps:
        return dst
    cx, cy = map(f, center)
    left, right, down, up = map(f, radii)
    xmin, xmax, ymin, ymax = map(f, bounds)
    peak, offset, span, lweight, rweight = map(f, profile)
    xs = f(w / f(cols))
    ys = f(h / f(rows))
    for row in range(max(0, math.ceil(float(f(ymin / ys)))), min(rows, int(f(ymax / ys))) + 1):
        for col in range(max(0, math.ceil(float(f(xmin / xs)))), min(cols, int(f(xmax / xs))) + 1):
            x, y = src[row, col]
            radius = left if x < cx else right
            weight = lweight if x < cx else rweight
            if radius < 1:
                continue
            t = f(min(f(abs(f(x - cx)) / radius), f(1)))
            a = f(min(f(f(t - peak) + span), f(f(peak - t) + span)))
            a = f(f(weight * a) / span)
            a = f(max(a, f(0)))
            a = smooth(f(a / weight))
            dy = f(y - cy)
            v = smooth(f(min(1.0 - float(f(abs(dy) / (down if y <= cy else up))), 1.0)))
            m = f(v * f(f(weight * a) * f(intensity)))
            dx = f(f(f(x - cx) + f(0)) * m)
            ddy = f(f(dy + f(up * offset)) * m)
            dst[row, col, 0] = f(dx + dst[row, col, 0])
            dst[row, col, 1] = f(ddy + dst[row, col, 1])
    return dst
