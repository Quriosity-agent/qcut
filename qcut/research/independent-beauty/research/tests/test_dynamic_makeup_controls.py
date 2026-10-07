from copy import deepcopy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dynamic_makeup_controls import CARDS, ORDER, active_selections, normalize_selections


class DynamicMakeupControlTests(unittest.TestCase):
    def test_categories_are_canonical_and_nested_input_is_owned(self):
        selections = {category: {'cardId': CARDS[category][0], 'intensity': np.float64(37)}
                      for category in reversed(ORDER)}
        original = deepcopy(selections)
        normalized = normalize_selections(selections=selections)
        self.assertEqual(tuple(normalized), ORDER)
        self.assertEqual(selections, original)
        normalized['lip']['intensity'] = 80
        self.assertEqual(selections['lip']['intensity'], 37)
        self.assertIsInstance(normalized['blush']['intensity'], float)

    def test_all_pinned_cards_have_bounded_intensity(self):
        for category, cards in CARDS.items():
            for card in cards:
                for intensity in (0, 100):
                    with self.subTest(category=category, card=card, intensity=intensity):
                        expected = {category: {'cardId': card, 'intensity': float(intensity)}}
                        self.assertEqual(normalize_selections(selections=expected), expected)

    def test_active_threshold_is_strict_and_does_not_round_small_values_up(self):
        for intensity, active in ((0, False), (.099, False), (.1, False), (.101, True)):
            selections = {'lip': {'cardId': CARDS['lip'][0], 'intensity': intensity}}
            self.assertEqual(bool(active_selections(selections=selections)), active)
        self.assertEqual(active_selections(selections={}), {})

    def test_invalid_category_card_schema_and_intensity_are_rejected(self):
        invalid = [None, [], {'eyes': {'cardId': 'blush-baby-pink', 'intensity': 50}},
            {'brows': {'cardId': 'lip-soft-pink', 'intensity': 50}}, {'lip': None},
            {'lip': {'cardId': 'lip-soft-pink'}},
            {'lip': {'cardId': 'lip-soft-pink', 'intensity': 50, 'fixedLandmarks': True}}]
        invalid += [{'lip': {'cardId': 'lip-soft-pink', 'intensity': value}}
                    for value in (True, np.bool_(False), '50', np.nan, np.inf, -1, 101)]
        for selections in invalid:
            with self.subTest(selections=selections), self.assertRaises(ValueError):
                normalize_selections(selections=selections)


if __name__ == '__main__':
    unittest.main()
