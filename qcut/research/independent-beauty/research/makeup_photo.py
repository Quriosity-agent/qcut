"""Shared original-photo inference and independent pigment rendering lifecycle."""
import hashlib
import json
import time

import numpy as np
from PIL import Image

from extra_photo import predict_extra_photo
from facefitting_infer import native_images
from makeup_blend import unit_scalar
from makeup_geometry import original_pixels
from makeup_layers import render_layers
from slimface_render import validate_rgba


def render_photo(*, rgba, card, strength, runtime, output, report, spec, scope, geometry, asset_loader,
                 layer_renderer=render_layers, spec_resolver=None):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    strength = unit_scalar(value=strength, name='makeup strength')
    prediction = None
    material_selection = None
    result = rgba.copy()
    diagnostics = {'identity': True, 'layers': []}
    if strength > .001:
        if np.any(rgba[..., 3] != 255):
            raise ValueError('active makeup acceptance requires an opaque photo')
        prediction = predict_extra_photo(rgba=rgba, model_root=runtime/'research', interleave_alignment=True)
        points = original_pixels(points=np.array(prediction['points'], np.float32),
            algorithm_size=prediction['algorithmSize'], image_size=(rgba.shape[1], rgba.shape[0]))
        positions = geometry(points=points, runtime=runtime)
        if spec_resolver is not None:
            spec, material_selection = spec_resolver(positions=positions, spec=spec)
        assets = asset_loader(path=runtime/f'research/{card}-v1.npz', card=card)
        result, diagnostics = layer_renderer(rgba=rgba, positions=positions, assets=assets,
            layers=spec['layers'], package=runtime/'Cache/effect'/spec['package'], strength=strength,
            coverage_bits=spec.get('coverageBits'))
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent makeup loaded private native libraries')
    receipt = {'scope': scope, 'cardId': card, 'strength': float(strength),
        'extra': prediction, 'width': rgba.shape[1], 'height': rgba.shape[0], 'diagnostics': diagnostics,
        'materialSelection': material_selection,
        'fixedLandmarks': False, 'nativeGeometryUsed': False, 'privateAssetDependency': prediction is not None,
        'independence': independence, 'videoVerified': False, 'nativeProductParityVerified': False,
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
        'milliseconds': round((time.monotonic()-started)*1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    return receipt
