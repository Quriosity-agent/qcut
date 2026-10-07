"""Original single-face photo to independent eye, nose and mouth geometry and PNG."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from face_metal import render
from facefitting_image import decode_image
from facefitting_infer import native_images
from features_controls import feature_degrees, features_active, normalize_controls
from features_assets import load_assets as load_corners
from features_geometry import apply_feature_geometry
from slimface_detection import single_face_prediction
from slimface_mesh import generate_degree_mesh
from slimface_mesh_assets import load_assets as load_mesh
from slimface_render import validate_rgba
from youtai_assets import load_assets as load_organs

ROOT = Path(__file__).resolve().parents[1]
ASSET_NAMES = ('slimface-mesh-v1.npz', 'youtai-v1.npz', 'features-corners-v1.npz')
MODEL_NAMES = ('face-detector-dynamic.onnx', 'face-align-120.onnx', 'face-align-160.onnx',
               'alignment-assets-v1.npz', 'skin-seg-224x128.onnx', 'saliency-matting-640.onnx')


def build_feature_mesh(*, prediction, size, controls, runtime):
    controls = normalize_controls(values=controls)
    mesh_assets = load_mesh(path=runtime / 'research' / ASSET_NAMES[0])
    organs = load_organs(path=runtime / 'research' / ASSET_NAMES[1])
    points, degrees = np.asarray(prediction['points'], np.float32), feature_degrees(values=controls)
    mesh = generate_degree_mesh(points=points,
        intensity=0, size=size, assets=mesh_assets, degrees=degrees,
        organ_assets=organs, **{name: prediction['consumer_pose'][name] for name in ('yaw', 'pitch')})
    corners = load_corners(path=runtime / 'research' / ASSET_NAMES[2]) if degrees[15] != 0 else None
    return apply_feature_geometry(mesh=mesh, points=points, degrees=degrees, size=size,
        mesh_assets=mesh_assets, organ_assets=organs, corner_assets=corners,
        pitch=prediction['consumer_pose']['pitch'])


def render_rgba(*, rgba, controls, runtime):
    controls = normalize_controls(values=controls)
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque features photo required')
    runtime = Path(runtime).resolve()
    active = features_active(values=controls)
    prediction, gpu, assets = None, None, {}
    result = rgba.copy()
    if active:
        from worker import MODELS
        if MODELS.resolve() != (runtime / 'research').resolve():
            raise ValueError('features runtime must match the configured face model directory')
        prediction = single_face_prediction(rgba=rgba)
        mesh = build_feature_mesh(prediction=prediction, size=[rgba.shape[1], rgba.shape[0]],
                                  controls=controls, runtime=runtime)
        vertices = np.column_stack((mesh['clip_positions'], mesh['texcoords']))
        result, gpu = render(rgba=rgba, passes=[{'name': 'LinkedOrgans', 'vertices': vertices,
            'triangles': mesh['triangles']}], runtime=runtime, profile='features')
        assets = {name: hashlib.sha256((runtime / 'research' / name).read_bytes()).hexdigest()
                  for name in (*ASSET_NAMES, *MODEL_NAMES)}
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent features renderer loaded private effect libraries')
    receipt = {'scope': 'original-photo-independent-eye-nose-mouth-one-mesh',
        'controls': controls, 'degrees': feature_degrees(values=controls).tolist(),
        'decodedSize': [rgba.shape[1], rgba.shape[0]], 'alignment': prediction, 'gpu': gpu,
        'assets': assets, 'independence': independence, 'privateAssetDependency': active,
        'nativePixelsUsed': False, 'nativeGeometryUsed': False, 'fixedLandmarks': False,
        'nativeProductParityVerified': False,
        'rendererSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'controlSourceSha256': hashlib.sha256(Path(__file__).with_name('features_controls.py').read_bytes()).hexdigest(),
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'zeroControlsIdentity': bool(not active and np.array_equal(result, rgba)),
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
    return result, receipt


def render_image(*, image, controls, runtime, max_edge=1280):
    decoded = decode_image(image=image, max_edge=max_edge)
    result, receipt = render_rgba(rgba=decoded['rgba'], controls=controls, runtime=runtime)
    return result, receipt | {'image': str(image),
        'sourceSha256': hashlib.sha256(Path(image).read_bytes()).hexdigest()}


def run(*, image, output, report, controls, runtime, max_edge=1280):
    if output.exists() or report.exists() or output.resolve() == report.resolve():
        raise ValueError('fresh distinct features PNG and report paths required')
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
    arguments = parser.parse_args()
    receipt = run(image=arguments.image, output=arguments.output, report=arguments.report,
        controls=arguments.controls, runtime=arguments.runtime, max_edge=arguments.max_edge)
    print(json.dumps({'controls': receipt['controls'], 'changedPixelCount': receipt['changedPixelCount'],
                      'private_native_images': receipt['independence']['private_native_images']}))
