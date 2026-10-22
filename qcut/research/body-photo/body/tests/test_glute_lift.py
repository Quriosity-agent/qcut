"""Manual contour lifts alter visible shape without treating pose hips as buttocks."""
import copy
import json
import unittest

import numpy as np

from body.cpu_raster import draw_mesh
from body.glute_lift import build_glute_delta, validate_selection
from body.leg_shape import safe_leg_delta


WIDTH, HEIGHT = 800, 1200


def grid(*, width=WIDTH, height=HEIGHT):
    xx, yy = np.meshgrid(np.linspace(0, width, 81), np.linspace(0, height, 81))
    return np.stack((xx, yy), axis=-1).astype(np.float32)


def triangles():
    faces = []
    for row in range(80):
        for col in range(80):
            start = row * 81 + col
            faces.extend(((start, start + 81, start + 82), (start, start + 82, start + 1)))
    return np.asarray(faces, dtype=np.uint32)


def side(*, direction="right"):
    peak_x, fold_x = (.65, .60) if direction == "right" else (.35, .40)
    return {"view": f"side-{direction}", "anchors": [{"peak": [peak_x, .48], "fold": [fold_x, .60]}]}


def rear():
    return {"view": "rear", "anchors": [{"peak": [.36, .48], "fold": [.37, .60]},
                                        {"peak": [.64, .48], "fold": [.63, .60]}]}


def areas(*, positions):
    vertices = positions.reshape(-1, 2)[triangles()]
    first, second = vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0]
    return first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]


