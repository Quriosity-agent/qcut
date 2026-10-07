"""Transport owned smoothing meshes and textures into the public Metal graph."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_blend import unit_scalar
from makeup_metal import build_host
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')


def validate_mesh(*, mesh):
    if mesh is None:
        return
    if type(mesh) is not dict or set(mesh) != {'vertices', 'indices'}:
        raise ValueError('explicit face smoothing mesh required')
    vertices, indices = mesh['vertices'], mesh['indices']
    if (not isinstance(vertices, np.ndarray) or vertices.dtype != np.float32 or vertices.shape != (145, 4)
            or not np.isfinite(vertices).all() or np.any(np.abs(vertices) > 32768)
            or not isinstance(indices, np.ndarray) or indices.dtype != np.uint16 or indices.shape != (256, 3)
            or indices.max(initial=0) >= 145):
        raise ValueError('bounded FACE145 vertices and 768 indices required')


def render(*, rgba, skin, face, cube, strength, runtime, mesh=None, retain_stages=False):
    strength = unit_scalar(value=strength, name='smoothing strength')
    for value in (rgba, skin, face, cube):
        validate_rgba(rgba=value)
    if (max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255)
            or max(skin.shape[:2]) > 512 or face.shape != (256, 256, 4)
            or cube.shape != (512, 512, 4) or type(retain_stages) is not bool):
        raise ValueError('bounded opaque source and pinned smoothing texture sizes required')
    validate_mesh(mesh=mesh)
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='smooth-metal')
    host_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='smooth-render-') as temporary:
        directory = Path(temporary)
        def specification(*, name, values):
            path = directory/f'{name}.rgba'
            values.tofile(path)
            return {'path': str(path), 'width': values.shape[1], 'height': values.shape[0]}
        request = {key: specification(name=key, values=values)
            for key, values in (('source', rgba), ('skin', skin), ('face', face), ('cube', cube))}
        request['mesh'] = None
        if mesh is not None:
            request['mesh'] = {}
            for name in ('vertices', 'indices'):
                path = directory/name
                mesh[name].tofile(path)
                request['mesh'][name] = str(path)
        output = directory/'output.rgba'
        request.update(strength=float(strength), output=str(output), stages=retain_stages)
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False)+'\n')
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=60)
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
        stages = {}
        if retain_stages:
            for path in directory.glob('output.rgba.*.rgba'):
                name = path.name.removeprefix('output.rgba.').removesuffix('.rgba')
                size = (rgba.shape[1], rgba.shape[0]) if 'correctionPixel' in name or 'outputPixel' in name else receipt['reducedSize']
                stages[name] = np.fromfile(path, np.uint8).reshape(size[1], size[0], 4)
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != host_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != identity):
        raise ValueError('independent smoothing host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': host_identity}, stages
