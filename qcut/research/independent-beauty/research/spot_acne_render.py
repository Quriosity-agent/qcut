"""Original photo to independently detected and inferred SpotAcne PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from slimface_render import validate_rgba
from spot_acne_crop import run as crop_photo
from spot_acne_metal import render as composite
from spot_acne_network import infer
from slimface_geometry import validate_intensity


def run(*, rgba, intensity, runtime, output, report):
    started=time.monotonic()
    validate_rgba(rgba=rgba)
    intensity=validate_intensity(intensity=intensity)
    if (max(rgba.shape[:2])>1280 or np.any(rgba[...,3]!=255) or output.exists() or report.exists()
            or output.resolve()==report.resolve()):
        raise ValueError('bounded opaque original and distinct fresh SpotAcne outputs required')
    result,diagnostics=rgba.copy(),None
    if intensity>0:
        with tempfile.TemporaryDirectory(prefix='spot-acne-original-') as temporary:
            directory=Path(temporary)/'crop'
            crop=crop_photo(rgba=rgba,runtime=runtime,output=directory,phase='reset')
            network,network_receipt=infer(crop=np.fromfile(directory/'crop.f32','<f4').reshape(512,512,4),runtime=runtime)
            result,gpu=composite(rgba=rgba,network=network,crop=crop,intensity=intensity,runtime=runtime)
            diagnostics=dict(crop=crop,network=network_receipt,gpu=gpu)
    isolation=native_images()
    if isolation['private_native_images']:
        raise ValueError('independent SpotAcne loaded private native libraries')
    receipt=dict(scope='original-photo-independent-SpotAcne-PNG',control='face_adjust_SpotAcne',
        intensity=intensity,width=rgba.shape[1],height=rgba.shape[0],diagnostics=diagnostics,
        independence=isolation,nativePixelsUsed=False,nativeGeometryUsed=False,fixedLandmarks=False,
        nativeProductParityVerified=False,videoVerified=False,privateAssetDependency=intensity>0,
        inputRgbaSha256=hashlib.sha256(rgba.tobytes()).hexdigest(),outputRgbaSha256=hashlib.sha256(result.tobytes()).hexdigest(),
        changedPixels=int(np.count_nonzero(np.any(result!=rgba,axis=-1))),milliseconds=round((time.monotonic()-started)*1000))
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--intensity',type=float,required=True)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.image.resolve() in (args.output.resolve(),args.report.resolve()):
        parser.error('original must differ from output and report')
    run(rgba=decode_image(image=args.image,max_edge=1280)['rgba'],intensity=args.intensity,
        runtime=args.runtime,output=args.output,report=args.report)
