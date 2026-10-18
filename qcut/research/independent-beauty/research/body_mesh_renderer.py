"""Shared owned Metal raster for body warps and float algorithm-image sampling."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from render_resolution import gpu_request_fields, verify_gpu_resolution
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_name('body_mesh_metal.swift')


def draw_mesh(*, rgba, vertices, triangles, runtime, output_size=None, precision='half', flip_source=True,
              mesh_profile='body'):
    validate_rgba(rgba=rgba)
    height, width = rgba.shape[:2]
    output_size = (width, height) if output_size is None else output_size
    if (len(output_size) != 2 or any(type(v) is not int or not 1 <= v <= 4096 for v in output_size)
            or precision not in ('half', 'float') or type(flip_source) is not bool
            or mesh_profile not in ('body', 'manual-zoom')
            or (mesh_profile == 'manual-zoom' and precision != 'float')):
        raise ValueError('bounded output size and explicit sampling policy required')
    vertex_limit, triangle_limit = (63001, 125000) if mesh_profile == 'manual-zoom' else (4096, 4096)
    vertices = np.asarray(vertices, np.float32)
    triangles = np.asarray(triangles)
    if (vertices.ndim != 2 or vertices.shape[1] != 5 or not 3 <= len(vertices) <= vertex_limit
            or not np.isfinite(vertices).all() or np.abs(vertices).max() > 32768
            or triangles.ndim != 2 or triangles.shape[1] != 3 or not 1 <= len(triangles) <= triangle_limit
            or not np.issubdtype(triangles.dtype, np.integer)
            or triangles.min() < 0 or triangles.max() >= len(vertices)):
        raise ValueError('bounded finite indexed body mesh required')
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='body-mesh-metal')
    binary_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='body-mesh-') as temporary:
        directory = Path(temporary)
        np.ascontiguousarray(rgba[::-1] if flip_source else rgba).tofile(directory / 'input.rgba')
        np.ascontiguousarray(vertices).tofile(directory / 'vertices.f32')
        np.ascontiguousarray(triangles, np.uint32).tofile(directory / 'triangles.u32')
        request = {'width': output_size[0], 'height': output_size[1], 'sourceWidth': width,
                   'sourceHeight': height, 'sourcePrecision': precision, 'meshProfile': mesh_profile,
                   'rgba': str(directory / 'input.rgba'), 'vertices': str(directory / 'vertices.f32'),
                   'indices': str(directory / 'triangles.u32'), 'output': str(directory / 'output.rgba'),
                   **gpu_request_fields()}
        (directory / 'request.json').write_text(json.dumps(request, allow_nan=False))
        completed = subprocess.run([str(host), str(directory / 'request.json')], env=environment,
                                   capture_output=True, text=True, check=True, timeout=60)
        receipt = json.loads(completed.stdout)
        result = np.fromfile(directory / 'output.rgba', np.uint8).reshape(output_size[1], output_size[0], 4)
    verify_gpu_resolution(receipt=receipt, rgba=rgba)
    if receipt.get('privateNativeImages') or hashlib.sha256(host.read_bytes()).hexdigest() != binary_identity:
        raise ValueError('independent body mesh host integrity failed')
    return result, {**receipt, 'sourceSha256': identity, 'hostSha256': binary_identity}


def algorithm_image(*, rgba, runtime):
    from detection_geometry import algorithm_size
    size = algorithm_size(size=(rgba.shape[1], rgba.shape[0]))
    # Top-down source and quad keep the detector's raster orientation unchanged.
    vertices = np.asarray([[-1, 1, .5, 0, 0], [1, 1, .5, 1, 0],
                           [-1, -1, .5, 0, 1], [1, -1, .5, 1, 1]], np.float32)
    return draw_mesh(rgba=rgba, vertices=vertices, triangles=np.asarray([[0, 2, 1], [1, 2, 3]], np.uint32),
                     runtime=runtime, output_size=size, precision='float', flip_source=False)
