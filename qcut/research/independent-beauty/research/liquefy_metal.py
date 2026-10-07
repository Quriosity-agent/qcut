"""Independent system-Metal transport for a bounded packed local displacement mesh."""
import hashlib
import json
from pathlib import Path
from numbers import Real
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from liquefy_geometry import finite_array, validate_steps
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')
PASS_FIELDS = {'support', 'triangles', 'steps', 'intensity', 'radial_profile', 'mask_uv', 'mask'}


def validate_pass(*, support, triangles, steps, intensity, radial_profile, mask_uv, mask):
    count = validate_steps(steps=steps, radial_profile=radial_profile)
    if (isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, Real)
            or not np.isfinite(intensity) or not 0 < intensity <= 1.3):
        raise ValueError('bounded positive local Metal intensity required')
    if not isinstance(support, dict) or set(support) != {'positions', 'uv'}:
        raise ValueError('explicit local Metal support required')
    positions = finite_array(value=support['positions'], shape=(2270, 3), name='local positions')
    uv = finite_array(value=support['uv'], shape=(2270, 2), name='local UV')
    mask_uv = finite_array(value=mask_uv, shape=(2270, 2), name='local mask UV')
    vertices = np.column_stack((positions[:, :2], uv, mask_uv))
    if (vertices.dtype != np.float32 or vertices.shape != (2270, 6)
            or not np.isfinite(vertices).all() or np.abs(vertices).max() > 32768
            or triangles.dtype != np.uint16 or triangles.shape != (4472, 3)
            or triangles.max() >= 2270):
        raise ValueError('bounded 2270-vertex local Metal support required')
    validate_rgba(rgba=mask)
    if max(mask.shape[:2]) > 1024:
        raise ValueError('bounded local Metal mask required')
    step_values = np.column_stack((steps['start'], steps['end'], steps['action'], steps['strength'], steps['radius']))
    return {'vertices': vertices, 'indices': triangles, 'steps': step_values, 'mask': mask,
            'stepCount': count, 'intensity': float(intensity), 'quadratic': radial_profile == 'quadratic'}


def render(*, rgba, support, triangles, steps, intensity, radial_profile, mask_uv, mask, runtime):
    return render_passes(rgba=rgba, passes=[{'support': support, 'triangles': triangles, 'steps': steps,
        'intensity': intensity, 'radial_profile': radial_profile, 'mask_uv': mask_uv, 'mask': mask}], runtime=runtime)


def render_passes(*, rgba, passes, runtime):
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280:
        raise ValueError('bounded local Metal image required')
    if not isinstance(passes, list) or not 1 <= len(passes) <= 6:
        raise ValueError('one to six ordered local Metal passes required')
    if any(not isinstance(specification, dict) or set(specification) != PASS_FIELDS for specification in passes):
        raise ValueError('explicit local Metal pass fields required')
    prepared = [validate_pass(**specification) for specification in passes]
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='liquefy-metal')
    binary_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='liquefy-render-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory / 'input.rgba')
        requests = []
        for index, specification in enumerate(prepared):
            request = {key: specification[key] for key in ('stepCount', 'intensity', 'quadratic')}
            for name in ('mask', 'vertices', 'indices', 'steps'):
                path = directory / f'{index}-{name}'
                specification[name].tofile(path)
                request[name] = str(path)
            request.update(maskWidth=specification['mask'].shape[1], maskHeight=specification['mask'].shape[0])
            requests.append(request)
        output = directory/'output.rgba'
        request = {'width': rgba.shape[1], 'height': rgba.shape[0],
            'input': str(directory/'input.rgba'), 'passes': requests, 'output': str(output)}
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=30)
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != binary_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != identity):
        raise ValueError('independent local Metal host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': binary_identity}
