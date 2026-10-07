"""Original photo to independent linked small-face geometry and two-pass PNG."""
import argparse
import hashlib
import json
from numbers import Real
from pathlib import Path
import time

import numpy as np
from PIL import Image

from face_metal import render
from face_shape_assets import load_assets as load_shape
from facefitting_image import decode_image
from facefitting_infer import native_images
from liquefy_assets import load_assets as load_local
from liquefy_geometry import build_steps, warp_coordinates
from liquefy_mesh import generate_support
from liquefy_pose import adjust_strength
from slimface_detection import single_face_prediction
from slimface_mesh import generate_degree_mesh
from slimface_mesh_assets import load_assets as load_mesh
from slimface_render import validate_rgba
from youtai_assets import load_assets

PROFILE = np.array([.151, .007, .056, .053, -.028, .126, -.161, -.2, -.098, -.101,
                    -.2, -.2, -.046, -.018, -.028, 0, 0, -.14, 0, 0, 2, -.035, 0], np.float64)
PROFILE.setflags(write=False)
F = np.float32


def validate_intensity(*, intensity):
    if isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, Real) or not np.isfinite(intensity) or not 0 <= intensity <= 100:
        raise ValueError('small-face intensity must be finite and in [0,100]')
    return float(intensity)


def build_passes(*, prediction, size, intensity, runtime):
    intensity = validate_intensity(intensity=intensity)
    root = runtime/'research'
    organs = load_assets(path=root/'youtai-v1.npz')
    mesh_assets = load_mesh(path=root/'slimface-mesh-v1.npz') | {'weights': organs['weights']}
    degrees = (PROFILE * (intensity/100)).astype(np.float32)
    degrees[20] = 2
    mesh = generate_degree_mesh(points=np.asarray(prediction['points'], np.float32), intensity=intensity,
        size=size, assets=mesh_assets, degrees=degrees, shape_assets=load_shape(path=root/'face-shape-v1.npz'),
        organ_assets=organs, **{key: prediction['consumer_pose'][key] for key in ('yaw', 'pitch')})
    local = load_local(path=root/'liquefy-v1.npz')
    points = np.asarray(prediction['normalized_points'], np.float32)
    yaw = F(-F(prediction['yaw']) * F(np.pi/180))
    support = generate_support(points=points, yaw_radians=yaw, assets=local)
    steps = build_steps(points=points, records=organs['steps'], size=size, yaw_radians=yaw)
    yaw_degrees = F(F(yaw * F(180)) / F(np.pi))
    steps['strength'] = adjust_strength(points=points, steps=steps,
        parameters=np.array([yaw_degrees, *size, 20, 45, -1, 0, 1], np.float32), exponent=float(local['side_exponent']))
    warped = warp_coordinates(coordinates=support['uv'] * np.array(size, np.float32), steps=steps)
    uv = support['uv'] + (warped / np.array(size, np.float32) - support['uv']) * F(intensity/100)
    return [{'name': 'LinkedOrgans', 'vertices': np.column_stack((mesh['clip_positions'], mesh['texcoords'])),
             'triangles': mesh['triangles']},
            {'name': 'LocalWarp', 'vertices': np.column_stack((support['positions'], uv)),
             'triangles': local['triangles']}]


def run(*, rgba, intensity, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    intensity = validate_intensity(intensity=intensity)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque small-face photo required')
    prediction, gpu = None, None
    result = rgba.copy()
    if intensity > 0:
        prediction = single_face_prediction(rgba=rgba)
        passes = build_passes(prediction=prediction, size=[rgba.shape[1], rgba.shape[0]], intensity=intensity, runtime=runtime)
        result, gpu = render(rgba=rgba, passes=passes, runtime=runtime)
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent small-face renderer loaded private native libraries')
    receipt = {'scope': 'original-photo-linked-small-face-two-pass-PNG', 'control': 'YouTaiFace', 'intensity': intensity,
        'width': rgba.shape[1], 'height': rgba.shape[0], 'alignment': prediction, 'gpu': gpu,
        'independence': independence, 'privateAssetDependency': prediction is not None,
        'fixedLandmarks': False, 'nativeGeometryUsed': False, 'nativeProductParityVerified': False,
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
        parser.error('fresh distinct PNG and report paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], intensity=args.intensity,
        runtime=args.runtime, output=args.output, report=args.report)
