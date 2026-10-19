"""Independent orientation-zero face-to-body association and head face fields.

Takes supplied normalized 106-point face results. Does not detect faces.
"""

import math, struct
import numpy as np
from .producer import f, ema, balanced_x

MATCH = [74, 77, 46, 45, 49, 80, 81]
CENTER = [74, 77, 2, 30, 46]
BODY = [0, 14, 15, 16, 17]


def points_in_image(points, ids, w, h):
    p = np.asarray(points, np.float32) * np.array([w, h], np.float32)
    return np.asarray(
        [p[i] for i in ids if np.all(p[i] > 0) and np.all(p[i] < [w, h])], np.float32
    ).reshape(-1, 2)


def mean(p):
    if not len(p):
        return np.full(2, -1, np.float32)
    total = np.zeros(2, np.float32)
    for point in p:
        total = np.asarray(total + point, np.float32)
    return np.asarray(total / f(len(p)), np.float32)


def reset_face(s):
    s.puti(56, -1)
    s.data[60] = 0
    for off in range(64, 88, 4):
        s.put(off, -1)


def update(s, coords, visibility, faces, rects, rolls, w, h, reject_distant=True,
           *, body_present=True):
    s.data[60] = 0
    validids = [i for i in BODY if visibility[i]]
    body = points_in_image(coords, validids, w, h)
    index = 0 if not body_present else -1
    closest = np.finfo(np.float32).max
    if body_present and len(body):
        center = mean(body)
        for i, face in enumerate(faces):
            delta = mean(points_in_image(face, MATCH, w, h)) - center
            distance = f(np.sqrt(np.sum(delta * delta, dtype=np.float32)))
            if distance < closest:
                index = i
                closest = distance
    if index != struct.unpack_from("<i", s.data, 56)[0]:
        reset_face(s)
    if index < 0 or index >= len(faces):
        return
    s.puti(56, index)
    s.data[60] = 1
    c5 = points_in_image(faces[index], CENTER, w, h)
    c7 = points_in_image(faces[index], MATCH, w, h)
    for off, val in zip([72, 76], mean(c7)):
        s.put(off, val)
    s.put(80, balanced_x(c5) if len(c5) else -1)
    s.put(84, mean(c5)[1])
    roll = f(rolls[index])

    def wrap(a):
        if float(a) > math.pi:
            a = f(float(a) - 2 * math.pi)
        if float(a) < -math.pi:
            a = f(float(a) + 2 * math.pi)
        return a

    roll = wrap(wrap(roll))
    s.put(68, ema(s.get(68), roll, 0.3))
    for off, value in zip([88, 92, 96, 100], rects[index]):
        s.put(off, value)
    size = f(max(f(s.get(96) * f(w)), f(s.get(100) * f(h))) * f(1.5))
    s.put(64, ema(s.get(64), size, 0.9))
    delta = mean(body) - np.array([s.get(72), s.get(76)], np.float32)
    if reject_distant and f(np.sqrt(np.sum(delta * delta, dtype=np.float32))) > f(
        f(min(w, h)) * f(0.1)
    ):
        reset_face(s)
