"""Pupil pigment opacity, interpolated opening weight and eye cutoff in one blend."""
import numpy as np

from contacts_assets import SPEC
from makeup_blend import compose, unit_scalar
from makeup_layers import load_texture
from mesh_field import interpolate_field
from mesh_raster import rasterize
from slimface_render import validate_rgba

F = np.float32


def weights(*, positions, triangles, size):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 1 <= side <= 1280 for side in size)
            or not isinstance(positions, np.ndarray) or positions.dtype != np.float32
            or positions.shape != (78, 3) or not np.isfinite(positions).all()):
        raise ValueError('bounded pupil78 field and integer image dimensions required')
    width, height = size
    output = np.zeros((height, width, 1), F)
    for y in range(0, height, 512):
        for x in range(0, width, 512):
            tile = (min(512, width-x), min(512, height-y))
            field, _ = interpolate_field(positions=positions[:, :2]-np.array([x, y], F),
                values=positions[:, 2:], triangles=triangles, size=tile)
            output[y:y+tile[1], x:x+tile[0]] = field
    return output


def render(*, rgba, pupil, eyes, assets, package, strength):
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='pupil opacity')
    size = (rgba.shape[1], rgba.shape[0])
    if max(size) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('opaque pupil photo with maximum edge 1280 required')
    base = rgba.astype(F)/F(255)
    color = base
    diagnostics = []
    for relative, mode in (('image/pupil/pupil_normal.png', 'normal'), ('image/pupil/pupil_screen.png', 'screen')):
        texture = load_texture(path=package/relative, sha256=SPEC['files'][relative], premultiply=False)
        samples, details = rasterize(rgba=texture, positions=pupil[:, :2],
            uv=assets['uv']*np.array([texture.shape[1], texture.shape[0]], F),
            triangles=assets['triangles'], floating=True, size=size, premultiply=True)
        color = compose(base=color, pigment=(samples/F(255)).astype(F), strength=float(strength), mode=mode)
        diagnostics.append({'mode': mode, 'raster': details})
    transform, uv = assets['mask_transform'], assets['mask_uv']
    mask_uv = (uv[:, :1]*transform[:2, 0]+uv[:, 1:]*transform[:2, 1]+transform[:2, 3]).astype(F)
    mask_uv[:, 1] = F(1)-mask_uv[:, 1]
    relative = 'image/pupil/pupil_mask.png'
    texture = load_texture(path=package/relative, sha256=SPEC['files'][relative], premultiply=False)
    cutoff, details = rasterize(rgba=texture, positions=eyes,
        uv=mask_uv*np.array([texture.shape[1], texture.shape[0]], F),
        triangles=assets['mask_triangles'], floating=True, size=size)
    factor = weights(positions=pupil, triangles=assets['triangles'], size=size)*(cutoff[:, :, :1]/255).astype(F)
    output = np.rint(np.clip(base+(color-base)*factor, 0, 1)*255).astype(np.uint8)
    return output, {'layers': diagnostics, 'cutoff': details,
        'changedPixelCount': int(np.count_nonzero(np.any(output != rgba, axis=-1)))}
