"""Independent single-pass Metal blending for the pinned blush and contour cards."""
import numpy as np

from makeup_metal import render
from makeup_pigment_pass import build_pass


def render_layers(*, rgba, positions, assets, layers, package, strength, runtime, pass_name,
                  coverage_bits=None):
    expected_modes = ('multiply', 'normal') if pass_name == 'Blusher' else ('soft-light',)
    if (pass_name not in ('Blusher', 'Stereo') or coverage_bits is not None
            or tuple(layer['mode'] for layer in layers) != expected_modes):
        raise ValueError('pinned single-pass blush or contour profile required')
    if positions.shape != (248, 2):
        raise ValueError('pinned 248-point pigment mesh required')
    passes = [build_pass(positions=positions, assets=assets, layers=layers,
        package=package, strength=strength, name=pass_name)]
    result, gpu = render(rgba=rgba, passes=passes, runtime=runtime)
    return result, {'layers': [{'mode': layer['mode']} for layer in layers], 'gpu': gpu,
        'texturePremultiplication': 'integer-alpha-plus-one-div256',
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
