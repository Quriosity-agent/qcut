"""Original photo to dynamic pigments sharing one Extra248 inference."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from dynamic_makeup_controls import GEOMETRY_FAMILIES, active_selections, normalize_selections
from dynamic_makeup_passes import selection_pass
from eye_support import eye_mesh
from extra_photo import predict_extra_photo
from facefitting_image import decode_image
from facefitting_infer import native_images
from lip_assets import load_assets as load_geometry
from makeup_geometry import original_pixels, working_mesh
from makeup_metal import render as render_pigments
from slimface_render import validate_rgba

ROOT = Path(__file__).resolve().parents[1]


def render_rgba(*, rgba, selections, runtime):
    selections = normalize_selections(selections=selections)
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque dynamic makeup photo required')
    runtime = Path(runtime).resolve()
    started = time.monotonic()
    active = active_selections(selections=selections)
    prediction, rows, gpu = None, [], None
    families = {}
    current = rgba.copy()
    if active:
        from worker import MODELS
        if MODELS.resolve() != (runtime/'research').resolve():
            raise ValueError('dynamic makeup runtime must match the configured face model directory')
        prediction = predict_extra_photo(rgba=rgba, model_root=runtime/'research', interleave_alignment=True)
        points = original_pixels(points=np.asarray(prediction['points'], np.float32),
            algorithm_size=prediction['algorithmSize'], image_size=(rgba.shape[1], rgba.shape[0]))
        geometries = {}
        requested_families = {GEOMETRY_FAMILIES[category] for category in active}
        if 'face248' in requested_families:
            geometries['face248'] = working_mesh(points=points, assets=load_geometry(path=runtime/'research/lip-v1.npz'))
        if 'eye174' in requested_families:
            geometries['eye174'] = eye_mesh(points=points)
        families = {family: hashlib.sha256(positions.tobytes()).hexdigest() for family, positions in geometries.items()}
        passes = []
        for category, selected in active.items():
            family = GEOMETRY_FAMILIES[category]
            pigment, details = selection_pass(positions=geometries[family], category=category,
                selection=selected, runtime=runtime)
            passes.append(pigment)
            rows.append(details | {'geometryFamily': family, 'sharedGeometrySha256': families[family]})
        current, gpu = render_pigments(rgba=rgba, passes=passes, runtime=runtime)
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent dynamic pigment renderer loaded private effect libraries')
    receipt = {'scope': 'original-photo-shared-extra248-dynamic-pigments', 'selections': selections,
        'width': rgba.shape[1], 'height': rgba.shape[0], 'extra': prediction, 'layers': rows,
        'sharedInferenceCount': int(bool(active)), 'geometryFamilies': families,
        'geometryMeshCount': len(families), 'fixedLandmarks': False, 'nativeGeometryUsed': False,
        'nativePixelsUsed': False, 'nativeInputsUsed': False, 'nativeFallbackUsed': False,
        'privateAssetDependency': bool(active), 'independence': independence, 'gpu': gpu,
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(current.tobytes()).hexdigest(),
        'zeroSelectionsIdentity': not active, 'nativeProductParityVerified': False, 'videoVerified': False,
        'milliseconds': round((time.monotonic()-started)*1000)}
    return current, receipt


def run(*, image, selections, runtime, output, report):
    if output.exists() or report.exists() or output.resolve() == report.resolve():
        raise ValueError('fresh distinct dynamic pigment PNG and report paths required')
    result, receipt = render_rgba(rgba=decode_image(image=image, max_edge=1280)['rgba'],
        selections=selections, runtime=runtime)
    receipt |= {'sourceSha256': hashlib.sha256(image.read_bytes()).hexdigest()}
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--selections', type=json.loads, required=True)
    parser.add_argument('--runtime', type=Path, default=ROOT/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    run(image=args.image, selections=args.selections, runtime=args.runtime, output=args.output, report=args.report)
