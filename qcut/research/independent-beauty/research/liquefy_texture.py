"""Packed two-coordinate texture transport for independent local face deformation."""
import math
from numbers import Real
from pathlib import Path

import numpy as np

from liquefy_metal import render as render_metal
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


def render_local(*, rgba, support, triangles, steps, intensity, mask=None, mask_uv=None, radial_profile="linear", runtime=None):
    validate_rgba(rgba=rgba)
    if isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, Real) or not math.isfinite(intensity) or not 0 <= intensity <= 1.3:
        raise ValueError("bounded positive local intensity required")
    if intensity == 0:
        return rgba.copy(), {"identity": True}
    output, receipt = render_metal(rgba=rgba, support=support, triangles=triangles,
        steps=steps, intensity=float(intensity), radial_profile=radial_profile,
        mask=np.full((1, 1, 4), 255, np.uint8) if mask is None else mask,
        mask_uv=support['uv'] if mask is None else mask_uv,
        runtime=runtime or Path(__file__).resolve().parents[1]/'runtime')
    return output, {"identity": False, "coordinateTextureSize": SIZE,
                    "coveredCoordinatePixels": receipt['coveredCoordinatePixels'],
                    "triangles": len(triangles), "metal": receipt}


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
