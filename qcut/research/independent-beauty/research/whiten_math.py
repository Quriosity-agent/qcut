"""Independent float32 evaluation of a tiled 64-cube color map."""
import numpy as np

from makeup_blend import unit_scalar
from slimface_render import validate_rgba

F = np.float32


def validate_lut(*, lut):
    validate_rgba(rgba=lut)
    if lut.shape != (512, 512, 4) or np.any(lut[..., 3] != 255):
        raise ValueError('opaque 512-square 64-cube LUT required')


def sample_linear(*, texture, uv):
    validate_rgba(rgba=texture)
    if (not isinstance(uv, np.ndarray) or uv.dtype != np.float32 or uv.ndim < 2
            or uv.shape[-1] != 2 or uv.size > 8 * 1024**2 or not np.isfinite(uv).all()):
        raise ValueError('bounded float32 texture coordinates required')
    height, width = texture.shape[:2]
    pixel = uv * np.array([width, height], np.float32) - F(.5)
    pixel = np.clip(pixel, F(0), np.array([width - 1, height - 1], np.float32))
    lower = np.floor(pixel).astype(np.intp)
    upper = np.minimum(lower + 1, [width - 1, height - 1])
    fraction = pixel - lower.astype(np.float32)
    x, y = lower[..., 0], lower[..., 1]
    xx, yy = upper[..., 0], upper[..., 1]
    fx, fy = fraction[..., :1], fraction[..., 1:]
    pixels = texture.astype(np.float32) / F(255)
    top = pixels[y, x] * (F(1) - fx) + pixels[y, xx] * fx
    bottom = pixels[yy, x] * (F(1) - fx) + pixels[yy, xx] * fx
    return top * (F(1) - fy) + bottom * fy


def map_rgb(*, rgb, lut):
    validate_lut(lut=lut)
    if (not isinstance(rgb, np.ndarray) or rgb.dtype != np.float32 or rgb.ndim < 2
            or rgb.shape[-1] != 3 or rgb.size > 12 * 1024**2 or not np.isfinite(rgb).all()
            or np.any(rgb < 0) or np.any(rgb > 1)):
        raise ValueError('bounded unit float32 RGB required')
    blue = rgb[..., 2] * F(63)
    lower, upper = np.floor(blue), np.ceil(blue)

    def coordinates(slice_index):
        tile_y = np.floor(slice_index / F(8))
        tile_x = slice_index - tile_y * F(8)
        tiles = np.stack([tile_x, tile_y], axis=-1)
        return tiles / F(8) + F(1 / 1024) + rgb[..., :2] * F(63 / 512)

    first = sample_linear(texture=lut, uv=coordinates(lower))[..., :3]
    second = sample_linear(texture=lut, uv=coordinates(upper))[..., :3]
    fraction = (blue - lower)[..., None]
    return first * (F(1) - fraction) + second * fraction


def compose(*, rgba, lut, mask_alpha, strength):
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='whitening strength')
    if (not isinstance(mask_alpha, np.ndarray) or mask_alpha.dtype != np.float32
            or mask_alpha.shape != rgba.shape[:2] or not np.isfinite(mask_alpha).all()
            or np.any(mask_alpha < 0) or np.any(mask_alpha > 1)):
        raise ValueError('matching unit float32 skin alpha required')
    validate_lut(lut=lut)
    if strength == 0:
        return rgba.copy()
    source = rgba[..., :3].astype(np.float32) / F(255)
    mapped = map_rgb(rgb=source, lut=lut)
    filtered = source * (F(1) - strength) + mapped * strength
    alpha = mask_alpha[..., None]
    result = rgba.copy()
    result[..., :3] = np.clip(np.rint((source * (F(1) - alpha) + filtered * alpha) * F(255)), 0, 255).astype(np.uint8)
    return result
