"""Original photo to independent coral lipstick PNG with private local assets."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from extra_photo import predict_extra_photo
from facefitting_image import decode_image
from facefitting_infer import native_images
from lip_assets import PACKAGE, load_assets
from makeup_blend import compose, unit_scalar
from makeup_geometry import original_pixels, working_mesh
from mesh_raster import rasterize
from mouth_state import mouth_texture
from slimface_render import validate_rgba


def texture_image(*, path, sha256):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError('private lipstick texture identity mismatch')
    with Image.open(path) as image:
        if image.format != 'PNG' or max(image.size) > 1024:
            raise ValueError('bounded lipstick PNG required')
        rgba = np.array(image.convert('RGBA'))
    rgba[..., :3] = np.rint(rgba[..., :3].astype(np.float64)*rgba[..., 3:4]/255).astype(np.uint8)
    return rgba


def render_lip(*, rgba, points, assets, runtime, strength, texture_state='Close'):
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='lip strength')
    if texture_state not in ('Open', 'Close'):
        raise ValueError('explicit Open or Close lipstick texture required')
    if strength <= .001:
        return rgba.copy(), {'identity': True, 'layers': []}
    if np.any(rgba[..., 3] != 255):
        raise ValueError('active lipstick acceptance currently requires an opaque photo')
    height, width = rgba.shape[:2]
    mesh = working_mesh(points=points, assets=assets)
    positions = mesh*assets['position_scale']
    matrix = assets['texture_transform']
    uv = (assets['uv'][:, :1]*matrix[:2, 0]+assets['uv'][:, 1:]*matrix[:2, 1]+matrix[:2, 3]).astype(np.float32)
    uv[:, 1] = np.float32(1)-uv[:, 1]
    output = rgba.astype(np.float32)/np.float32(255)
    output[..., :3] *= output[..., 3:4]
    layers = []
    for mode, name in (('color', 'Color'), ('multiply', 'Multiply'), ('screen', 'Screen')):
        texture = texture_image(path=runtime/'Cache/effect'/PACKAGE/f'image/lip_BlendMode{name}/default/lip{texture_state}.png',
                                sha256=str(assets[f'image_sha_{name}_{texture_state}']))
        pigment, diagnostics = rasterize(rgba=texture, positions=positions,
            uv=uv*np.array([texture.shape[1], texture.shape[0]], np.float32), triangles=assets['triangles'],
            floating=True, size=(width, height))
        output = compose(base=output, pigment=(pigment/255).astype(np.float32), strength=float(strength), mode=mode)
        output = np.rint(np.clip(output, 0, 1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
        layers.append({'mode': mode, 'textureState': texture_state, 'raster': diagnostics})
    result = np.rint(output*255).astype(np.uint8)
    return result, {'identity': False, 'layers': layers,
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}


def run(*, rgba, strength, runtime, assets_path, texture_state, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    unit_scalar(value=strength, name='lip strength')
    if texture_state not in ('Auto', 'Open', 'Close'):
        raise ValueError('Auto, Open or Close lipstick texture required')
    if strength > .001 and np.any(rgba[..., 3] != 255):
        raise ValueError('active lipstick acceptance currently requires an opaque photo')
    prediction = None
    selection = None
    if strength > .001:
        prediction = predict_extra_photo(rgba=rgba, model_root=runtime/'research', interleave_alignment=True)
        points = original_pixels(points=np.asarray(prediction['points'], np.float32),
            algorithm_size=prediction['algorithmSize'], image_size=(rgba.shape[1], rgba.shape[0]))
        assets = load_assets(path=assets_path)
        selection = mouth_texture(positions=working_mesh(points=points, assets=assets))
        selected_state = selection['textureState'] if texture_state == 'Auto' else texture_state
        result, diagnostics = render_lip(rgba=rgba, points=points, assets=assets,
            runtime=runtime, strength=strength, texture_state=selected_state)
    else:
        result, diagnostics = rgba.copy(), {'identity': True, 'layers': []}
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent lipstick loaded vendor native libraries')
    receipt = {'scope': 'original-photo-coral-lipstick-248-mesh-PNG', 'cardId': 'lip-coral-nude',
        'strength': strength, 'textureState': selected_state if selection else texture_state,
        'requestedTextureState': texture_state, 'mouthSelection': selection, 'autoMouthStateVerified': False,
        'width': rgba.shape[1], 'height': rgba.shape[0], 'extra': prediction,
        'independence': independence, 'privateAssetDependency': bool(prediction), 'fixedLandmarks': False,
        'nativeGeometryUsed': False, 'videoVerified': False, 'nativeProductParityVerified': False,
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'diagnostics': diagnostics, 'milliseconds': round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--strength', type=float, default=.8)
    parser.add_argument('--texture-state', choices=('Auto', 'Open', 'Close'), default='Auto')
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--assets', type=Path, default=Path(__file__).resolve().parents[1]/'runtime/research/lip-v1.npz')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct PNG and receipt paths required')
    run(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], strength=args.strength, runtime=args.runtime,
        assets_path=args.assets, texture_state=args.texture_state, output=args.output, report=args.report)
