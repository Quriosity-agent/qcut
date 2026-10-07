"""Owned crop camera and bounded SpotAcne texture composite transport."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from slimface_render import validate_rgba
from spot_acne_assets import load

SOURCE = Path(__file__).with_suffix('.swift')
F = np.float32


def camera(*, crop):
    inverse = np.asarray(crop['crop']['inverse'], dtype=F)
    width, height = crop['front']['algorithmSize']
    if (inverse.shape != (2, 3) or not np.isfinite(inverse).all()
            or min(width, height) <= 1):
        raise ValueError('finite original-derived SpotAcne crop camera required')
    matrix = np.eye(4, dtype=F)
    matrix[0, 0] = F(inverse[0, 0]*F(512)/F(width))
    matrix[0, 1] = -F(inverse[0, 1]*F(512)/F(width))
    matrix[1, 0] = -F(inverse[1, 0]*F(512)/F(height))
    matrix[1, 1] = F(inverse[1, 1]*F(512)/F(height))
    matrix[0, 3] = F(F(inverse[0, 0]*256+inverse[0, 1]*256+inverse[0, 2])/F(width)*2-1)
    matrix[1, 3] = F(1-F(inverse[1, 0]*256+inverse[1, 1]*256+inverse[1, 2])/F(height)*2)
    return matrix


def render(*, rgba, network, crop, intensity, runtime):
    validate_rgba(rgba=rgba)
    if (not np.isfinite(intensity) or not 0 < intensity <= 100
            or max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255)
            or not isinstance(network, np.ndarray) or network.dtype != F or network.shape != (512, 512, 4)
            or not np.isfinite(network).all() or np.any(np.abs(network) > 1)):
        raise ValueError('bounded opaque photo and owned SpotAcne network output required')
    _, _, mask, assets = load(runtime=runtime)
    matrix = camera(crop=crop)
    host, environment, source_sha = build_host(runtime=runtime, source=SOURCE, prefix='spot-acne-metal')
    host_sha = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='spot-acne-composite-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory/'source.rgba')
        network.astype('<f4').tofile(directory/'network.f32')
        mask.tofile(directory/'mask.rgba')
        (directory/'request.json').write_text(json.dumps(dict(width=rgba.shape[1], height=rgba.shape[0],
            mvp=matrix.T.reshape(-1).tolist(), intensity=float(F(intensity/100))), allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=60)
        data = (directory/'output.rgba').read_bytes()
        receipt = json.loads((directory/'gpu.json').read_text())
    if (len(data) != rgba.nbytes or receipt['private_native_images']
            or hashlib.sha256(host.read_bytes()).hexdigest() != host_sha
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_sha):
        raise ValueError('independent SpotAcne composite integrity failed')
    return np.frombuffer(data, np.uint8).reshape(rgba.shape).copy(), receipt | dict(
        sourceSha256=source_sha, hostSha256=host_sha, maskSha256=assets['maskSha256'],
        mvp=matrix.tolist(), intensityFloat32=float(F(intensity/100)))
