"""Independent 512 RGB half-network transport; no native outputs are accepted."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from makeup_metal import build_host
from spot_acne_assets import load

SOURCE = Path(__file__).with_suffix('.swift')
KERNELS = Path(__file__).with_name('gan_compute.metal')


def infer(*, crop, runtime):
    if (not isinstance(crop, np.ndarray) or crop.shape != (512,512,4) or crop.dtype != np.float32
            or not np.isfinite(crop).all() or np.any(np.abs(crop)>1)):
        raise ValueError('bounded original-derived 512 RGBA32Float crop required')
    spec, packed, _, assets = load(runtime=runtime)
    kernels = KERNELS.read_bytes()
    kernel_sha = hashlib.sha256(kernels).hexdigest()
    host, environment, source_sha = build_host(runtime=runtime, source=SOURCE, prefix='spot-acne-network')
    host_sha = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='spot-acne-network-') as temporary:
        directory = Path(temporary)
        for name, data in packed.items():
            (directory/name).write_bytes(data)
        crop.astype('<f4').tofile(directory/'crop.f32')
        (directory/'kernels.metal').write_bytes(kernels)
        (directory/'request.json').write_text(json.dumps({key:spec[key] for key in ('shapes','steps','weights')},allow_nan=False))
        subprocess.run([str(host),str(directory/'request.json')],env=environment,
            capture_output=True,text=True,check=True,timeout=90)
        data = (directory/'network.f32').read_bytes()
        receipt = json.loads((directory/'gpu.json').read_text())
    if (len(data)!=512*512*16 or receipt['private_native_images']
            or hashlib.sha256(host.read_bytes()).hexdigest()!=host_sha
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=source_sha
            or hashlib.sha256(KERNELS.read_bytes()).hexdigest()!=kernel_sha):
        raise ValueError('independent spot network integrity failure')
    result = np.frombuffer(data,'<f4').reshape(512,512,4).copy()
    if not np.isfinite(result).all() or np.any(np.abs(result)>1):
        raise ValueError('bounded network Tanh output required')
    return result, receipt | dict(assets=assets, sourceSha256=source_sha, hostSha256=host_sha,
        kernelSha256=kernel_sha, inputCropSha256=hashlib.sha256(crop.tobytes()).hexdigest(),
        outputFloat32Sha256=hashlib.sha256(data).hexdigest())
