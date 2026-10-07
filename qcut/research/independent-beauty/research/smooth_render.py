"""Original photo to owned FACE145, skin inference and eight-pass smoothing PNG."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from makeup_blend import unit_scalar
from smooth_assets import load_assets
from smooth_geometry import face_mesh
from smooth_metal import render

ROOT = Path(__file__).resolve().parents[1]


def render_image(*, image, strength, runtime, retain_stages=False):
    strength = unit_scalar(value=strength, name='smoothing strength')
    decoded = decode_image(image=image, max_edge=1280)
    rgba = decoded['rgba']
    if max(rgba.shape[:2]) > 1280:
        raise ValueError('bounded smoothing photo required')
    result, diagnostics, stages = rgba.copy(), {}, {}
    if strength > .001:
        if np.any(rgba[..., 3] != 255):
            raise ValueError('active smoothing requires an opaque photo')
        from skin_mask_frontend import predict_skin_mask
        from slimface_detection import single_face_prediction
        prediction = single_face_prediction(rgba=rgba)
        assets = load_assets(runtime=runtime)
        mask, skin = predict_skin_mask(rgba=rgba, runtime=runtime)
        mesh = face_mesh(normalized=np.asarray(prediction['normalized_points'], np.float32),
                         size=(rgba.shape[1], rgba.shape[0]), assets=assets)
        result, gpu, stages = render(rgba=rgba, skin=mask, face=assets['face'], cube=assets['cube'],
                                    strength=strength, runtime=runtime, mesh=mesh, retain_stages=retain_stages)
        diagnostics = {'face': prediction, 'skin': skin, 'gpu': gpu, 'assets': assets['identities'],
                       'meshSha256': hashlib.sha256(mesh['vertices'].tobytes()).hexdigest()}
    isolation = native_images()
    if isolation['private_native_images']:
        raise ValueError('independent smoothing loaded private effect libraries')
    receipt = {'scope': 'original-photo-independent-eight-pass-smoothing', 'image': str(image),
               'sourceSha256': hashlib.sha256(Path(image).read_bytes()).hexdigest(),
               'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
               'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
               'decodedSize': decoded['decoded_size'], 'strength': float(strength),
               'diagnostics': diagnostics, 'independence': isolation,
               'nativePixelsUsed': False, 'nativeGeometryUsed': False, 'nativeInputsUsed': False,
               'zeroStrengthIdentity': bool(strength <= .001 and np.array_equal(result, rgba)),
               'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
    return result, receipt, stages


def run(*, image, strength, runtime, output, report):
    if (output.exists() or report.exists() or output.resolve() == report.resolve()
            or image.resolve() in (output.resolve(), report.resolve())):
        raise ValueError('fresh distinct source, smoothing PNG and report paths required')
    result, receipt, _ = render_image(image=image, strength=strength, runtime=runtime)
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'output': str(output), 'changedPixelCount': receipt['changedPixelCount']}))
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--strength', type=float, required=True)
    parser.add_argument('--runtime', type=Path, default=ROOT/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    run(image=args.image, strength=args.strength, runtime=args.runtime, output=args.output, report=args.report)
