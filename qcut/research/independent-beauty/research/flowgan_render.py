"""Original photo to independently detected NH FlowGAN contour-smoothing PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from flow_base import predict, receipt as front_receipt
from flowgan_metal import render
from slimface_render import validate_rgba
from youtai_render import validate_intensity


def run(*, rgba, intensity, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    intensity = validate_intensity(intensity=intensity)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque FlowGAN photo required')
    prediction, gpu, result = None, None, rgba.copy()
    if intensity > 0:
        prediction = predict(rgba=rgba, model_root=runtime/'research', stabilized=True)
        result, gpu = render(rgba=rgba, prediction=prediction, intensity=intensity, runtime=runtime)
    isolation = native_images()
    if isolation['private_native_images']:
        raise ValueError('independent FlowGAN loaded private native libraries')
    receipt = {'scope': 'original-photo-independent-NH-FlowGAN-PNG',
        'control': 'face_adjust_lunkuopinghua', 'intensity': intensity,
        'width': rgba.shape[1], 'height': rgba.shape[0],
        'front': front_receipt(prediction=prediction) if prediction is not None else None,
        'gpu': gpu, 'independence': isolation, 'fixedLandmarks': False, 'nativeGeometryUsed': False,
        'privateAssetDependency': prediction is not None, 'nativeProductParityVerified': False,
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
    parser.add_argument('--intensity', type=float, required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if (args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve()
            or args.image.resolve() in (args.output.resolve(), args.report.resolve())):
        parser.error('fresh distinct input, output and report required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], intensity=args.intensity,
        runtime=args.runtime, output=args.output, report=args.report)
