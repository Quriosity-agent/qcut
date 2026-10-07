"""Original photo -> owned skin inference -> owned whitening Metal -> PNG."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from makeup_blend import unit_scalar
from whiten_assets import load_lut
from whiten_metal import process_images, render

ROOT = Path(__file__).resolve().parents[1]


def render_image(*, image, strength, runtime, max_edge=1280):
    strength = unit_scalar(value=strength, name='whitening strength')
    decoded = decode_image(image=image, max_edge=max_edge)
    rgba = decoded['rgba']
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque whitening photo required')
    diagnostics = {}
    assets = None
    if strength == 0:
        result = rgba.copy()
    else:
        from skin_mask_frontend import predict_skin_mask
        lut, assets = load_lut(runtime=runtime)
        mask, inference = predict_skin_mask(rgba=rgba, runtime=runtime)
        result, gpu = render(rgba=rgba, lut=lut, mask_texture=mask, strength=strength, runtime=runtime)
        diagnostics = {'skin': inference, 'gpu': gpu,
                       'maskTextureShape': list(mask.shape),
                       'maskTextureSha256': hashlib.sha256(mask.tobytes()).hexdigest()}
    independence = process_images()
    receipt = {'scope': 'original-photo-independent-whitening', 'image': str(image),
               'sourceSha256': hashlib.sha256(Path(image).read_bytes()).hexdigest(),
               'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
               'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
               'decodedSize': decoded['decoded_size'], 'strength': float(strength),
               'diagnostics': diagnostics, 'assets': assets, 'independence': independence,
               'nativePixelsUsed': False, 'nativeGeometryUsed': False,
               'zeroStrengthIdentity': bool(strength == 0 and np.array_equal(result, rgba)),
               'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
    return result, receipt


def run(*, image, output, report, strength, runtime, max_edge=1280):
    if output.exists() or report.exists() or output.resolve() == report.resolve():
        raise ValueError('fresh distinct whitening PNG and report paths required')
    result, receipt = render_image(image=image, strength=strength, runtime=runtime, max_edge=max_edge)
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(output), 'changedPixelCount': receipt['changedPixelCount'],
                      'private_native_images': receipt['independence']['private_native_images']}))
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--strength', type=float, required=True)
    parser.add_argument('--max-edge', type=int, default=1280)
    arguments = parser.parse_args()
    run(image=arguments.image, output=arguments.output, report=arguments.report,
        strength=arguments.strength, runtime=arguments.runtime, max_edge=arguments.max_edge)
