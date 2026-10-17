"""Explicit adapters from canonical stage parameters to the existing renderers."""
import importlib
from pathlib import Path

from facefitting_image import decode_image
from render_resolution import source_edge_limit


IMAGE_PARAMETERS = {
    'smooth_render.py': {'strength': float},
    'whiten_render.py': {'strength': float},
    'portrait_features_render.py': {'controls': 'json'},
    'dynamic_makeup_render.py': {'selections': 'json'},
}
RGBA_PARAMETERS = {
    'spot_acne_render.py': {'intensity': float},
    'skin_gan_render.py': {'yunfu': float, 'fuling': float, 'contour': float},
    'youtai_render.py': {'intensity': float},
    'jawline_render.py': {'intensity': float},
    'lip_render.py': {'strength': float, 'texture_state': str},
    'makeup3d_render.py': {'card': str, 'intensity': float},
    'manual_body_render.py': {'manual_body': 'json'},
    **{f'{name}_render.py': {'card': str, 'strength': float} for name in
       ('softpink', 'brow', 'makeup248', 'eye', 'lashes', 'shadow', 'look', 'contacts')},
}


def stage_parameters(*, script, parameters):
    from independent_pipeline import parse_json
    contract = IMAGE_PARAMETERS.get(script, RGBA_PARAMETERS.get(script))
    if contract is None or len(parameters) % 2:
        raise ValueError('renderer has no resident parameter contract')
    result = {}
    for index in range(0, len(parameters), 2):
        flag, value = parameters[index:index + 2]
        name = flag.removeprefix('--').replace('-', '_')
        if not flag.startswith('--') or name not in contract or name in result:
            raise ValueError('unsupported or duplicate resident renderer parameter')
        converter = contract[name]
        result[name] = parse_json(data=value.encode()) if converter == 'json' else converter(value)
    return result


def run_stage(*, stage, source, image, runtime, output, report, face_reference=None, source_evidence=None):
    script = stage['script']
    parameters = stage_parameters(script=script, parameters=stage['parameters'])
    module = importlib.import_module(script.removesuffix('.py'))
    if Path(module.__file__).resolve() != source.resolve():
        raise ValueError('resident renderer module does not match its verified source')
    arguments = {'runtime': runtime, 'output': output, 'report': report, **parameters}
    if source_evidence is not None:
        if script != 'portrait_features_render.py':
            raise ValueError('renderer has no source evidence contract')
        arguments['source_evidence'] = source_evidence
    if script in IMAGE_PARAMETERS:
        arguments['image'] = image
    else:
        arguments['rgba'] = decode_image(image=image, max_edge=source_edge_limit())['rgba']
    if script == 'lip_render.py':
        arguments['assets_path'] = runtime / 'research/lip-v1.npz'
        if face_reference is not None:
            arguments['face_reference'] = face_reference
    elif face_reference is not None:
        raise ValueError('renderer has no same-photo face identity contract')
    module.run(**arguments)
