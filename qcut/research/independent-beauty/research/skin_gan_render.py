"""Original photo to independent skin-GAN PNG with an owned control vector."""
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
from skin_gan_math import controls
from slimface_render import validate_rgba


def run(*, rgba, runtime, output, report, yunfu=0, fuling=0, contour=0):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    strengths, vector, flow_enabled = controls(yunfu=yunfu, fuling=fuling, contour=contour)
    if max(rgba.shape[:2]) > 1280 or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque skin-GAN photo required')
    prediction, gpu, result = None, None, rgba.copy()
    active_strength = max(strengths.values())
    if active_strength > 0:
        prediction = predict(rgba=rgba, model_root=runtime/'research', stabilized=True)
        result, gpu = render(rgba=rgba, prediction=prediction, intensity=active_strength,
            runtime=runtime, control_vector=vector, flow_enabled=flow_enabled)
    isolation = native_images()
    if isolation['private_native_images']:
        raise ValueError('independent skin-GAN loaded private native libraries')
    receipt = {'scope': 'original-photo-independent-NH-skin-GAN-PNG',
        'controls': strengths, 'controlVector': vector.tolist(), 'flowEnabled': flow_enabled,
        'width': rgba.shape[1], 'height': rgba.shape[0],
        'front': front_receipt(prediction=prediction) if prediction is not None else None,
        'gpu': gpu, 'independence': isolation, 'fixedLandmarks': False,
        'nativeGeometryUsed': False, 'nativeInputsUsed': False,
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
    parser.add_argument('--yunfu', type=float, default=0)
    parser.add_argument('--fuling', type=float, default=0)
    parser.add_argument('--contour', type=float, default=0)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if (args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve()
            or args.image.resolve() in (args.output.resolve(), args.report.resolve())):
        parser.error('fresh distinct input, output and report required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], runtime=args.runtime,
        output=args.output, report=args.report, yunfu=args.yunfu, fuling=args.fuling, contour=args.contour)
