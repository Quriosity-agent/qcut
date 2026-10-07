"""Build fixed-order dynamic pigments on one independently derived Extra248 mesh."""
import numpy as np

from brow_assets import CARDS as BROW_CARDS, load_assets as load_brows
from dynamic_makeup_controls import GEOMETRY_FAMILIES, normalize_selections
from eye_assets import card_spec as eye_spec, load_assets as load_eye
from makeup_geometry import points_array
from shadow_assets import card_spec as shadow_spec, load_assets as load_shadow
from makeup248_assets import card_spec as face_spec, load_assets as load_face
from makeup_pigment_pass import build_pass
from softpink_assets import card_spec as lip_spec, load_assets as load_lip
from softpink_render import resolve_spec


def selection_pass(*, positions, category, selection, runtime):
    selection = normalize_selections(selections={category: selection})[category]
    family = GEOMETRY_FAMILIES[category]
    points_array(value=positions, count=174 if family == 'eye174' else 248)
    card, strength = selection['cardId'], selection['intensity']/100
    details = {'category': category, 'geometryFamily': family, **selection}
    if category == 'brows':
        assets = load_brows(path=runtime/'research/brow-v1.npz')
        assets = assets | {'position_scale': np.ones(2, np.float32)}
        package, identity = BROW_CARDS[card]
        spec = {'package': package, 'layers': ({'path': 'image/eyebrow/eyebrow.png',
            'sha256': identity, 'mode': 'multiply'},)}
        name = 'Brow'
    elif category in ('contour', 'blush'):
        spec = face_spec(card=card)
        assets = load_face(path=runtime/f'research/{card}-v1.npz', card=card)
        name = 'Stereo' if category == 'contour' else 'Blusher'
    elif category in ('eyeliner', 'aegyo'):
        spec = eye_spec(card=card)
        assets = load_eye(path=runtime/f'research/{card}-v1.npz', card=card)
        name = 'Eyeline' if category == 'eyeliner' else 'Eyemazing'
    elif category == 'eyeshadow':
        spec = shadow_spec(card=card)
        assets = load_shadow(path=runtime/f'research/{card}-v1.npz', card=card)
        name = 'Eyeshadow'
    elif category == 'lip':
        spec, material = resolve_spec(positions=positions, spec=lip_spec(card=card))
        assets = load_lip(path=runtime/f'research/{card}-v1.npz', card=card)
        details['materialSelection'] = material
        name = 'Lip'
    else:
        raise ValueError('unsupported dynamic pigment category')
    return build_pass(positions=positions, assets=assets, layers=spec['layers'],
        package=runtime/'Cache/effect'/spec['package'], strength=strength, name=name), details
