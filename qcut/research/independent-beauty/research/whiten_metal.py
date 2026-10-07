"""Bounded own Metal whitening host and process-integrity receipts."""
import ctypes as ct
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np

from makeup_metal import build_host
from makeup_blend import unit_scalar
from slimface_render import validate_rgba
from whiten_math import validate_lut

SOURCE = Path(__file__).with_suffix('.swift')


def process_images():
    if sys.platform != 'darwin':
        raise ValueError('loaded-image verification requires macOS')
    process = ct.CDLL(None)
    count = process._dyld_image_count
    count.restype = ct.c_uint32
    name = process._dyld_get_image_name
    name.argtypes, name.restype = [ct.c_uint32], ct.c_char_p
    images = [name(index).decode() for index in range(count())]
    forbidden = ('libcccreator', 'libbytenn', 'liblens', 'libAGFX', '/runtime/Frameworks/', '/JianyingPro.app/')
    private = [path for path in images if any(token in path for token in forbidden)]
    if private:
        raise ValueError('independent whitening process loaded private effect libraries')
    return {'loaded_images': images, 'private_native_images': private}


def render(*, rgba, lut, mask_texture, strength, runtime):
    validate_rgba(rgba=rgba)
    validate_lut(lut=lut)
    validate_rgba(rgba=mask_texture)
    strength = unit_scalar(value=strength, name='whitening strength')
    if max(rgba.shape[:2]) > 1280 or max(mask_texture.shape[:2]) > 512:
        raise ValueError('bounded whitening photo and skin texture required')
    if strength == 0:
        return rgba.copy(), {'private_native_images': [], 'zeroStrengthIdentity': True}
    host, environment, source_identity = build_host(runtime=runtime, source=SOURCE, prefix='whiten-metal')
    host_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='whiten-render-') as temporary:
        directory = Path(temporary)
        specifications = []
        for name, texture in (('source', rgba), ('lut', lut), ('mask', mask_texture)):
            path = directory / f'{name}.rgba'
            texture.tofile(path)
            specifications.append({'path': str(path), 'width': texture.shape[1], 'height': texture.shape[0]})
        output = directory / 'output.rgba'
        request = {'textures': specifications, 'strength': float(strength), 'output': str(output)}
        request_path = directory / 'request.json'
        request_path.write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(request_path)], env=environment,
                       capture_output=True, text=True, check=True, timeout=30)
        if output.stat().st_size != rgba.nbytes:
            raise ValueError('whitening Metal output byte count mismatch')
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output) + '.json').read_text())
    if receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != host_identity:
        raise ValueError('independent whitening Metal host integrity failed')
    return result, receipt | {'sourceSha256': source_identity, 'hostSha256': host_identity}
