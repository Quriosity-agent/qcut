"""Packed two-coordinate texture transport for independent local face deformation."""
import math
from numbers import Real

import numpy as np

from liquefy_geometry import warp_coordinates
from mesh_field import interpolate_field
from mesh_texture import sample_texture
from m4_texture import linear_samples as m4_samples
from slimface_render import validate_rgba

F = np.float32
SIZE = 512


def encode_coordinates(*, coordinates):
    value = np.asarray(coordinates)
    if value.dtype != np.float32 or value.ndim < 1 or value.shape[-1] != 2 or not np.isfinite(value).all():
        raise ValueError("finite float32 coordinate pairs required")
    scaled = value * F(255)
    coarse = np.floor(scaled)
    packed = np.stack((coarse[..., 0] / F(255), scaled[..., 0] - coarse[..., 0],
                       coarse[..., 1] / F(255), scaled[..., 1] - coarse[..., 1]), axis=-1)
    return np.clip(np.rint(packed * F(255)), 0, 255).astype(np.uint8)


def decode_coordinates(*, texture):
    value = np.asarray(texture)
    if value.dtype != np.uint8 or value.ndim < 1 or value.shape[-1] != 4:
        raise ValueError("RGBA8 coordinate texture required")
    normalized = value.astype(np.float32) / F(255)
    return normalized[..., (0, 2)] + normalized[..., (1, 3)] / F(255)


def render_local(*, rgba, support, triangles, steps, intensity, mask=None, mask_uv=None, radial_profile="linear"):
    validate_rgba(rgba=rgba)
    if isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, Real) or not math.isfinite(intensity) or not 0 <= intensity <= 1.3:
        raise ValueError("bounded positive local intensity required")
    if intensity == 0:
        return rgba.copy(), {"identity": True}
    height, width = rgba.shape[:2]
    uv = support['uv']
    warped = warp_coordinates(coordinates=uv * np.array([width, height], np.float32), steps=steps, radial_profile=radial_profile)
    displacement = (warped / np.array([width, height], np.float32) - uv) * F(intensity)
    values = np.column_stack((uv + displacement, uv)) if mask is None else np.column_stack((uv + displacement, uv, mask_uv))
    field, covered = interpolate_field(positions=uv * F(SIZE), values=values,
                                       triangles=triangles, size=(SIZE, SIZE))
    if not covered.all():
        raise ValueError("local deformation support did not cover the coordinate texture")
    if mask is not None:
        validate_rgba(rgba=mask)
        coords = field[:, :, 4:].reshape(-1, 2).copy()
        sampled = m4_samples(rgba=mask, coordinates=coords * [mask.shape[1], mask.shape[0]])[:, 0]
        transported = ((F(1) - sampled.reshape(SIZE, SIZE, 1)) * field[:, :, 2:4]
                       + sampled.reshape(SIZE, SIZE, 1) * field[:, :, :2])
    else:
        transported = field[:, :, :2]
    # RGBA8 stores two 16-bit coordinates, including the neutral rounding residual.
    neutral = decode_coordinates(texture=encode_coordinates(coordinates=np.array([.5, .5], np.float32)))
    packed = encode_coordinates(coordinates=((neutral + transported) - field[:, :, 2:4]).astype(np.float32))
    y, x = np.mgrid[:height, :width]
    normalized = np.stack(((x + .5) / width, F(1) - (y + .5) / height), axis=-1).reshape(-1, 2)
    interpolated = sample_packed(texture=packed, coordinates=normalized.astype(np.float32))
    delta = interpolated - F(.5)
    delta = np.sign(delta) * np.maximum(np.abs(delta) - F(1 / 65536), F(0))
    source = normalized + delta
    source[:, 1] = 1 - source[:, 1]
    output = sample_texture(rgba=rgba, coordinates=source * [width, height]).reshape(rgba.shape)
    return output, {"identity": False, "coordinateTextureSize": SIZE,
                    "coveredCoordinatePixels": int(covered.sum()), "triangles": len(triangles)}


def sample_packed(*, texture, coordinates):
    if texture.shape != (SIZE, SIZE, 4) or texture.dtype != np.uint8:
        raise ValueError("512 by 512 RGBA8 coordinate texture required")
    coords = np.asarray(coordinates)
    if coords.dtype != np.float32 or coords.ndim != 2 or coords.shape[1] != 2 or not np.isfinite(coords).all():
        raise ValueError("finite float32 coordinate pairs required")
    grid = coords * F(SIZE) - F(.5)
    low = np.floor(grid).astype(np.int32)
    fractions = grid - low
    high = np.clip(low + 1, 0, SIZE - 1)
    low = np.clip(low, 0, SIZE - 1)
    x, y = fractions[:, 0:1], fractions[:, 1:2]
    decoded = decode_coordinates(texture=texture)
    return (((decoded[low[:, 1], low[:, 0]] * (1-x)) * (1-y)
             + (decoded[high[:, 1], low[:, 0]] * (1-x)) * y)
            + (decoded[low[:, 1], high[:, 0]] * x) * (1-y)
            + (decoded[high[:, 1], high[:, 0]] * x) * y).astype(np.float32)
