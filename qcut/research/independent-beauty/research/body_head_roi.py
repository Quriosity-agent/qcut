"""Protected head region when no face is associated with the body, and its history."""
import numpy as np
import struct
from body_head import f, ema

def update(s, width, height):
    g = s.get
    p = s.put
    old = np.array([g(148), g(152)], np.float32)
    prev = np.array([g(156), g(160)], np.float32)
    face = struct.unpack_from('<i', s.data, 248)[0] == 1
    target = np.array([g(80 if face else 140), g(84 if face else 144)], np.float32)
    radius = g(64 if face else 108)
    counter = struct.unpack_from('<i', s.data, 256)[0]
    blend = f(f(f(f(counter) * f(0.5)) / f(30)) + f(0.5)) if counter else f(1)
    norm = lambda a: f(np.sqrt(np.sum(a * a, dtype=np.float32)))
    if np.all(old != f(-1)) and np.all(prev != f(-1)) and (f(norm(old - prev) * f(10)) < norm(old - target)) and (not s.data[164]):
        s.data[164] = 1
        return
    for off, val in zip([156, 160], old):
        p(off, val)
    center = np.array([ema(a, b, f(blend * f(0.2))) for a, b in zip(old, target)], np.float32)
    x, y = center
    p(148, x)
    p(152, y)
    distances = np.array([f(x - g(184)), f(g(188) - x), f(y - g(192)), f(g(196) - y)], np.float32)
    desired = np.array([radius, radius, radius, radius], np.float32)
    far = bool(np.all(distances > radius * np.array([1, 1, 1, 0.8], np.float32)))
    middle = bool(np.all(distances > radius * np.array([0.7, 0.7, 0.5, 0.3], np.float32)))
    if far:
        lengths = np.minimum(desired, [x, f(f(width - 1) - x), y, f(f(height - 1) - y)]).astype(np.float32)
        bounds = np.array([f(x - lengths[0]), f(x + lengths[1]), f(y - lengths[2]), f(y + lengths[3])], np.float32)
        for off, val in zip([184, 188, 192, 196], bounds):
            p(off, ema(g(off), val, f(blend * f(0.9))))
        lengths = np.array([f(x - g(184)), f(g(188) - x), f(y - g(192)), f(g(196) - y)], np.float32)
    else:
        weight = f(blend * f(0.2)) if middle else f(blend * f(0.9))
        lengths = np.array([ema(g(off), val, weight) for off, val in zip([168, 172, 180, 176], desired)], np.float32)
        lengths = np.minimum(lengths, [x, f(f(width - 1) - x), y, f(f(height - 1) - y)]).astype(np.float32)
        bounds = np.array([f(x - lengths[0]), f(x + lengths[1]), f(y - lengths[2]), f(y + lengths[3])], np.float32)
        bound_weight = f(blend * f(f(0.9) - f(0.2))) if middle else f(blend * f(0.9))
        for off, val in zip([184, 188, 192, 196], bounds):
            p(off, ema(g(off), val, bound_weight))
    for off, val in zip([168, 172, 180, 176], lengths):
        p(off, val)
    with np.errstate(divide='ignore', invalid='ignore'):
        p(200, f(np.fmin(f(min(lengths) / radius), f(1))))
