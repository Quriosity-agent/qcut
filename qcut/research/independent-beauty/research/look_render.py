"""Original opaque photo to an independently rendered oxygen-look PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from iris_photo import predict_iris_photo
from look_assets import CARD
from look_layers import build_passes
from makeup_blend import unit_scalar
from makeup_metal import render
from slimface_render import validate_rgba


def run(*, rgba, card, strength, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='oxygen look strength')
    if card != CARD:
        raise ValueError('pinned oxygen-look card required')
    prediction = None
    mouth_selection = None
    result = rgba.copy()
    diagnostics = {'identity': True}
    if strength > .001:
        if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
            raise ValueError('active oxygen acceptance requires a bounded opaque photo')
        prediction = predict_iris_photo(rgba=rgba, model_root=runtime/'research')
        passes = build_passes(prediction=prediction, size=(rgba.shape[1], rgba.shape[0]),
            strength=strength, runtime=runtime)
        mouth_selection = next(layer['mouthSelection'] for layer in passes if layer['name'] == 'Lip')
        result, diagnostics = render(rgba=rgba, passes=passes, runtime=runtime)
        diagnostics['changedPixelCount'] = int(np.count_nonzero(np.any(result != rgba, axis=-1)))
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent oxygen renderer loaded private native images')
    receipt = {'scope': 'original-photo-oxygen-look-owned-Metal-independent-PNG', 'cardId': card,
        'strength': float(strength), 'iris': prediction, 'width': rgba.shape[1], 'height': rgba.shape[0],
        'diagnostics': diagnostics, 'fixedLandmarks': False, 'nativeGeometryUsed': False,
        'privateAssetDependency': prediction is not None, 'independence': independence,
        'videoVerified': False, 'nativeProductParityVerified': False, 'closedMouthProfile': False,
        'mouthSelection': mouth_selection,
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'milliseconds': round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--card', choices=(CARD,), default=CARD)
    parser.add_argument('--strength', type=float, default=.8)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct oxygen PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, strength=args.strength,
        runtime=args.runtime, output=args.output, report=args.report)
