"""Resolve identity-pinned local smoothing pigment assets without redistributing them."""
import hashlib
from pathlib import Path
import struct

import numpy as np

from makeup_layers import load_texture
from makeup_metal import premultiply_rgba8
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

PACKAGE = '7408077820116667700/b000f31572be3e5f9fd195d7bba37968'
TEXTURES = {
    'face': ('AmazingFeature/image/faceMask.png', '129c26e3327133493900780c01a22732294f8963849d700d05440a749fa3fb2b'),
    'cube': ('AmazingFeature/image/brighten.png', '5f65dafab75103b6c0adbc1f433cacce0eb02915e779c5edb5278f4f2f479016'),
}
MESH_SHA256 = '7307103c77869f302bbd0fbdf65b1e5109c6275b960388c487a90500f2dbab03'


def load_assets(*, runtime):
    runtime = Path(runtime).resolve()
    package = runtime/'Cache/effect'/PACKAGE
    textures = {key: premultiply_rgba8(rgba=load_texture(path=package/name, sha256=identity, premultiply=False))
        for key, (name, identity) in TEXTURES.items()}
    if textures['face'].shape != (256, 256, 4) or textures['cube'].shape != (512, 512, 4):
        raise ValueError('pinned smoothing texture cardinality mismatch')
    data = (package/'AmazingFeature/mesh/Face145_mesh.mesh').read_bytes()
    if hashlib.sha256(data).hexdigest() != MESH_SHA256:
        raise ValueError('pinned smoothing mesh identity required')
    vertex_tag = bytes.fromhex('6e587acf18000000')+struct.pack('<I', 4350)
    index_tag = bytes.fromhex('5f2c286b16000000')+struct.pack('<I', 4608)
    if data.count(vertex_tag) != 1 or data.count(index_tag) != 1:
        raise ValueError('six-slot smoothing mesh required')
    vertices = np.frombuffer(data, '<f4', count=4350, offset=data.index(vertex_tag)+12).reshape(6, 145, 5)
    indices = np.frombuffer(data, '<u2', count=4608, offset=data.index(index_tag)+12).reshape(6, 256, 3)
    if (not np.isfinite(vertices).all() or not all(np.array_equal(slot[:, 3:], vertices[0, :, 3:]) for slot in vertices)
            or not all(np.array_equal(slot, indices[0]+index*145) for index, slot in enumerate(indices))
            or indices[0].max() >= 145):
        raise ValueError('equivalent bounded smoothing face slots required')
    core = (runtime/'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError('pinned local smoothing geometry library required')
    forehead = np.frombuffer(address_bytes(image=arm64_image(data=core), address=0x2cbec24, size=88), '<f4').reshape(11, 2).copy()
    if not np.isfinite(forehead).all() or np.abs(forehead).max() > 4:
        raise ValueError('bounded smoothing forehead coefficients required')
    return textures | {'uv': vertices[0, :, 3:].copy(), 'indices': indices[0].copy(), 'forehead': forehead,
                       'identities': {'meshSha256': MESH_SHA256, 'coreSha256': CORE_SHA256,
                                      'textures': {key: value[1] for key, value in TEXTURES.items()}}}
