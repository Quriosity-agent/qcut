"""Rasterize premultiplied pigment layers and compose one RGBA8 makeup pass."""
import hashlib

import numpy as np
from PIL import Image

from makeup_blend import compose, unit_scalar
from mesh_raster import rasterize
from slimface_render import validate_rgba


def load_texture(*, path, sha256, premultiply=True):
    if type(premultiply) is not bool:
        raise ValueError("explicit makeup texture premultiplication required")
    if path.stat().st_size > 8*1024*1024:
        raise ValueError('bounded private makeup texture required')
    data=path.read_bytes()
    if hashlib.sha256(data).hexdigest()!=sha256:
        raise ValueError('private makeup texture identity mismatch')
    with Image.open(path) as image:
        if image.format!='PNG' or max(image.size)>2048 or image.width*image.height>4194304:
            raise ValueError('bounded PNG makeup texture required')
        rgba=np.array(image.convert('RGBA'))
    if premultiply:
        rgba[...,:3]=np.rint(rgba[...,:3].astype(np.float64)*rgba[...,3:4]/255).astype(np.uint8)
    return rgba


def compose_layers(*, base, pigments, strength):
    strength=unit_scalar(value=strength,name='makeup strength')
    output=base
    for pigment,mode in pigments:
        output=compose(base=output,pigment=pigment,strength=float(strength),mode=mode)
    # Reflect and pigment are one shader pass; quantize only after both blends.
    return np.rint(np.clip(output,0,1)*255).astype(np.uint8)


def render_layers(*, rgba, positions, assets, layers, package, strength, coverage_bits=None):
    validate_rgba(rgba=rgba)
    matrix=assets['texture_transform']
    uv=(assets['uv'][:,:1]*matrix[:2,0]+assets['uv'][:,1:]*matrix[:2,1]+matrix[:2,3]).astype(np.float32)
    uv[:,1]=np.float32(1)-uv[:,1]
    positions=positions*assets['position_scale']
    pigments,diagnostics=[],[]
    for layer in layers:
        texture=load_texture(path=package/layer['path'],sha256=layer['sha256'])
        samples,details=rasterize(rgba=texture,positions=positions,
            uv=uv*np.array([texture.shape[1],texture.shape[0]],np.float32),triangles=assets['triangles'],
            floating=True,size=(rgba.shape[1],rgba.shape[0]), coverage_bits=coverage_bits)
        pigment=(samples/255).astype(np.float32)
        if layer.get('customColor'):
            pigment[...,:3]=assets['custom_color']*pigment[...,3:4]
        pigments.append((pigment,layer['mode']))
        diagnostics.append({'mode':layer['mode'],'customColor':bool(layer.get('customColor')),'raster':details})
    result=compose_layers(base=rgba.astype(np.float32)/np.float32(255),pigments=pigments,strength=strength)
    return result,{'layers':diagnostics,'changedPixelCount':int(np.count_nonzero(np.any(result!=rgba,axis=-1)))}
