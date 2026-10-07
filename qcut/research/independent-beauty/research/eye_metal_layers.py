"""Independent single-pass Metal blending for the pinned 174-point eye cards."""
import numpy as np

from makeup_metal import render
from makeup_pigment_pass import build_pass


def render_layers(*, rgba, positions, assets, layers, package, strength, runtime,
                  coverage_bits=None, pass_name='Eyeline'):
    profiles = {'Eyeline': ('multiply',), 'Eyemazing': ('multiply', 'screen')}
    if (pass_name not in profiles or coverage_bits is not None or positions.shape != (174, 2)
            or tuple(layer['mode'] for layer in layers) != profiles[pass_name]):
        raise ValueError('pinned single-pass eye profile required')
    passes = [build_pass(positions=positions, assets=assets, layers=layers,
        package=package, strength=strength, name=pass_name)]
    result, gpu = render(rgba=rgba, passes=passes, runtime=runtime)
    return result, {'layers': [{'mode': layer['mode']} for layer in layers], 'gpu': gpu,
        'texturePremultiplication': 'integer-alpha-plus-one-div256',
        'changedPixelCount': int(np.count_nonzero(np.any(result != rgba, axis=-1)))}
