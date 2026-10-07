"""Original opaque photo to an independently inferred and rendered natural contacts PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from contacts_assets import SPEC, load_assets
from contacts_geometry import pupil_mesh
from contacts_layers import render
from eye_support import eye_mesh
from facefitting_image import decode_image
from facefitting_infer import native_images
from iris_photo import predict_iris_photo
from makeup_blend import unit_scalar
from makeup_geometry import original_pixels
from slimface_render import validate_rgba

CARD = 'contacts-natural'


def run(*, rgba, card, strength, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='contacts strength')
    if card != CARD:
        raise ValueError('pinned natural contacts card required')
    prediction = None
    result = rgba.copy()
    diagnostics = {'identity': True}
    if strength > .001:
        if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
            raise ValueError('active contacts acceptance requires a bounded opaque photo')
        prediction = predict_iris_photo(rgba=rgba, model_root=runtime/'research')
        extra = original_pixels(points=np.asarray(prediction['extraAlgorithmPoints'], np.float32),
            algorithm_size=prediction['algorithmSize'], image_size=(rgba.shape[1], rgba.shape[0]))
        pupil = np.vstack([np.asarray(eye['points'], np.float32) for eye in prediction['passes'][0]['eyes']])
        positions = pupil_mesh(extra=extra, pupil=pupil)
        assets = load_assets(path=runtime/'research/contacts-natural-v1.npz')
        result, diagnostics = render(rgba=rgba, pupil=positions, eyes=eye_mesh(points=extra),
            assets=assets, package=runtime/'Cache/effect'/SPEC['package'], strength=float(strength))
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent contacts loaded private native images')
    receipt = {'scope': 'original-photo-pupil78-independent-PNG', 'cardId': card, 'strength': float(strength),
        'iris': prediction, 'width': rgba.shape[1], 'height': rgba.shape[0], 'diagnostics': diagnostics,
        'fixedLandmarks': False, 'nativeGeometryUsed': False, 'privateAssetDependency': prediction is not None,
        'independence': independence, 'videoVerified': False, 'nativeProductParityVerified': False,
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
        parser.error('fresh distinct contacts PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, strength=args.strength,
        runtime=args.runtime, output=args.output, report=args.report)
