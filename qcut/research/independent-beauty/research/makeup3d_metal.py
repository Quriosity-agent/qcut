"""Own system-Metal transport for a single fitted classical makeup mesh."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')


def render(*, rgba, mesh, pigment, intensity, highlight, runtime):
    validate_rgba(rgba=rgba)
    validate_rgba(rgba=pigment)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque classical makeup photo required')
    if type(highlight) is not bool or not 0 <= intensity <= 100:
        raise ValueError('bounded classical makeup parameters required')
    shapes = {'vertices': ((1463, 8), np.float32), 'triangles': ((2376, 3), np.uint16),
              'model': ((4, 4), np.float32), 'mvp': ((4, 4), np.float32)}
    if not isinstance(mesh, dict) or set(mesh) != set(shapes):
        raise ValueError('complete owned mesh and camera required')
    for key, (shape, dtype) in shapes.items():
        value = mesh[key]
        if value.shape != shape or value.dtype != dtype or not np.isfinite(value).all():
            raise ValueError('typed classical makeup mesh required')
    host, environment, source_identity = build_host(runtime=runtime, source=SOURCE, prefix='makeup3d-metal')
    host_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    uniforms = np.r_[mesh['mvp'].T.reshape(-1), mesh['model'].T.reshape(-1),
        [1, .8666667, .7529412, 1], [0, 0, -1, 0], [1, 0, intensity/100, int(highlight)]].astype(np.float32)
    with tempfile.TemporaryDirectory(prefix='makeup3d-render-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory/'input.rgba')
        mesh['vertices'].tofile(directory/'vertices')
        mesh['triangles'].tofile(directory/'indices')
        pigment.tofile(directory/'pigment')
        uniforms.tofile(directory/'uniforms')
        output = directory/'output.rgba'
        request = {'width': rgba.shape[1], 'height': rgba.shape[0], 'output': str(output),
            'input': str(directory/'input.rgba'), 'vertices': str(directory/'vertices'),
            'indices': str(directory/'indices'), 'uniforms': str(directory/'uniforms'),
            'pigment': {'path': str(directory/'pigment'), 'width': pigment.shape[1], 'height': pigment.shape[0]}}
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
                       capture_output=True, text=True, check=True, timeout=30)
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != host_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_identity):
        raise ValueError('independent classical makeup host integrity failed')
    return result, receipt | {'sourceSha256': source_identity, 'hostSha256': host_identity}
