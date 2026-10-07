"""Original photo to independent shadow and jawline-warp Metal passes."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from consumer_pose import DEGREE_TO_RADIAN
from extra_photo import predict_extra_photo
from face_metal import render as render_warp
from facefitting_image import decode_image
from facefitting_infer import native_images
from jawline_assets import load_assets
from jawline_layers import shadow_pass
from jawline_warp import build_mesh
from makeup_geometry import original_pixels
from makeup_metal import render as render_shadow
from slimface_render import validate_rgba
from youtai_render import validate_intensity

F = np.float32


def run(*, rgba, intensity, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    intensity = validate_intensity(intensity=intensity)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque jawline photo required')
    prediction, gpu, pose, coverage = None, None, None, None
    result = rgba.copy()
    if intensity > 0:
        prediction = predict_extra_photo(rgba=rgba, model_root=runtime/'research', interleave_alignment=True)
        size = (rgba.shape[1], rgba.shape[0])
        points = original_pixels(points=np.asarray(prediction['points'], F),
            algorithm_size=prediction['algorithmSize'], image_size=size)[:106]
        yaw = F(-F(prediction['base']['yaw'])*DEGREE_TO_RADIAN)
        pitch = F(-F(prediction['base']['pitch'])*DEGREE_TO_RADIAN)
        assets = load_assets(path=runtime/'research/jawline-v1.npz')
        mesh, coverage = build_mesh(points=points, size=size, yaw=yaw, pitch=pitch, strength=intensity/100, assets=assets)
        layer = shadow_pass(prediction=prediction, size=size, yaw=yaw, pitch=pitch,
            strength=intensity/100, assets=assets, runtime=runtime)
        result, shadow_gpu = render_shadow(rgba=rgba, passes=[layer], runtime=runtime)
        result, warp_gpu = render_warp(rgba=result, passes=[mesh], runtime=runtime, profile='jawline')
        gpu = {'shadow': shadow_gpu, 'warp': warp_gpu}
        pose = {'yawRadians': float(yaw), 'pitchRadians': float(pitch), 'shadowOpacity': layer['strength']}
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent jawline loaded private effect libraries')
    receipt = {'scope': 'original-photo-independent-shadow-jawline-PNG', 'control': 'XiaHeXian',
        'intensity': intensity, 'width': rgba.shape[1], 'height': rgba.shape[0], 'extra': prediction,
        'pose': pose, 'gpu': gpu, 'coverage': coverage, 'independence': independence, 'fixedLandmarks': False,
        'nativeGeometryUsed': False, 'privateAssetDependency': prediction is not None,
        'negativePitchVerified': False, 'edgeClippedFaceVerified': False,
        'nativeProductParityVerified': False, 'videoVerified': False,
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'changedPixels': int(np.count_nonzero(np.any(result != rgba, axis=-1))),
        'milliseconds': round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--intensity', type=float, required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct output and report required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], intensity=args.intensity,
        runtime=args.runtime, output=args.output, report=args.report)
