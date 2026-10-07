"""Original opaque photo to independent six-card brow makeup PNG."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from brow_assets import CARDS, load_assets
from extra_photo import predict_extra_photo
from facefitting_image import decode_image
from facefitting_infer import native_images
from lip_assets import load_assets as load_geometry
from lip_render import texture_image
from makeup_blend import compose, unit_scalar
from makeup_geometry import original_pixels, working_mesh
from mesh_raster import rasterize
from slimface_render import validate_rgba


def run(*, rgba, card, strength, runtime, output, report):
    started=time.monotonic()
    validate_rgba(rgba=rgba)
    strength=unit_scalar(value=strength,name='brow strength')
    if card not in CARDS:
        raise ValueError('pinned brow card required')
    prediction=None
    result=rgba.copy()
    diagnostics={'identity':True}
    if strength>.001:
        if np.any(rgba[...,3]!=255):
            raise ValueError('active brow acceptance requires an opaque photo')
        prediction=predict_extra_photo(rgba=rgba,model_root=runtime/'research',interleave_alignment=True)
        points=original_pixels(points=np.asarray(prediction['points'],np.float32),
            algorithm_size=prediction['algorithmSize'],image_size=(rgba.shape[1],rgba.shape[0]))
        positions=working_mesh(points=points,assets=load_geometry(path=runtime/'research/lip-v1.npz'))
        assets=load_assets(path=runtime/'research/brow-v1.npz')
        matrix=assets['texture_transform']
        uv=(assets['uv'][:,:1]*matrix[:2,0]+assets['uv'][:,1:]*matrix[:2,1]+matrix[:2,3]).astype(np.float32)
        uv[:,1]=np.float32(1)-uv[:,1]
        package,sha256=CARDS[card]
        texture=texture_image(path=runtime/'Cache/effect'/package/'image/eyebrow/eyebrow.png',sha256=sha256)
        pigment,diagnostics=rasterize(rgba=texture,positions=positions,
            uv=uv*np.array([texture.shape[1],texture.shape[0]],np.float32),triangles=assets['triangles'],
            floating=True,size=(rgba.shape[1],rgba.shape[0]))
        result=np.rint(compose(base=rgba.astype(np.float32)/np.float32(255),
            pigment=(pigment/255).astype(np.float32),strength=float(strength),mode='multiply')*255).astype(np.uint8)
    independence=native_images()
    if independence['private_native_images']:
        raise ValueError('independent brow makeup loaded vendor native libraries')
    receipt={'scope':'original-photo-six-card-brows-248-mesh-PNG','cardId':card,'strength':float(strength),
        'extra':prediction,'width':rgba.shape[1],'height':rgba.shape[0],'diagnostics':diagnostics,
        'fixedLandmarks':False,'nativeGeometryUsed':False,'privateAssetDependency':prediction is not None,
        'independence':independence,'videoVerified':False,'nativeProductParityVerified':False,
        'inputRgbaSha256':hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256':hashlib.sha256(result.tobytes()).hexdigest(),
        'milliseconds':round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--card',choices=tuple(CARDS),required=True)
    parser.add_argument('--strength',type=float,default=.8)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve()==args.report.resolve():
        parser.error('fresh distinct PNG and receipt paths required')
    run(rgba=decode_image(image=args.image,max_edge=1280)['rgba'],card=args.card,strength=args.strength,
        runtime=args.runtime,output=args.output,report=args.report)
