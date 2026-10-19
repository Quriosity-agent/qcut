"""Model-free contracts for the native WidenShoulder MattingResult branch."""

from pathlib import Path
import hashlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from body_composition.grid import make_grid
from body_composition.segmentation_mask import sample_grid_mask, validate_segmentation_mask
from body_composition.widen_shoulder.temporal_geometry import WidenHistory


def shoulder_state(*, frame=0):
    points = np.array([[160, 350], [130, 340], [190, 340], [100, 260], [220, 260]], np.float32)
    points[:, 0] += np.float32(frame * 3)
    return {"enabled": True, "points": points, "intensity": 0.3,
            "history_invalid": frame == 0, "flip": False, "segmentation": False}


class MaskInput(unittest.TestCase):
    def test_input_is_owned_contiguous_uint8_and_none_is_absence(self):
        supplied = np.arange(30, dtype=np.uint8).reshape(5, 6)[:, ::2]
        accepted = validate_segmentation_mask(mask=supplied)
        self.assertTrue(accepted.flags.c_contiguous)
        np.testing.assert_array_equal(accepted, supplied)
        supplied.fill(0)
        self.assertGreater(int(accepted.sum()), 0)
        self.assertIsNone(validate_segmentation_mask(mask=None))

    def test_invalid_shapes_types_and_size_limits_are_rejected(self):
        values = [[], [[1]], np.ones((2, 3)), np.ones((2, 3), bool),
                  np.zeros((0, 3), np.uint8), np.ones((2, 3, 1), np.uint8),
                  np.zeros((1, 16385), np.uint8),
                  np.broadcast_to(np.uint8(1), (4097, 4096))]
        for mask in values:
            with self.subTest(shape=getattr(mask, "shape", None)), self.assertRaises(ValueError):
                validate_segmentation_mask(mask=mask)

    def test_native_grid_sampling_flips_y_and_expands_a_cross(self):
        mask = np.zeros((8, 8), np.uint8)
        mask[5, 3] = 1
        expected = np.zeros((8, 8), bool)
        expected[2, 4] = expected[1, 4] = expected[3, 4] = True
        expected[2, 3] = expected[2, 5] = True
        np.testing.assert_array_equal(sample_grid_mask(mask=mask, rows=7, cols=7), expected)
        mask[5, 3] = 255
        np.testing.assert_array_equal(sample_grid_mask(mask=mask, rows=7, cols=7), expected)

    def test_single_pixel_masks_cover_all_grid_vertices_or_none(self):
        for value in (0, 1, 127, 255):
            grid = sample_grid_mask(mask=np.array([[value]], np.uint8), rows=75, cols=60)
            self.assertEqual(grid.shape, (76, 61))
            self.assertTrue(np.all(grid == bool(value)))


@unittest.skipUnless(sys.platform == "darwin", "native float32 geometry uses macOS libm")
class ShoulderMaskHistory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.grid, _, _ = make_grid(320, 480, rows=30, cols=30)

    def test_zero_mask_restricts_radius_but_does_not_zero_the_effect(self):
        full, outside = WidenHistory(), WidenHistory()
        _, full_delta = full.step(self.grid, shoulder_state(), segmentation_mask=np.ones((7, 11), np.uint8))
        _, outside_delta = outside.step(self.grid, shoulder_state(), segmentation_mask=np.zeros((7, 11), np.uint8))
        self.assertTrue(np.any(outside_delta))
        self.assertFalse(np.array_equal(full_delta, outside_delta))

    def test_absence_retains_mask_and_replacement_changes_its_shape(self):
        retained, repeated = WidenHistory(), WidenHistory()
        mask = np.zeros((7, 11), np.uint8)
        mask[:, :5] = 1
        retained.step(self.grid, shoulder_state(), segmentation_mask=mask)
        repeated.step(self.grid, shoulder_state(), segmentation_mask=mask)
        mask.fill(255)
        self.assertTrue(np.any(retained.segmentation_mask == 0))
        state = shoulder_state(frame=1)
        _, actual = retained.step(self.grid, state)
        _, expected = repeated.step(self.grid, shoulder_state(frame=1), segmentation_mask=repeated.segmentation_mask)
        np.testing.assert_array_equal(actual, expected)
        self.assertTrue(state["segmentation"])
        retained.step(self.grid, shoulder_state(frame=2), segmentation_mask=np.ones((3, 4), np.uint8))
        self.assertEqual(retained.segmentation_mask.shape, (3, 4))

    def test_mask_bytes_are_membership_not_alpha(self):
        one, full = WidenHistory(), WidenHistory()
        for frame in range(3):
            _, a = one.step(self.grid, shoulder_state(frame=frame), segmentation_mask=np.ones((5, 8), np.uint8))
            _, b = full.step(self.grid, shoulder_state(frame=frame), segmentation_mask=np.full((5, 8), 255, np.uint8))
            np.testing.assert_array_equal(a, b)
            self.assertEqual(one.alpha, full.alpha)

    def test_mask_can_be_replaced_while_body_geometry_is_inactive(self):
        history = WidenHistory()
        state = shoulder_state()
        state["points"] = np.full((5, 2), -1, np.float32)
        on, _ = history.step(self.grid, state, segmentation_mask=np.ones((3, 5), np.uint8))
        self.assertFalse(on)
        np.testing.assert_array_equal(history.segmentation_mask, np.ones((3, 5), np.uint8))

    def test_native_golden_covers_mask_replacement_warm_reset_and_mode_changes(self):
        from test_body_composition import synthetic_inputs
        from body_composition.controls import validate_controls
        from body_composition.native_video import NativeVideoBody

        body = NativeVideoBody()
        controls = {"WidenShoulderTest": 15}
        _, targets = validate_controls(controls=controls)
        digest = hashlib.sha256()
        for frame, timestamp in enumerate((0., 1 / 30, 2 / 30, .5, .5, .51)):
            inputs = synthetic_inputs()
            inputs["coords"][:, 0] += np.float32(frame * .008)
            mask = None
            if frame in (0, 3):
                mask = np.zeros((7, 11), np.uint8)
                mask[:, :5] = 1
                if frame == 3:
                    mask = 1 - mask
            body.configure_frame(timestamp=timestamp)
            body.configure_controls(controls=controls)
            result = body.update(**inputs, targets=targets, segmentation_mask=mask)
            digest.update(result["positions"].tobytes())
            digest.update(body.widen_history.history.raw.tobytes())
        # Native MattingResult producer + original ten-part system, invented points only.
        self.assertEqual(digest.hexdigest(), "8e3273b27198754ebc70f650556d34991030326c1cc920342b7752337637cfa4")


if __name__ == "__main__":
    unittest.main()
