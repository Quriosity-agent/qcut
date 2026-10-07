"""Own bounded RGBA8 Metal layer host, compiled from the adjacent public source."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')


def premultiply_rgba8(*, rgba):
    validate_rgba(rgba=rgba)
    result = rgba.copy()
    # Integer PNG decode rounds through the 256-level alpha representation.
    result[..., :3] = ((rgba[..., :3].astype(np.uint16)*(rgba[..., 3:4].astype(np.uint16)+1)) >> 8).astype(np.uint8)
    return result


def build_host(*, runtime, source=SOURCE, prefix='makeup-metal'):
    identity = hashlib.sha256(source.read_bytes()).hexdigest()
    output = runtime/'research'/f'{prefix}-{identity}'
    output.parent.mkdir(exist_ok=True, parents=True)
    environment = {key: value for key, value in os.environ.items() if not key.startswith('DYLD_')}
    if not output.exists():
        with tempfile.TemporaryDirectory(prefix='makeup-build-', dir=output.parent) as directory:
            temporary = Path(directory)/'host'
            subprocess.run(['xcrun', 'swiftc', '-O', str(source), '-o', str(temporary)],
                env=environment, capture_output=True, text=True, check=True, timeout=60)
            if hashlib.sha256(source.read_bytes()).hexdigest() != identity:
                raise ValueError('Metal source changed during compilation')
            os.replace(temporary, output)
    return output, environment, identity


def render(*, rgba, passes, runtime):
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque Metal photo required')
    host, environment, identity = build_host(runtime=runtime)
    binary_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='makeup-render-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory/'input.rgba')
        specification = []
        for index, entry in enumerate(passes):
            vertices, triangles = entry['vertices'], entry['triangles']
            if (vertices.dtype != np.float32 or vertices.ndim != 2 or vertices.shape[1] != 8
                    or not np.isfinite(vertices).all() or np.abs(vertices).max(initial=0) > 32768
                    or triangles.dtype != np.uint16 or triangles.ndim != 2 or triangles.shape[1] != 3
                    or triangles.max(initial=0) >= len(vertices)):
                raise ValueError('bounded indexed Metal pigment mesh required')
            vp, ip = directory/f'{index}.vertices', directory/f'{index}.indices'
            vertices.tofile(vp)
            triangles.tofile(ip)
            textures = []
            for texture_index, texture in enumerate(entry['textures']):
                validate_rgba(rgba=texture)
                tp = directory/f'{index}-{texture_index}.rgba'
                texture.tofile(tp)
                textures.append({'path': str(tp), 'width': texture.shape[1], 'height': texture.shape[0]})
            specification.append({key: entry[key] for key in ('name', 'modes', 'pupil', 'cutoff', 'strength')} | {
                'vertices': str(vp), 'indices': str(ip), 'vertexCount': len(vertices),
                'indexCount': triangles.size, 'textures': textures})
        output = directory/'output.rgba'
        request = {'width': rgba.shape[1], 'height': rgba.shape[0], 'input': str(directory/'input.rgba'),
            'output': str(output), 'passes': specification}
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=30)
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
    if receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != binary_identity:
        raise ValueError('independent Metal host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': binary_identity}
