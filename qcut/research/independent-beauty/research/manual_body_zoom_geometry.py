"""Owned finite zoom geometry; no models, effect packages or native libraries."""
import numpy as np

CELLS = 250
CANVAS_SCALE = np.float32(1.2)


def base_grid(*, width, height):
    size = np.asarray([width, height], np.float32)
    expanded = np.ceil(size * CANVAS_SCALE).astype(np.int32)
    step = expanded.astype(np.float32) / np.float32(CELLS)
    half_gap = (expanded - np.asarray([width, height])) * .5
    low = np.maximum(np.ceil(half_gap / step).astype(np.int32), 1)
    remaining = expanded - size - half_gap.astype(np.float32)
    high = np.minimum(CELLS - np.ceil(remaining / step).astype(np.int32), CELLS - 1)
    rows, columns = np.mgrid[:CELLS + 1, :CELLS + 1]
    indices = np.stack([columns, rows], axis=-1)
    source = np.zeros((CELLS + 1, CELLS + 1, 3), np.float32)
    source[..., :2] = indices.astype(np.float32) * step
    # Expanded dimensions round up; the viewport centre retains the unrounded scale.
    source[:, low[0], 0] = half_gap[0]
    source[:, high[0], 0] = np.float32(half_gap[0]) + size[0]
    source[low[1], :, 1] = half_gap[1]
    source[high[1], :, 1] = np.float32(half_gap[1]) + size[1]
    uv = (indices - low).astype(np.float32) / (high - low).astype(np.float32)
    first = (rows[:-1, :-1] * (CELLS + 1) + columns[:-1, :-1]).ravel()
    triangles = np.stack([first, first + CELLS + 1, first + CELLS + 2,
                          first, first + CELLS + 2, first + 1], axis=-1).reshape(-1, 3)
    return source, uv, triangles.astype(np.uint32), low, high


def circle_corners(*, width, height, x, y, radius):
    x, y, radius = float(np.float32(x)), float(np.float32(y)), float(np.float32(radius))
    horizontal = radius * min(width, height) / width
    vertical = radius * min(width, height) / height
    corners = np.asarray([[x + horizontal, y + vertical], [x + horizontal, y - vertical],
                          [x - horizontal, y + vertical], [x - horizontal, y - vertical]], np.float32)
    margin = np.float32((float(CANVAS_SCALE) - 1) * .5)
    return ((corners + margin) * np.asarray([width, height], np.float32)).astype(np.int32)


def ellipse(*, corners):
    first, second, _, fourth = corners.astype(np.float32)
    center = (first + fourth) * np.float32(.5)
    axes = [(second + fourth) * np.float32(.5), (first + second) * np.float32(.5)]
    radii = [np.sqrt(np.sum((point - center) ** 2, dtype=np.float32)) for point in axes]
    if radii[0] < radii[1]:
        axes.reverse()
        radii.reverse()
    return np.concatenate([axes[0], center, np.asarray(radii, np.float32)])


def radial_weight(*, radius, positive):
    t = np.clip(np.power(np.asarray(radius, np.float32), np.float32(1.8 if positive else 3)), 0, 1)
    return np.float32(1) - (t * t) * (np.float32(3) - (t + t))


def displacements(*, points, shape, positive):
    endpoint, center = shape[:2], shape[2:4]
    major, minor = shape[4:]
    delta, axis = points - center, endpoint - center
    distance = np.sqrt(np.sum(delta * delta, axis=-1, dtype=np.float32))
    with np.errstate(divide='ignore', invalid='ignore'):
        cosine = ((axis[0] * delta[..., 0] + axis[1] * delta[..., 1]) / major) / distance
        sine = ((axis[0] * delta[..., 1] - axis[1] * delta[..., 0]) / major) / distance
        inside = ((cosine * distance) / major) ** 2 + ((sine * distance) / minor) ** 2 <= 1
        effective_radius = np.sqrt((major * cosine) ** 2 + (minor * sine) ** 2)
        normalized = (distance.astype(np.float64) / effective_radius.astype(np.float64)).astype(np.float32)
    result = np.zeros_like(delta)
    weights = radial_weight(radius=normalized[inside], positive=positive)
    result[inside] = delta[inside] * weights[:, None]
    return result


def make_zoom_mesh(*, width, height, intensity, x, y, radius):
    source, uv, triangles, low, high = base_grid(width=width, height=height)
    shape = ellipse(corners=circle_corners(width=width, height=height, x=x, y=y, radius=radius))
    interior = (slice(low[1] + 1, high[1]), slice(low[0] + 1, high[0]))
    original = source[interior][..., :2]
    field = displacements(points=original, shape=shape, positive=intensity > 0)
    amount = np.float32(intensity / 100) * np.float32(.4 if intensity > 0 else .25)
    destination = source.copy()
    destination[interior][..., :2] = np.clip(original + field * amount,
                                          source[low[1], low[0], :2], source[high[1], high[0], :2])
    size = np.asarray([width, height], np.float32)
    positions = ((destination[..., :2] - size * CANVAS_SCALE * np.float32(.5)) / size) * np.float32(2)
    vertices = np.concatenate([positions, source[..., 2:3], uv], axis=-1).reshape(-1, 5)
    return vertices, triangles
