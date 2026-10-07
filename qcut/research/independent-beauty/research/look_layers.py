"""Build the pinned oxygen makeup passes from independently inferred photo landmarks."""
import hashlib

import numpy as np

from contacts_geometry import pupil_mesh
from eye_support import eye_mesh
from lashes_geometry import lash_mesh, load_template
from lip_assets import load_assets as load_geometry
from look_assets import SPEC, load_assets
from makeup_geometry import original_pixels, working_mesh
from makeup_layers import load_texture
from makeup_metal import premultiply_rgba8
from mouth_state import mouth_texture

F = np.float32
MODES = {'normal': 0, 'multiply': 1, 'screen': 2, 'soft-light': 3}


def geometry(*, prediction, size, runtime):
    points = original_pixels(points=np.asarray(prediction['extraAlgorithmPoints'], F),
        algorithm_size=prediction['algorithmSize'], image_size=size)
    pupil = np.vstack([np.asarray(eye['points'], F) for eye in prediction['passes'][0]['eyes']])
    face = working_mesh(points=points, assets=load_geometry(path=runtime/'research/lip-v1.npz'))
    eyes = eye_mesh(points=points)
    lashes = lash_mesh(points=points, template=load_template(path=runtime/'research/lashes-template-v1.npy'))
    return {'Brow': face, 'Eyeshadow': eyes, 'Eyeline': eyes, 'Eyemazing': eyes,
        'Eyelash': lashes, 'Cutoff': eyes, 'Pupil': pupil_mesh(extra=points, pupil=pupil),
        'Stereo': face, 'Blusher': face, 'Lip': face}


def build_passes(*, prediction, size, strength, runtime):
    positions = geometry(prediction=prediction, size=size, runtime=runtime)
    selection = mouth_texture(positions=positions['Lip'])
    assets = load_assets(path=runtime/'research/look-oxygen-v1.npz')
    package = runtime/'Cache/effect'/SPEC['package']/'AmazingFeature'
    passes = []
    for layer in SPEC['layers']:
        name = layer['name']
        pupil, cutoff = name == 'Pupil', name == 'Cutoff'
        uv = assets[name+'_uv'].copy()
        if not pupil:
            matrix = assets[name+'_transform']
            uv = (uv[:, :1]*matrix[:2, 0]+uv[:, 1:]*matrix[:2, 1]+matrix[:2, 3]).astype(F)
            uv[:, 1] = F(1)-uv[:, 1]
        vertices = np.zeros((layer['vertices'], 8), F)
        vertices[:, :2] = positions[name][:, :2]
        if name == 'Lip':
            vertices[:, :2] *= np.array([1, 1.002], F)
        vertices[:, 2:4] = uv
        vertices[:, 4] = positions[name][:, 2] if pupil else F(1)
        textures = []
        for pigment in layer['textures']:
            relative = pigment['path']
            decoded_sha = pigment['decodedSha256']
            if name == 'Lip' and relative.endswith('lipClose.png') and selection['open']:
                relative = 'image/lip/lipOpen.png'
                decoded_sha = '20fc3aa0503d6ec0d47dfab6b74ada630794efe1beca6b6535b54fa84c9b7e6a'
            texture = load_texture(path=package/relative,
                sha256=SPEC['files']['AmazingFeature/'+relative], premultiply=False)
            if not cutoff:
                texture = premultiply_rgba8(rgba=texture)
            if hashlib.sha256(texture.tobytes()).hexdigest() != decoded_sha:
                raise ValueError('independent oxygen PNG decode identity mismatch')
            textures.append(texture)
        passes.append({'name': name, 'vertices': vertices, 'triangles': assets[name+'_triangles'],
            'textures': textures, 'modes': [MODES[pigment['mode']] for pigment in layer['textures']],
            'pupil': pupil, 'cutoff': cutoff, 'strength': float(strength)})
        if name == 'Lip':
            passes[-1]['mouthSelection'] = selection
    return passes
