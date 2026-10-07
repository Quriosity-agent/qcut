"""Original photo to an independent 512-square crop; no spot/acne inference."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from flow_base import predict, receipt as front_receipt
from makeup_metal import build_host
from nh_assets import load_mean
from spot_acne_geometry import crop
from slimface_render import validate_rgba

SOURCE = Path(__file__).with_suffix('.swift')


def affine(*, prediction, inverse):
    width, height = prediction['algorithmSize']
    if inverse.dtype != np.float32 or inverse.shape != (2, 3) or not np.isfinite(inverse).all() or min(width, height) <= 1:
        raise ValueError('finite owned 512 crop required')
    return (inverse.astype(np.float64)*np.asarray([[512, 512, 1]], np.float64)
        /np.asarray([[width-.5], [height-.5]], np.float64)).astype(np.float32)


def run(*, rgba, runtime, output, phase='stabilized'):
    validate_rgba(rgba=rgba)
    if type(phase) is not str or phase not in ('seed', 'reset', 'stabilized'):
        raise ValueError('known crop phase required')
    if np.any(rgba[..., 3] != 255) or max(rgba.shape[:2]) > 1280 or output.exists():
        raise ValueError('bounded opaque original and fresh crop directory required')
    prediction = predict(rgba=rgba, model_root=runtime/'research', stabilized=phase in ('seed', 'stabilized'),
                         still_profile='spot-acne')
    points = prediction['warmPoints' if phase == 'seed' else 'points']
    geometry = crop(points=points, mean=load_mean(path=runtime/'research/nh-mean-v1.npy'))
    matrix = affine(prediction=prediction, inverse=geometry['inverse'])
    host, environment, source_sha = build_host(runtime=runtime, source=SOURCE, prefix='spot-acne-crop')
    host_sha = hashlib.sha256(host.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='spot-acne-crop-') as temporary:
        directory = Path(temporary)
        rgba.tofile(directory/'input.rgba')
        (directory/'request.json').write_text(json.dumps({'width': rgba.shape[1], 'height': rgba.shape[0],
            'affine': matrix.reshape(-1).tolist()}, allow_nan=False))
        subprocess.run([str(host), str(directory/'request.json')], env=environment,
            capture_output=True, text=True, check=True, timeout=60)
        pixels = (directory/'crop.f32').read_bytes()
        gpu = json.loads((directory/'gpu.json').read_text())
    values = np.frombuffer(pixels, '<f4').reshape(512, 512, 4)
    if (gpu['private_native_images'] or not np.isfinite(values).all()
            or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != source_sha
            or hashlib.sha256(host.read_bytes()).hexdigest() != host_sha):
        raise ValueError('independent crop integrity failure')
    output.mkdir(parents=True)
    (output/'crop.f32').write_bytes(pixels)
    preview = np.rint(np.clip((values*.5+.5)*255, 0, 255)).astype(np.uint8)
    Image.fromarray(preview).save(output/'crop.png')
    receipt = {'scope': 'original-photo-independent-spot-acne-crop-only',
        'cropPhase': phase,
        'nativeInputsUsed': False, 'nativeGeometryUsed': False, 'modelInferenceIncluded': False,
        'fullPhotoParityVerified': False, 'videoVerified': False,
        'crop': {key: value.tolist() for key, value in geometry.items()},
        'normalizedAffine': matrix.tolist(), 'front': front_receipt(prediction=prediction),
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'cropFloat32Sha256': hashlib.sha256(pixels).hexdigest(),
        'gpu': gpu | {'sourceSha256': source_sha, 'hostSha256': host_sha}}
    (output/'report.json').write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--phase', choices=('seed', 'reset', 'stabilized'), default='stabilized')
    args = parser.parse_args()
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], runtime=args.runtime, output=args.output, phase=args.phase)
