"""Independent face then local package lifecycle for the 24 supported geometry controls."""
import argparse
from collections.abc import Mapping
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import face_features_render
from face_features_controls import BY_NAME, controls_active, normalize_controls
from facefitting_image import decode_image
from facefitting_infer import native_images
import liquefy_combination_render
from liquefy_assets import CONTROLS as LOCAL_CONTROLS
from liquefy_render import active_controls, validate_controls
from slimface_render import validate_rgba

ROOT = Path(__file__).resolve().parents[1]


def split_controls(*, values):
    if (not isinstance(values, Mapping) or any(not isinstance(name, str) for name in values)
            or set(values) - (set(BY_NAME) | set(LOCAL_CONTROLS))):
        raise ValueError('a mapping of the 24 supported geometry controls is required')
    common = normalize_controls(values={key: value for key, value in values.items() if key in BY_NAME})
    local = validate_controls(values={key: value for key, value in values.items() if key in LOCAL_CONTROLS})
    return common, local


def render_rgba(*, rgba, controls, runtime):
    common, local = split_controls(values=controls)
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque portrait package photo required')
    common_active = controls_active(values=common)
    local_active = bool(active_controls(controls=local))
    if not local_active:
        return face_features_render.render_rgba(rgba=rgba, controls=common, runtime=runtime)
    package_receipts = {}
    result = rgba
    if common_active:
        result, package_receipts['face'] = face_features_render.render_rgba(rgba=result, controls=common, runtime=runtime)
    result, package_receipts['features'] = liquefy_combination_render.render_rgba(rgba=result, controls=local, runtime=runtime)
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent portrait package renderer loaded private effect libraries')
    local_receipt = package_receipts['features']
    receipt = {'scope': 'original-photo-independent-face-then-local-packages',
        'controls': {**common, **local}, 'decodedSize': [rgba.shape[1], rgba.shape[0]],
        'packageStages': list(package_receipts), 'packageReceipts': package_receipts,
        'predictionCount': sum(row['predictionCount'] for row in package_receipts.values()),
        'meshPassCount': sum(row['meshPassCount'] for row in package_receipts.values()),
        'sharedLocalPredictionCount': local_receipt['sharedLocalPredictionCount'],
        'passOrder': local_receipt['passOrder'], 'photoSamplePassCount': int(common_active) + local_receipt['photoSamplePassCount'],
        'alignment': local_receipt['alignment'], 'gpu': local_receipt['gpu'],
        'independence': independence, 'privateAssetDependency': True, 'nativeProductParityVerified': False,
        'nativePixelsUsed': False, 'nativeGeometryUsed': False, 'nativeFallbackUsed': False, 'fixedLandmarks': False,
        'rendererSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(), 'zeroControlsIdentity': False,
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
    return result, receipt


def render_image(*, image, controls, runtime, max_edge=1280):
    decoded = decode_image(image=image, max_edge=max_edge)
    result, receipt = render_rgba(rgba=decoded['rgba'], controls=controls, runtime=runtime)
    return result, receipt | {'image': str(image), 'sourceSha256': hashlib.sha256(Path(image).read_bytes()).hexdigest()}


def run(*, image, output, report, controls, runtime, max_edge=1280):
    if output.exists() or report.exists() or output.resolve() == report.resolve():
        raise ValueError('fresh distinct portrait PNG and report paths required')
    result, receipt = render_image(image=image, controls=controls, runtime=runtime, max_edge=max_edge)
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--controls', type=json.loads, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--max-edge', type=int, default=1280)
    args = parser.parse_args()
    receipt = run(image=args.image, controls=args.controls, runtime=args.runtime, output=args.output,
        report=args.report, max_edge=args.max_edge)
    print(json.dumps({'controls': receipt['controls'], 'changedPixelCount': receipt['changedPixelCount'],
        'private_native_images': receipt['independence']['private_native_images']}))
