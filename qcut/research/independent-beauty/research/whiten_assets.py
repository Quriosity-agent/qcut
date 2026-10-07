"""Validate the locally installed private LUT; publish only its identity."""
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image

PACKAGE = '7408028287785602319/8615dc8c263df7e22740b76b0ac497f8'
LUT_PATH = 'AmazingFeature_3/image/filter.png'
PACKAGE_HASHES = {
    'config.json': '59b54c37cd1f5fa40fcec3143b46e18da5021050f74e01f8177a2bc3b1ef304b',
    'algorithmConfig.json': '4b50cc04d1090e9a7e83b2dcded015955e230a16ea94a3111302ade863864c24',
    'AmazingFeature_3/algorithmConfig.json': '70d9601464e31804c74424d8e32e221dc17df7b36851bf9c1aa252fde0fadf9d',
    'AmazingFeature_3/content.json': '43645f7d06d1897e7e98f85f430339b3b95495dc89a69c3bd3eb03f890d935d2',
    'AmazingFeature_3/lua/ModeScript.lua': 'b64ab5606477bf8ff35d17fb8d36d7a1686db6a957e040cf9e54e42dc0cd7d7c',
    'AmazingFeature_3/material/filter.material': 'ddef1be007b9efb5ed71c38687acb2d296df7c20bbaa2256620d2a00b20111d3',
    'AmazingFeature_3/main.scene': 'c0286536a898567d62e10cbe719aca70020c7a2226b3dcc39a0764a0119f7e52',
    'AmazingFeature_3/mesh/Quad.mesh': '6f67b10e9e7738ca70e5fb49e26ebd76d98e9b4673bd61fa5209b119c63fdb48',
    LUT_PATH: '289889aaa35ca6507b98dad44d0939ce97ac18f640864e09bfe494ad4d72a02e',
    'AmazingFeature_3/image/filter.png.meta': '3c1b72ac41af470c642795e8ee63b5b66a9a99bb2bb4b11e4809cde0945343e2',
    'AmazingFeature_3/rt/outputTex.rt': '7b75a61e32e73854184c732f246f3d87c113a5fd4488b4a000f14db54c5137da',
    'AmazingFeature_3/xshader/filtter.xshader': '80f40d51adec4c540b796a4871c43a05cef617e41325f43c54db4fc4695896e8',
    'AmazingFeature_3/shaders/filtter-0-ec4f/metal/a43a.vert': '0a9ffa64a963a6b2a998a86c9f25ebcb9262ff2366e4d15ccdc0ba3cbade8a6a',
    'AmazingFeature_3/shaders/filtter-0-ec4f/metal/a43a.frag': 'e228bdda76f34af2e48fcd755ee1baee75b1169a4b6b7fef60f6c1e79ebc74e0',
}


def package_identity(*, runtime):
    package = Path(runtime) / 'Cache/effect' / PACKAGE
    identity = {}
    for relative, expected in PACKAGE_HASHES.items():
        path = package / relative
        if path.stat().st_size > 4 * 1024**2:
            raise ValueError('bounded private whitening package required')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected:
            raise ValueError(f'private whitening asset identity mismatch: {relative}')
        identity[str(path.relative_to(runtime))] = digest
    return identity


def load_lut(*, runtime):
    identity = package_identity(runtime=runtime)
    with Image.open(Path(runtime) / 'Cache/effect' / PACKAGE / LUT_PATH) as image:
        if image.format != 'PNG' or image.size != (512, 512):
            raise ValueError('512-square private whitening LUT required')
        lut = np.array(image.convert('RGBA'))
    if np.any(lut[..., 3] != 255):
        raise ValueError('opaque whitening LUT required')
    lut.setflags(write=False)
    return lut, {'package': PACKAGE, 'files': identity,
                 'lutRgbaSha256': hashlib.sha256(lut.tobytes()).hexdigest()}
