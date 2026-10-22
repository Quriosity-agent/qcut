"""Manual image strokes have bounded support, explicit validation, and no folds."""
import copy
import unittest

import numpy as np

from body.local_shape import build_manual_positions, validate_edits


def grid(*, width=1000, height=1600, rows=80, columns=80):
    x = np.linspace(0, width, columns + 1, dtype=np.float32)
    y = np.linspace(0, height, rows + 1, dtype=np.float32)
    return np.stack(np.meshgrid(x, y), axis=-1)


def stroke(*, start=None, end=None, radius=.2):
    return {"start": [.5, .5] if start is None else start,
            "end": [.55, .5] if end is None else end, "radius": radius}


def areas(*, positions):
    a, b = positions[:-1, :-1], positions[:-1, 1:]
    c, d = positions[1:, :-1], positions[1:, 1:]
    cross = lambda first, second: first[..., 0] * second[..., 1] - first[..., 1] * second[..., 0]
    return np.stack((cross(c - a, d - a), cross(d - a, b - a)), axis=-1)


class EditContractTests(unittest.TestCase):
    def test_absent_fields_have_explicit_backward_compatible_defaults(self):
        expected = {"backgroundProtection": False, "strokes": []}
        self.assertEqual(validate_edits(), expected)
        self.assertEqual(validate_edits(edits={}), expected)
        self.assertEqual(validate_edits(edits={"backgroundProtection": True}),
                         {"backgroundProtection": True, "strokes": []})

    def test_canonical_payload_owns_its_lists_and_preserves_order(self):
        original = {"backgroundProtection": True, "strokes": [stroke(), stroke(end=[.45, .5])]}
        frozen = copy.deepcopy(original)
        result = validate_edits(edits=original)
        self.assertEqual(result, original)
        result["strokes"][0]["start"][0] = 0
        result["strokes"].append(stroke())
        self.assertEqual(original, frozen)

    def test_rejects_unknown_fields_nonlists_and_non_boolean_protection(self):
        invalid = [False, [], "", {"extra": 1}, {"backgroundProtection": 1},
                   {"backgroundProtection": None}, {"strokes": {}}, {"strokes": None},
                   {"strokes": tuple()}, {"strokes": [stroke()] * 33}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_edits(edits=value)

    def test_stroke_fields_are_complete_and_exact(self):
        for value in [None, [], {}, {"start": [.5, .5], "end": [.5, .5]},
                      {**stroke(), "strength": 1}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_edits(edits={"strokes": [value]})

    def test_points_and_radius_require_finite_real_json_numbers(self):
        for field in ("start", "end"):
            invalid = [None, {}, (.5, .5), [0], [0, 0, 0], [True, .5], ["0", .5],
                       [-.01, .5], [1.01, .5], [float("nan"), .5], [float("inf"), .5]]
            for value in invalid:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    validate_edits(edits={"strokes": [{**stroke(), field: value}]})
        for value in [None, True, ".2", float("nan"), float("inf"), -.2, .019, .301]:
            with self.subTest(radius=value), self.assertRaises(ValueError):
                validate_edits(edits={"strokes": [stroke(radius=value)]})
        with self.assertRaises(ValueError):
            validate_edits(edits={"strokes": [stroke(radius=10 ** 1000)]})

    def test_inclusive_coordinate_radius_and_stroke_count_limits(self):
        values = [stroke(start=[0, 0], end=[1, 1], radius=.02),
                  stroke(start=[1, 1], end=[0, 0], radius=.3)] * 16
        self.assertEqual(len(validate_edits(edits={"strokes": values})["strokes"]), 32)


class LocalShapeTests(unittest.TestCase):
    def setUp(self):
        self.base = grid()

    def build(self, *, strokes, base=None, width=1000, height=1600):
        return build_manual_positions(base=self.base if base is None else base, strokes=strokes,
                                      width=width, height=height)

    def test_empty_and_zero_drag_preserve_original_exactly(self):
        for values in ([], [stroke(end=[.5, .5])]):
            with self.subTest(values=values):
                result, report = self.build(strokes=values)
                np.testing.assert_array_equal(result, self.base)
                self.assertEqual(result.dtype, np.float32)
                self.assertFalse(np.shares_memory(result, self.base))
                self.assertFalse(report["moved"])

    def test_drag_center_reaches_endpoint_and_y_is_converted_from_top_left(self):
        for end, expected in (([.55, .5], [550, 800]), ([.45, .5], [450, 800]),
                              ([.5, .45], [500, 880]), ([.5, .55], [500, 720])):
            with self.subTest(end=end):
                result, report = self.build(strokes=[stroke(end=end)])
                np.testing.assert_allclose(result[40, 40], expected, atol=1e-5)
                self.assertEqual(report["strokes"][0]["scale"], 1)
                self.assertTrue(report["moved"])
                self.assertGreater(report["strokes"][0]["affectedVertices"], 0)

    def test_pixels_outside_compact_source_support_and_entire_border_are_exact(self):
        result, _ = self.build(strokes=[stroke()])
        outside = np.linalg.norm(self.base - [500, 800], axis=-1) >= 200
        np.testing.assert_array_equal(result[outside], self.base[outside])
        np.testing.assert_array_equal(result[[0, -1]], self.base[[0, -1]])
        np.testing.assert_array_equal(result[:, [0, -1]], self.base[:, [0, -1]])

    def test_near_border_drag_cannot_move_perimeter_or_escape_canvas(self):
        result, report = self.build(strokes=[stroke(start=[.02, .5], end=[.01, .5])])
        self.assertTrue(report["moved"])
        np.testing.assert_array_equal(result[:, 0], self.base[:, 0])
        np.testing.assert_array_equal(result[:, -1], self.base[:, -1])
        np.testing.assert_array_equal(result[[0, -1]], self.base[[0, -1]])
        self.assertGreaterEqual(float(np.min(result)), 0)
        self.assertLessEqual(float(np.max(result[..., 0])), 1000)
        self.assertTrue(np.all(areas(positions=result) < 0))

    def test_radius_uses_short_edge_and_pixel_circle_on_portrait_and_landscape(self):
        for width, height in ((1000, 1600), (1600, 1000), (500, 2000)):
            with self.subTest(width=width, height=height):
                base = grid(width=width, height=height)
                radius_pixels = .2 * min(width, height)
                values = [stroke(end=[.5 + .2 * radius_pixels / width, .5])]
                result, report = self.build(strokes=values, base=base, width=width, height=height)
                self.assertAlmostEqual(report["strokes"][0]["radiusPixels"], radius_pixels)
                np.testing.assert_allclose(result[40, 40] - base[40, 40],
                                           [radius_pixels * .2, 0], atol=1e-5)
                outside = np.linalg.norm(base - [width / 2, height / 2], axis=-1) >= radius_pixels
                np.testing.assert_array_equal(result[outside], base[outside])

    def test_pixel_displacement_limit_checks_anisotropic_image_before_mutation(self):
        original = self.base.copy()
        for value in (stroke(end=[.601, .5]), stroke(end=[.5, .563])):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.build(strokes=[stroke(), value])
        np.testing.assert_array_equal(self.base, original)
        result, _ = self.build(strokes=[stroke(end=[.6, .5])])
        np.testing.assert_allclose(result[40, 40], [600, 800], atol=1e-5)

    def test_strokes_are_sequential_in_current_image_coordinates(self):
        first = stroke(end=[.55, .5])
        second = stroke(start=[.55, .5], end=[.55, .55])
        result, report = self.build(strokes=[first, second])
        np.testing.assert_allclose(result[40, 40], [550, 720], atol=1e-5)
        self.assertEqual([value["scale"] for value in report["strokes"]], [1, 1])
        reversed_result, _ = self.build(strokes=[second, first])
        self.assertFalse(np.array_equal(result, reversed_result))

    def test_inputs_remain_untouched(self):
        original_base = self.base.copy()
        values = [stroke(), stroke(start=[.55, .5], end=[.56, .5])]
        original_values = copy.deepcopy(values)
        self.build(strokes=values)
        np.testing.assert_array_equal(self.base, original_base)
        self.assertEqual(values, original_values)

    def test_support_metadata_is_in_source_top_left_coordinates(self):
        _, report = self.build(strokes=[stroke(end=[.5, .45])])
        detail = report["strokes"][0]
        self.assertEqual(detail["start"], [.5, .5])
        self.assertEqual(detail["end"], [.5, .45])
        self.assertEqual(detail["centerPixels"], [500, 800])
        self.assertEqual(detail["requestedPixels"], [0, -80])
        self.assertEqual(detail["radiusPixels"], 200)

    def test_32_overlapping_drags_never_fold_or_collapse_below_initial_area_floor(self):
        for end in ([.6, .5], [.5, .5625], [.56, .54]):
            with self.subTest(end=end):
                result, report = self.build(strokes=[stroke(end=end)] * 32)
                reference = areas(positions=self.base.astype(np.float64))
                actual = areas(positions=result.astype(np.float64))
                self.assertTrue(np.all(actual * np.sign(reference) >= abs(reference) * .02))
                self.assertEqual(len(report["strokes"]), 32)
                self.assertTrue(any(item["scale"] < 1 for item in report["strokes"]))

    def test_no_mesh_sample_in_tiny_brush_is_explicit_noop(self):
        base = grid(rows=2, columns=2)
        result, report = self.build(base=base,
                                   strokes=[stroke(start=[.25, .25], end=[.255, .25], radius=.02)])
        np.testing.assert_array_equal(result, base)
        self.assertFalse(report["moved"])
        self.assertEqual(report["strokes"][0]["scale"], 0)
        self.assertIn("misses", report["strokes"][0]["reason"])

    def test_existing_fold_or_degenerate_mesh_fails_closed(self):
        for folded in (True, False):
            base = self.base.copy()
            base[40, 40] = base[39 if folded else 40, 41]
            result, report = self.build(base=base, strokes=[stroke()])
            np.testing.assert_array_equal(result, base)
            self.assertFalse(report["safe"])
            self.assertEqual(report["strokes"][0]["affectedVertices"], 0)
            self.assertIn("folded or degenerate", report["strokes"][0]["reason"])

    def test_already_deformed_safe_mesh_is_used_without_resetting_existing_geometry(self):
        base = self.base.copy()
        base[..., 0] += np.sin(base[..., 0] / 1000 * np.pi) * 20
        result, report = self.build(base=base, strokes=[stroke(start=[.52, .5], end=[.57, .5])])
        np.testing.assert_allclose(result[40, 40], [570, 800], atol=1e-5)
        np.testing.assert_array_equal(result[70], base[70])
        self.assertTrue(report["safe"])

    def test_existing_outside_canvas_body_vertices_remain_fixed(self):
        base = self.base.copy()
        base[..., 1] = (base[..., 1] - 800) * 1.2 + 800
        outside = (base[..., 1] < 0) | (base[..., 1] > 1600)
        result, report = self.build(base=base, strokes=[stroke()])
        self.assertTrue(report["moved"])
        np.testing.assert_array_equal(result[outside], base[outside])
        self.assertTrue(np.all(result >= np.minimum(0, base)))
        self.assertTrue(np.all(result <= np.maximum([1000, 1600], base)))
        np.testing.assert_allclose(result[40, 40], [550, 800], atol=1e-5)

    def test_invalid_dimensions_mesh_shape_bounds_and_renderer_limit_are_rejected(self):
        for value in [0, -1, True, float("nan"), float("inf"), "1000"]:
            with self.subTest(width=value), self.assertRaises(ValueError):
                self.build(strokes=[], width=value)
        invalid = [np.zeros((20, 2)), np.zeros((1, 4, 2)), np.zeros((4, 4, 3)),
                   np.full((4, 4, 2), np.nan), grid(rows=100, columns=100)]
        for base in invalid:
            with self.subTest(shape=base.shape), self.assertRaises(ValueError):
                self.build(strokes=[], base=base)


if __name__ == "__main__":
    unittest.main()
