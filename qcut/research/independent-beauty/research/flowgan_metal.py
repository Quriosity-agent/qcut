"""Bounded independent Metal FlowGAN transport and crop-camera construction."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from flowgan_assets import load
from makeup_metal import build_host
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')
F = np.float32


def camera(*, prediction):
    inverse = prediction['crop']['inverse']
    width, height = prediction['algorithmSize']
    if (inverse.shape != (2, 3) or inverse.dtype != np.float32
            or not np.isfinite(inverse).all() or min(width, height) <= 1):
        raise ValueError('finite owned NH crop required')
    # Normalize in double precision; rounding intermediate matrices shifts GPU samples.
    affine = inverse.astype(np.float64)*np.asarray([[320, 320, 1]], np.float64)
    affine = (affine/np.array([[width-.5], [height-.5]], np.float64)).astype(np.float32)
    mvp = np.eye(4, dtype=np.float32)
    mvp[0, 0] = F(inverse[0, 0]*F(320)/F(width))
    mvp[0, 1] = -F(inverse[0, 1]*F(320)/F(width))
    mvp[1, 0] = -F(inverse[1, 0]*F(320)/F(height))
    mvp[1, 1] = F(inverse[1, 1]*F(320)/F(height))
    mvp[0, 3] = F(F(inverse[0, 0]*160+inverse[0, 1]*160+inverse[0, 2])/F(width)*2-1)
    mvp[1, 3] = F(1-F(inverse[1, 0]*160+inverse[1, 1]*160+inverse[1, 2])/F(height)*2)
    return affine, mvp


def control_vector_values(*, intensity, control_vector=None):
    values = np.asarray([0, 0, F(intensity/100)] if control_vector is None else control_vector, dtype=F)
    if values.shape != (3,) or not np.isfinite(values).all() or np.any((values < 0) | (values > 1)):
        raise ValueError('three finite normalized FlowGAN controls required')
    return values


def render(*, rgba, prediction, intensity, runtime, control_vector=None, flow_enabled=True):
    validate_rgba(rgba=rgba)
    if (not np.isfinite(intensity) or not 0 < intensity <= 100
            or max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255)):
        raise ValueError('bounded active opaque FlowGAN photo required')
    vector = control_vector_values(intensity=intensity, control_vector=control_vector)
    if not isinstance(flow_enabled, bool):
        raise ValueError('boolean FlowGAN displacement switch required')
    spec, packed, mask = load(runtime=runtime)
    affine, mvp = camera(prediction=prediction)
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='flowgan-metal')
    binary_identity = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='flowgan-render-') as temporary:
        directory = Path(temporary)
        for name, data in packed.items():
            (directory/name).write_bytes(data)
        rgba.tofile(directory/'source.rgba')
        mask.tofile(directory/'mask.rgba')
        request = {key: spec[key] for key in ('shapes', 'steps', 'weights')}
        request.update(source='source.rgba', width=rgba.shape[1], height=rgba.shape[0],
            affine=affine.reshape(-1).tolist(), mvp=mvp.T.reshape(-1).tolist(),
            intensity=float(F(intensity/100)), maskWidth=320, maskHeight=320)
        if control_vector is not None:
            request['controlVector'] = vector.tolist()
        if not flow_enabled:
            request['flowEnabled'] = False
        (directory/'request.json').write_text(json.dumps(request, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=60)
        output = directory/'output.rgba'
        if output.stat().st_size != rgba.size:
            raise ValueError('FlowGAN output byte count mismatch')
        result = np.fromfile(output, np.uint8).reshape(rgba.shape)
        receipt = json.loads(Path(str(output)+'.json').read_text())
    if (receipt['private_native_images'] or hashlib.sha256(host.read_bytes()).hexdigest() != binary_identity
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != identity):
        raise ValueError('independent FlowGAN host integrity failed')
    return result, receipt | {'sourceSha256': identity, 'hostSha256': binary_identity,
        'modelSha256': spec['model']['sha256'], 'maskSha256': spec['mask']['sha256'],
        'controlVector': vector.tolist(), 'flowEnabled': flow_enabled}
