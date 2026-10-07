"""Original photo to independent local deformation PNG, with private model assets."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from liquefy_assets import CONTROLS, load_assets
from liquefy_geometry import build_steps
from liquefy_mesh import generate_support
from liquefy_pose import adjust_strength
from liquefy_texture import render_local
from slimface_detection import single_face_prediction
from slimface_render import validate_rgba

PACKAGE = '7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76/AmazingFeature'
MASKS = {'cheekbone':'FaceCheekbone', 'upper_atrium':'UpperAtrium',
         'mid_atrium':'MidAtrium', 'lower_atrium':'LowerAtrium'}
MASK_SHA256 = {
    'FaceCheekbone_N_mask.png': '1cd9028c477c06f3aa112e7d1690e3b6884813e935b770db495193eca5a0f96c',
    'FaceCheekbone_P_mask.png': '9ee95ea5a1ca55a9f5eafa7cfd2bf7dc58e966c32604a945b2b18c2086f4d88b',
    'LowerAtrium_Neg_mask.png': 'c2305bad131a79242e68eb6d699d0344799283a9d0224bdfb79d4c393b3efbf1',
    'LowerAtrium_Pos_mask.png': '0c892837fe9f3a858c8a38f0bfe98b89a35d29893143f19a8e020ee36eca9052',
    'MidAtrium_Neg_mask.png': '0844bbeb0b088aeff30420190ae1252e1e12cd9aeca60b5c4e01a09a09f61848',
    'MidAtrium_Pos_mask.png': 'e4ee40203436b792bc248a0fbc72a9f1683d6efeebb8068aeae9a89f87b5cf68',
    'UpperAtrium_Neg_mask.png': 'e7d9c2afc28225533318fbb212750c35616a026b2092692fa1303d6083c4ef36',
    'UpperAtrium_Pos_mask.png': '1d9bba895c886440ee4c14c22cbbb0894dd56a40bdf0e471f655e7e064974c1d',
}


def read_mask(*, path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != MASK_SHA256.get(path.name):
        raise ValueError('private local deformation mask identity mismatch')
    with Image.open(path) as image:
        if image.format != 'PNG' or max(image.size) > 1024:
            raise ValueError('bounded local deformation PNG required')
        return np.array(image.convert('RGBA'))


def validate_controls(*, values):
    if not isinstance(values, dict) or set(values) - set(CONTROLS):
        raise ValueError('explicit local deformation controls required')
    result = {key: 0. for key in CONTROLS}
    for key,value in values.items():
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not np.isfinite(value) or not -50 <= value <= 50:
            raise ValueError('local face values must be finite numbers in [-50,50]')
        result[key] = float(value)
    return result


def active_controls(*, controls):
    return [key for key in CONTROLS if abs(controls.get(key, 0) / 100 * 2
            * (1.3 if key in ('upper_atrium', 'mid_atrium') else 1)) > .001]


def build_control_pass(*, rgba, control, value, points, yaw_radians, assets, runtime, support=None, mean_uv=None):
    positive = value > 0
    records = assets[f'{control}_{"positive" if positive else "negative"}']
    height,width=rgba.shape[:2]
    if support is None:
        support = generate_support(points=points,yaw_radians=yaw_radians,assets=assets)
    steps=build_steps(points=points,records=records,size=[width,height],yaw_radians=yaw_radians)
    yaw_degrees = np.float32(np.float32(yaw_radians * np.float32(180)) / np.float32(np.pi))
    steps['strength']=adjust_strength(points=points,steps=steps,
        parameters=np.array([yaw_degrees,width,height,20,45,-.1,0,1],np.float32),exponent=float(assets['side_exponent']))
    intensity = abs(value/100*2)
    mask=None
    if control in MASKS:
        positive_branch = positive if control=='cheekbone' else not positive
        sign='Pos' if positive_branch else 'Neg'
        entity=MASKS[control]
        suffix=sign[0] if control=='cheekbone' else sign
        mask=read_mask(path=runtime/'Cache/effect'/PACKAGE/'texture'/f'{entity}_{suffix}_mask.png')
        if mean_uv is None:
            mean_uv=generate_support(points=assets['mean_points'],yaw_radians=0,assets=assets)['uv']
        if control in ('upper_atrium','mid_atrium'):
            intensity*=1.3
        if control=='upper_atrium':
            intensity*=.6
        if control=='lower_atrium' and positive_branch:
            intensity*=.8
    return {'support': support, 'triangles': assets['triangles'], 'steps': steps, 'intensity': intensity,
        'mask': np.full((1, 1, 4), 255, np.uint8) if mask is None else mask,
        'mask_uv': support['uv'] if mask is None else mean_uv,
        'radial_profile': 'quadratic' if mask is not None else 'linear'}


def render_control(*, rgba, control, value, points, yaw_radians, assets, runtime):
    specification = build_control_pass(rgba=rgba, control=control, value=value, points=points,
        yaw_radians=yaw_radians, assets=assets, runtime=runtime)
    return render_local(rgba=rgba, runtime=runtime, **specification)


def run(*, rgba, controls, runtime, assets_path, output, report):
    started=time.monotonic()
    validate_rgba(rgba=rgba)
    controls=validate_controls(values=controls)
    active=active_controls(controls=controls)
    if len(active)>1:
        raise ValueError('single-control local deformation acceptance only; combinations are not verified')
    prediction=None
    result=rgba.copy()
    diagnostics={'identity':True}
    if active:
        prediction=single_face_prediction(rgba=rgba)
        points=np.asarray(prediction['normalized_points'],np.float32)
        yaw=np.float32(-np.float32(prediction['yaw'])*np.float32(np.pi/180))
        result,diagnostics=render_control(rgba=rgba,control=active[0],value=controls[active[0]],points=points,
            yaw_radians=yaw,assets=load_assets(path=assets_path),runtime=runtime)
    independence=native_images()
    if independence['private_native_images']:
        raise ValueError('independent local renderer loaded private native libraries')
    receipt={'scope':'one-face-single-local-control-2270-mesh-packed-coordinate-texture-PNG',
        'controls':controls,'width':rgba.shape[1],'height':rgba.shape[0],
        'independence':independence,'privateAssetDependency':bool(active),'fixedLandmarks':False,
        'alignment':prediction,'diagnostics':diagnostics,'nativeProductParityVerified':False,
        'inputRgbaSha256':hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256':hashlib.sha256(result.tobytes()).hexdigest(),
        'milliseconds':round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--controls',required=True)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--assets',type=Path,default=Path(__file__).resolve().parents[1]/'runtime/research/liquefy-v1.npz')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve()==args.report.resolve():
        parser.error('fresh distinct output and report paths required')
    rgba=decode_image(image=args.image,max_edge=1280)['rgba']
    run(rgba=rgba,controls=json.loads(args.controls),runtime=args.runtime,assets_path=args.assets,output=args.output,report=args.report)
