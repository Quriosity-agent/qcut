"""Bounded selections for the shared Extra248 pigment stage."""
from numbers import Real

import numpy as np

from brow_assets import CARDS as BROW_CARDS
from eye_assets import CARDS as EYE_CARDS
from shadow_assets import CARD as SHADOW_CARD

CARDS = {'contour': ('contour-mixed',), 'blush': ('blush-baby-pink',),
         'brows': tuple(BROW_CARDS), 'eyeshadow': (SHADOW_CARD,),
         'eyeliner': tuple(card for card in EYE_CARDS if card.startswith('eyeliner-')),
         'aegyo': tuple(card for card in EYE_CARDS if card.startswith('aegyo-')), 'lip': ('lip-soft-pink',)}
ORDER = ('contour', 'blush', 'brows', 'eyeliner', 'eyeshadow', 'aegyo', 'lip')
GEOMETRY_FAMILIES = {category: 'eye174' if category in ('eyeshadow', 'eyeliner', 'aegyo') else 'face248'
                     for category in ORDER}


def normalize_selections(*, selections):
    if not isinstance(selections, dict) or set(selections)-set(CARDS):
        raise ValueError('supported dynamic makeup categories required')
    result = {}
    for category in ORDER:
        if category not in selections:
            continue
        selected = selections[category]
        if (not isinstance(selected, dict) or set(selected) != {'cardId', 'intensity'}
                or selected['cardId'] not in CARDS[category]):
            raise ValueError('pinned dynamic makeup card in its own category required')
        intensity = selected['intensity']
        if (isinstance(intensity, (bool, np.bool_)) or not isinstance(intensity, Real)
                or not np.isfinite(intensity) or not 0 <= intensity <= 100):
            raise ValueError('dynamic makeup intensity must be a finite number in 0..100')
        result[category] = {'cardId': selected['cardId'], 'intensity': float(intensity)}
    return result


def active_selections(*, selections):
    return {category: selection for category, selection in normalize_selections(selections=selections).items()
            if selection['intensity']/100 > .001}
