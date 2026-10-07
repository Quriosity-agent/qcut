"""Place and blend the jawline shadow from fresh Extra240 landmarks."""
import numpy as np

from jawline_assets import PACKAGE, SPEC
from jawline_support import shadow_opacity
from lip_assets import load_assets
from makeup_geometry import original_pixels, working_mesh
from makeup_layers import load_texture
from makeup_metal import premultiply_rgba8

F = np.float32


def shadow_pass(*, prediction, size, yaw, pitch, strength, assets, runtime):
    points = original_pixels(points=np.asarray(prediction['points'], F),
        algorithm_size=prediction['algorithmSize'], image_size=size)
    positions = working_mesh(points=points, assets=load_assets(path=runtime/'research/lip-v1.npz'))
    matrix = assets['shadow_transform']
    uv = (assets['shadow_uv'][:, :1]*matrix[:2, 0]+assets['shadow_uv'][:, 1:]*matrix[:2, 1]+matrix[:2, 3]).astype(F)
    uv[:, 1] = F(1)-uv[:, 1]
    vertices = np.zeros((248, 8), F)
    vertices[:, :2], vertices[:, 2:4], vertices[:, 4] = positions, uv, F(1)
    texture = load_texture(path=runtime/'Cache/effect'/PACKAGE/SPEC['texture'],
        sha256=SPEC['files'][SPEC['texture']], premultiply=False)
    opacity = shadow_opacity(extra=prediction['points'], yaw=yaw, pitch=pitch, strength=strength)
    return {'name': 'Stereo', 'vertices': vertices, 'triangles': assets['shadow_triangles'],
        'textures': [premultiply_rgba8(rgba=texture)], 'modes': [3], 'pupil': False,
        'cutoff': False, 'strength': opacity}
