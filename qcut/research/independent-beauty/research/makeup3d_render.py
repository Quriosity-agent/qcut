"""Original photo to independently fitted highlighter or freckles PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting1256_photo import fit_photo
from facefitting_image import decode_image
from facefitting_infer import native_images
from makeup3d_metal import render
from makeup_metal import premultiply_rgba8
from slimface_render import validate_rgba
from youtai_render import validate_intensity

CARDS = json.loads(Path(__file__).with_name('makeup3d_cards.json').read_text())


def pigment_texture(*, card, runtime):
    if card not in CARDS:
        raise ValueError('bounded highlighter or freckles card required')
    spec = CARDS[card]
    package = runtime/'Cache/effect'/spec['package']
    for relative, digest in spec['files'].items():
        if hashlib.sha256((package/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('classical makeup package integrity mismatch')
    with Image.open(package/spec['texture']) as image:
        pigment = np.asarray(image.convert('RGBA'))
    return premultiply_rgba8(rgba=pigment)


def run(*, rgba, card, intensity, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    intensity = validate_intensity(intensity=intensity)
    if card not in CARDS or max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque classical makeup card photo required')
    fitting, gpu, result = None, None, rgba.copy()
    if intensity > 0:
        pigment = pigment_texture(card=card, runtime=runtime)
        mesh, fitting = fit_photo(rgba=rgba, runtime=runtime)
        result, gpu = render(rgba=rgba, mesh=mesh, pigment=pigment, intensity=intensity,
                             highlight=card == 'highlight-sweetheart', runtime=runtime)
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent classical makeup loaded vendor libraries')
    receipt = {'scope': 'original-photo-independent-classical-3d-makeup-PNG', 'card': card,
        'intensity': intensity, 'width': rgba.shape[1], 'height': rgba.shape[0], 'fitting': fitting,
        'gpu': gpu, 'independence': independence, 'fixedLandmarks': False, 'nativeGeometryUsed': False,
        'privateAssetDependency': fitting is not None, 'nativeProductParityVerified': False,
        'videoVerified': False, 'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'changedPixels': int(np.count_nonzero(np.any(result != rgba, axis=-1))),
        'milliseconds': round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--card', choices=sorted(CARDS), required=True)
    parser.add_argument('--intensity', type=float, required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct output and report required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], card=args.card, intensity=args.intensity,
        runtime=args.runtime, output=args.output, report=args.report)
