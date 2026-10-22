import unittest

import numpy as np

from body.skin_blemish import soften_small_spots
from body.skin_mask import rgb_to_lab


def patch(*, skin=(188, 132, 105), textured=True, size=560):
    yy, xx = np.mgrid[:size, :size]
    shading = (xx - size / 2) * .025 + (yy - size / 2) * .018
    noise = np.random.default_rng(29).uniform(-2, 2, (size, size)) if textured else 0
    rgb = np.clip(np.asarray(skin) + (shading + noise)[..., None], 0, 255).astype(np.uint8)
    mask = np.ones((size, size), np.float32)
    return rgb, mask


def render(*, rgb, mask, value=100, repair_guard=None):
    target, weight, effective_mask, diagnostics = soften_small_spots(
        rgb=rgb, mask=mask, value=value, repair_guard=repair_guard)
    result = np.clip(np.rint(rgb + (target - rgb) * (weight * effective_mask)[..., None]), 0, 255).astype(np.uint8)
    return result, diagnostics


class SkinBlemishTests(unittest.TestCase):
    def test_multiple_spot_sizes_soften_and_clean_texture_stays_exact(self):
        clean, mask = patch()
        spotted = clean.copy()
        regions = []
        for y, radius, darkness in ((140, 0, 20), (280, 1, 45), (420, 2, 60)):
            region = np.s_[y - radius:y + radius + 1, 280 - radius:280 + radius + 1]
            spotted[region] = np.maximum(spotted[region].astype(int) - darkness, 0)
            regions.append(region)
        result, diagnostics = render(rgb=spotted, mask=mask)
        self.assertEqual(diagnostics['acceptedSpots'], 3)
        for region in regions:
            before = np.abs(spotted[region].astype(float) - clean[region]).mean()
            after = np.abs(result[region].astype(float) - clean[region]).mean()
            self.assertLess(after, before * .2)
        untouched = np.ones(mask.shape, bool)
        for y in (140, 280, 420):
            untouched[y - 4:y + 5, 276:285] = False
        np.testing.assert_array_equal(result[untouched], spotted[untouched])

    def test_zero_and_increasing_strength_have_fixed_locality_and_no_overshoot(self):
        clean, mask = patch(textured=False)
        spotted = clean.copy()
        spotted[270:273, 270:273] -= 35
        previous = spotted.copy()
        for value in (0, 25, 50, 75, 100):
            result, _ = render(rgb=spotted, mask=mask, value=value)
            if not value:
                np.testing.assert_array_equal(result, spotted)
            else:
                self.assertTrue(np.all(result[270:273, 270:273] > previous[270:273, 270:273]))
                self.assertTrue(np.all(result[270:273, 270:273] <= clean[270:273, 270:273]))
            previous = result

    def test_dark_and_light_skin_use_local_surrounding_colour(self):
        for skin in ((218, 170, 145), (82, 49, 34), (52, 34, 27)):
            with self.subTest(skin=skin):
                clean, mask = patch(skin=skin, textured=False)
                spotted = clean.copy()
                spotted[279:282, 279:282] = np.maximum(spotted[279:282, 279:282].astype(int) - 20, 0)
                result, diagnostics = render(rgb=spotted, mask=mask)
                self.assertEqual(diagnostics['acceptedSpots'], 1)
                self.assertLess(np.abs(result[279:282, 279:282].astype(float) - clean[279:282, 279:282]).mean(), 3)
                source_lab = rgb_to_lab(rgb=clean)[280, 280]
                result_lab = rgb_to_lab(rgb=result)[280, 280]
                self.assertLess(np.linalg.norm(source_lab[1:] - result_lab[1:]), 1.5)

    def test_large_marks_and_long_tattoo_lines_are_not_repaired(self):
        rgb, mask = patch(textured=False)
        rgb[100:124, 100:124] = (60, 35, 25)
        rgb[220:300, 220:222] = (35, 25, 20)
        for i in range(70):
            rgb[350 + i, 350 + i] = (50, 30, 20)
        result, diagnostics = render(rgb=rgb, mask=mask)
        np.testing.assert_array_equal(result, rgb)
        self.assertEqual(diagnostics['acceptedSpots'], 0)

    def test_shadow_and_coloured_garment_edges_are_not_repaired(self):
        rgb, mask = patch(textured=False)
        rgb[:, :220] = np.maximum(rgb[:, :220].astype(int) - 45, 0)
        rgb[280:, 280:] = (125, 110, 25)
        result, diagnostics = render(rgb=rgb, mask=mask)
        np.testing.assert_array_equal(result, rgb)
        self.assertEqual(diagnostics['acceptedSpots'], 0)

    def test_spot_next_to_unreliable_mask_is_not_filled_from_clothing(self):
        rgb, mask = patch(textured=False)
        rgb[279:282, 279:282] -= 30
        mask[:, 283:] = 0
        rgb[:, 283:] = (20, 25, 160)
        result, diagnostics = render(rgb=rgb, mask=mask)
        np.testing.assert_array_equal(result, rgb)
        self.assertEqual(diagnostics['acceptedSpots'], 0)

    def test_dense_high_frequency_texture_fails_closed(self):
        rgb, mask = patch(textured=False)
        rgb[::2, ::2] = np.maximum(rgb[::2, ::2].astype(int) - 40, 0)
        result, diagnostics = render(rgb=rgb, mask=mask)
        np.testing.assert_array_equal(result, rgb)
        self.assertEqual(diagnostics['acceptedSpots'], 0)

    def test_repeatable_without_mutating_source_or_mask(self):
        rgb, mask = patch()
        rgb[279:282, 279:282] -= 30
        source, support = rgb.copy(), mask.copy()
        first, diagnostics = render(rgb=rgb, mask=mask)
        second, repeated = render(rgb=rgb, mask=mask)
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(rgb, source)
        np.testing.assert_array_equal(mask, support)
        self.assertEqual(diagnostics, repeated)

    def test_small_enclosed_hole_has_explicit_additional_support(self):
        clean, mask = patch(textured=False)
        rgb = clean.copy()
        rgb[279:282, 279:282] -= 50
        mask[279:282, 279:282] = 0
        result, diagnostics = render(rgb=rgb, mask=mask, repair_guard=np.ones(mask.shape, bool))
        self.assertEqual(diagnostics['additionalSupportPixels'], 9)
        self.assertEqual(diagnostics['acceptedSpots'], 1)
        self.assertLess(np.abs(result[279:282, 279:282].astype(int) - clean[279:282, 279:282]).mean(), 4)
        self.assertNotEqual(diagnostics['baseMaskSha256'], diagnostics['effectiveMaskSha256'])

    def test_large_holes_and_open_cuts_do_not_extend_support(self):
        for kind in ('large', 'open', 'line'):
            with self.subTest(kind=kind):
                rgb, mask = patch(textured=False)
                if kind == 'large':
                    mask[270:290, 270:290] = 0
                elif kind == 'open':
                    mask[:282, 279:282] = 0
                else:
                    mask[:, 280] = 0
                rgb[279:282, 279:282] -= 45
                result, diagnostics = render(rgb=rgb, mask=mask, repair_guard=np.ones(mask.shape, bool))
                np.testing.assert_array_equal(result, rgb)
                self.assertEqual(diagnostics['additionalSupportPixels'], 0)

    def test_head_person_and_alpha_guard_cannot_be_filled(self):
        rgb, mask = patch(textured=False)
        rgb[279:282, 279:282] -= 50
        mask[279:282, 279:282] = 0
        guard = np.ones(mask.shape, bool)
        guard[279:282, 279:282] = False
        result, diagnostics = render(rgb=rgb, mask=mask, repair_guard=guard)
        np.testing.assert_array_equal(result, rgb)
        self.assertEqual(diagnostics['additionalSupportPixels'], 0)


if __name__ == '__main__':
    unittest.main()
