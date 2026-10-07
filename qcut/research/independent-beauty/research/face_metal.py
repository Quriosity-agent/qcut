"""Bounded two-pass small-face GPU transport using only the system Metal library."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')
PASS_SHAPES = (('LinkedOrgans', 315, 597), ('LocalWarp', 2270, 4472))


def render(*, rgba, passes, runtime, profile='small-face'):
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque face photo required')
    if profile not in ('small-face', 'jawline', 'features'):
        raise ValueError('pinned independent face profile required')
    shapes = {'small-face': PASS_SHAPES, 'jawline': (('Jawline', 5625, 11248),),
              'features': (PASS_SHAPES[0],)}[profile]
    if not isinstance(passes, (list, tuple)) or len(passes) != len(shapes):
        raise ValueError('ordered face passes required')
    for entry, (name, count, triangle_count) in zip(passes, shapes):
        if not isinstance(entry, dict) or set(entry) != {'name', 'vertices', 'triangles'} or entry['name'] != name:
            raise ValueError('explicit ordered face passes required')
        vertices, triangles = entry['vertices'], entry['triangles']
        if (not isinstance(vertices, np.ndarray) or vertices.dtype != np.float32 or vertices.shape != (count, 5)
                or not np.isfinite(vertices).all() or np.abs(vertices).max() > 32768
                or not isinstance(triangles, np.ndarray) or triangles.dtype != np.uint16
                or triangles.shape != (triangle_count, 3) or triangles.max() >= count):
            raise ValueError('bounded indexed face mesh required')
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='face-metal')
    binary_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='face-render-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory/'input.rgba')
        specification = []
        for index, entry in enumerate(passes):
            vertices, triangles = entry['vertices'], entry['triangles']
            vp, ip = directory/f'{index}.vertices', directory/f'{index}.indices'
            vertices.tofile(vp)
            triangles.tofile(ip)
            specification.append({'name': entry['name'], 'vertices': str(vp), 'indices': str(ip),
                                  'vertexCount': len(vertices), 'indexCount': triangles.size})
        output = directory/'output.rgba'
        request = {'width': rgba.shape[1], 'height': rgba.shape[0], 'input': str(directory/'input.rgba'),
                   'output': str(output), 'passes': specification}
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
                       capture_output=True, text=True, check=True, timeout=30)
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != binary_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != identity):
        raise ValueError('independent face Metal host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': binary_identity,
                              'profile': profile}
