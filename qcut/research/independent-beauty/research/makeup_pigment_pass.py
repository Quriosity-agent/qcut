"""Build a pinned indexed pigment pass for the independent Metal host."""
import numpy as np

from makeup_layers import load_texture
from makeup_metal import premultiply_rgba8

MODES = {'normal': 0, 'multiply': 1, 'screen': 2, 'soft-light': 3}


def build_pass(*, positions, assets, layers, package, strength, name):
    matrix = assets['texture_transform']
    uv = (assets['uv'][:, :1]*matrix[:2, 0] + assets['uv'][:, 1:]*matrix[:2, 1]
          + matrix[:2, 3]).astype(np.float32)
    uv[:, 1] = np.float32(1)-uv[:, 1]
    vertices = np.zeros((len(positions), 8), np.float32)
    vertices[:, :2] = positions*assets['position_scale']
    vertices[:, 2:4] = uv
    vertices[:, 4] = 1
    textures = [premultiply_rgba8(rgba=load_texture(path=package/layer['path'],
        sha256=layer['sha256'], premultiply=False)) for layer in layers]
    result = {'name': name, 'vertices': vertices, 'triangles': assets['triangles'],
        'textures': textures, 'modes': [MODES[layer['mode']] for layer in layers],
        'pupil': False, 'cutoff': False, 'strength': float(strength)}
    if any(layer.get('customColor') for layer in layers):
        if len(layers) != 1 or name != 'Lip':
            raise ValueError('custom pigment color requires one lip texture')
        result['customColor'] = assets['custom_color'].tolist()
    return result