class GluteLiftTests(unittest.TestCase):
    def setUp(self):
        self.base = grid()

    def build(self, *, selection=None, intensity=100, base=None, width=WIDTH, height=HEIGHT):
        return build_glute_delta(base=self.base if base is None else base, width=width, height=height,
                                  intensity=intensity, selection=side() if selection is None else selection)

    def test_zero_is_exact_identity_without_contour_or_pose(self):
        delta, detail = build_glute_delta(base=self.base, width=WIDTH, height=HEIGHT,
                                          intensity=0, selection=None)
        np.testing.assert_array_equal(delta, 0)
        self.assertEqual(delta.dtype, np.float32)
        self.assertEqual(detail["reason"], "zero")
        self.assertFalse(detail["contourLandmarksDetected"])

    def test_explicit_selection_is_canonical_and_does_not_mutate_caller(self):
        selection = rear()
        selection["anchors"].reverse()
        before = copy.deepcopy(selection)
        result = validate_selection(selection=selection)
        self.assertEqual(selection, before)
        self.assertLess(result["anchors"][0]["peak"][0], result["anchors"][1]["peak"][0])
        result["anchors"][0]["peak"][0] = .2
        self.assertEqual(selection, before)

    def test_side_peak_and_fold_rise_differently_instead_of_translating_a_patch(self):
        selected = side()
        xy = np.asarray([selected["anchors"][0][key] for key in ("peak", "fold")]) * [WIDTH, HEIGHT]
        base = xy.copy()
        base[:, 1] = HEIGHT - base[:, 1]
        delta, detail = self.build(selection=selected, base=base)
        span = xy[1, 1] - xy[0, 1]
        np.testing.assert_allclose(delta[:, 1], [.16 * span, .32 * span], atol=1e-5)
        np.testing.assert_allclose(delta[:, 0], [.10 * span, .02 * span], atol=1e-5)
        destination = base + delta
        self.assertAlmostEqual(float(destination[0, 1] - destination[1, 1]), .84 * span, places=4)
        self.assertEqual(detail["anchorSource"], "user-supplied-manual-contour")
        self.assertFalse(detail["reconstructs3D"])
        self.assertFalse(detail["landmarksAreDetectedJoints"])
        anchor = detail["anchors"][0]
        np.testing.assert_allclose(anchor["requestedFoldAfter"], xy[1] + [delta[1, 0], -delta[1, 1]])

    def test_side_left_right_are_exact_mirrors(self):
        right, _ = self.build(selection=side(direction="right"))
        left, _ = self.build(selection=side(direction="left"))
        np.testing.assert_allclose(left[..., 0], -right[:, ::-1, 0], atol=2e-5)
        np.testing.assert_allclose(left[..., 1], right[:, ::-1, 1], atol=2e-5)
        self.assertLess(float(left[..., 0].min()), -10)
        self.assertGreater(float(right[..., 0].max()), 10)

    def test_rear_lifts_two_lobes_without_blanket_width_or_double_lifting(self):
        delta, detail = self.build(selection=rear())
        np.testing.assert_array_equal(delta[..., 0], 0)
        np.testing.assert_allclose(delta[..., 1], delta[:, ::-1, 1], atol=2e-5)
        self.assertGreater(float(delta[..., 1].max()), 40)
        self.assertLessEqual(float(delta[..., 1].max()), .32 * .12 * HEIGHT + 1e-5)
        self.assertEqual(len(detail["anchors"]), 2)
        self.assertEqual(detail["support"]["sideProjectionFraction"], 0)

    def test_strength_increases_monotonically_with_distinct_contour_shape(self):
        previous = np.zeros_like(self.base)
        full, _ = self.build()
        for value in (25, 50, 75, 100):
            with self.subTest(value=value):
                delta, detail = self.build(intensity=value)
                self.assertTrue(detail["moved"])
                np.testing.assert_allclose(delta, full * value / 100, atol=4e-6)
                self.assertTrue(np.all(delta[..., 1] >= previous[..., 1]))
                previous = delta
                json.dumps(detail, allow_nan=False)

    def test_compact_support_pins_waist_knees_face_feet_and_canvas_border(self):
        for selection in (side(), side(direction="left"), rear()):
            with self.subTest(view=selection["view"]):
                delta, detail = self.build(selection=selection)
                np.testing.assert_array_equal(delta[[0, -1]], 0)
                np.testing.assert_array_equal(delta[:, [0, -1]], 0)
                top_y = HEIGHT - self.base[..., 1]
                support = detail["support"]["boundsXYXY"]
                lower = min(bound[1] for bound in support)
                upper = max(bound[3] for bound in support)
                np.testing.assert_array_equal(delta[(top_y <= lower) | (top_y >= upper)], 0)
                np.testing.assert_array_equal(delta[top_y < 350], 0)
                np.testing.assert_array_equal(delta[top_y > 900], 0)

    def test_full_strength_grid_has_positive_area_without_consuming_combined_guard(self):
        reference = areas(positions=self.base)
        for selection in (side(), side(direction="left"), rear()):
            with self.subTest(view=selection["view"]):
                delta, _ = self.build(selection=selection)
                ratios = areas(positions=self.base + delta) / reference
                self.assertGreater(float(ratios.min()), .5)
                accepted, scale = safe_leg_delta(base=self.base, existing_delta=np.zeros_like(self.base),
                                                 leg_delta=delta, triangles=triangles())
                self.assertEqual(scale, 1.)
                np.testing.assert_array_equal(accepted, delta)

    def test_wide_aspect_and_maximum_oblique_accepted_side_are_unfolded(self):
        for width, height in ((1600, 800), (800, 1600), (800, 800)):
            for direction in ("left", "right"):
                with self.subTest(width=width, height=height, direction=direction):
                    selected = {"view": f"side-{direction}", "anchors": [{"peak": [.5, .45], "fold": [.5, .57]}]}
                    offset = .12 * height / width * (.95 if direction == "left" else -.95)
                    selected["anchors"][0]["fold"][0] += offset
                    base = grid(width=width, height=height)
                    delta, _ = self.build(base=base, width=width, height=height, selection=selected)
                    ratios = areas(positions=base + delta) / areas(positions=base)
                    self.assertGreater(float(ratios.min()), .40)

    def test_actual_raster_shifts_a_visible_outline_and_preserves_distant_pixels(self):
        width, height = 240, 360
        base = grid(width=width, height=height)
        selected = {"view": "side-right", "anchors": [{"peak": [.65, .48], "fold": [.60, .60]}]}
        delta, _ = self.build(base=base, width=width, height=height, selection=selected)
        yy, xx = np.mgrid[:height, :width]
        rgba = np.zeros((height, width, 4), np.uint8)
        rgba[..., :3], rgba[..., 3] = [15, 20, 25], 255
        outline = width * .45 + width * .20 * np.exp(-((yy - height * .48) / (height * .10)) ** 2)
        silhouette = (xx > width * .30) & (xx <= outline) & (yy > height * .2) & (yy < height * .9)
        rgba[silhouette, :3] = [215, 130, 85]
        dimensions = np.asarray([width, height])
        vertices = np.concatenate(((base + delta) / dimensions * 2 - 1,
                                    np.zeros((*base.shape[:2], 1)), base / dimensions), axis=-1)
        actual, _ = draw_mesh(rgba=rgba, vertices=vertices.reshape(-1, 5), triangles=triangles(), runtime=None)
        np.testing.assert_array_equal(actual[:100], rgba[:100])
        np.testing.assert_array_equal(actual[280:], rgba[280:])
        changed = np.any(actual != rgba, axis=-1)
        self.assertGreater(int(changed.sum()), 250)
        peak_y = round(height * .48)
        previous_x = np.max(np.flatnonzero(silhouette[peak_y]))
        visible = np.any(actual[peak_y - 3:peak_y + 1, previous_x + 1:previous_x + 4, 0] > 100)
        self.assertTrue(visible)

    def test_tall_crop_side_projection_keeps_the_canvas_feather_unfolded(self):
        selections = [
            {"view": "side-left", "anchors": [{"peak": [.258328599, .356372260],
                                                "fold": [.405537341, .545815040]}]},
            {"view": "side-left", "anchors": [{"peak": [.281304594, .526577378],
                                                "fold": [.249931766, .715940619]}]},
        ]
        base = grid(width=800, height=1600)
        for selected in selections:
            with self.subTest(selection=selected):
                delta, _ = self.build(base=base, width=800, height=1600, selection=selected)
                self.assertGreater(float((areas(positions=base + delta) / areas(positions=base)).min()), .50)
                np.testing.assert_array_equal(delta[:, [0, -1]], 0)

    def test_cropped_lower_thigh_uses_actual_pinned_feather_without_changing_anchors(self):
        selected = {"view": "side-right", "anchors": [{"peak": [.65, .80], "fold": [.60, .95]}]}
        before = copy.deepcopy(selected)
        delta, detail = self.build(selection=selected)
        lobe = detail["support"]["lobes"][0]
        self.assertTrue(detail["support"]["cropAdapted"])
        self.assertTrue(lobe["cropAdapted"])
        self.assertEqual(lobe["bottomY"], HEIGHT - HEIGHT / 80)
        self.assertAlmostEqual(lobe["lowerFeatherPixels"], .25 * .15 * HEIGHT)
        self.assertEqual(selected, before)
        self.assertEqual(detail["anchors"][0]["sourceFold"], [.60 * WIDTH, .95 * HEIGHT])
        self.assertGreater(float((areas(positions=self.base + delta) / areas(positions=self.base)).min()), .5)
        top_y = HEIGHT - self.base[..., 1]
        np.testing.assert_array_equal(delta[top_y >= lobe["bottomY"]], 0)
        clipped = copy.deepcopy(selected)
        clipped["anchors"][0]["fold"][1] += 1 / HEIGHT
        with self.assertRaisesRegex(ValueError, "lower-thigh feathering room"):
            self.build(selection=clipped)

    def test_short_contour_requires_two_lower_mesh_rows_even_when_quarter_span_is_smaller(self):
        selected = {"view": "side-right", "anchors": [{"peak": [.65, .875], "fold": [.60, .9625]}]}
        _, detail = self.build(selection=selected)
        self.assertAlmostEqual(detail["support"]["lobes"][0]["lowerFeatherPixels"], 2 * HEIGHT / 80)
        selected["anchors"][0]["fold"][1] += 1 / HEIGHT
        with self.assertRaisesRegex(ValueError, "lower-thigh feathering room"):
            self.build(selection=selected)

    def test_invalid_schema_and_untrusted_coordinate_values_are_rejected(self):
        invalid = [None, {}, [], {**side(), "radius": .2}, {**side(), "view": "front"},
                   {**side(), "view": []}, {**side(), "anchors": []},
                   {**side(), "anchors": [side()["anchors"][0]] * 2},
                   {"view": "rear", "anchors": [side()["anchors"][0]] * 2},
                   {"view": "rear", "anchors": [{"peak": [.3, .4], "fold": [.7, .5]},
                                                  {"peak": [.7, .4], "fold": [.3, .5]}]}]
        for value in (True, None, float("nan"), float("inf"), "0.4", -.01, 1.01):
            selected = side()
            selected["anchors"][0]["peak"][0] = value
            invalid.append(selected)
        for selected in invalid:
            with self.subTest(selection=selected), self.assertRaises(ValueError):
                validate_selection(selection=selected)

    def test_nonanatomical_or_unresolved_clipped_contours_are_refused(self):
        invalid = []
        for peak, fold in (([.65, .5], [.6, .51]), ([.65, .5], [.6, .5]),
                           ([.65, .5], [.6, .49]), ([.65, .15], [.6, .4]),
                           ([.65, .65], [.6, .97]), ([.01, .45], [.01, .6]),
                           ([.9, .45], [.99, .6]), ([.7, .4], [.3, .52])):
            invalid.append({"view": "side-right", "anchors": [{"peak": peak, "fold": fold}]})
        invalid.extend(({"view": "side-left", "anchors": [{"peak": [.5, .4], "fold": [.2, .52]}]},
                        {"view": "rear", "anchors": [{"peak": [.49, .45], "fold": [.49, .57]},
                                                        {"peak": [.51, .45], "fold": [.51, .57]}]}))
        for selected in invalid:
            with self.subTest(selection=selected), self.assertRaises(ValueError):
                self.build(selection=selected)

    def test_invalid_geometry_or_strength_never_silently_coerces(self):
        for value in (True, 1.5, -1, 101, "100", None):
            with self.subTest(intensity=value), self.assertRaises(ValueError):
                self.build(intensity=value)
        for value in (True, 0, float("nan"), float("inf"), "800", 32769):
            with self.subTest(width=value), self.assertRaises(ValueError):
                self.build(width=value)
        invalid = [[], [[True, False]], [[-1, 10]], [[800, 1201]], [[0, float("nan")]],
                   [["0", "0"]], np.zeros((81, 81, 3)), np.zeros((100, 100, 2))]
        for base in invalid:
            with self.subTest(shape=np.shape(base)), self.assertRaises(ValueError):
                self.build(base=base)


if __name__ == "__main__":
    unittest.main()
