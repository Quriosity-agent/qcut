"""A clone callback is not pixel-consumer or lifetime proof on its own."""

import unittest

import face_owned_binding_e2e as probe


def events() -> list[dict]:
    return [{"event": "owned_face_conversion", "faces": 1, "eye_shift": 0.01,
             "raw_clone_verified": True, "original_restored": False,
             "native_analysis_bypassed": False},
            {"event": "owned_face_restored", "gpu_complete": True, "original_restored": True}]


class BindingTests(unittest.TestCase):
    def test_valid_roi(self):
        probe.validate_roi(roi=[0, 0, 8, 6], width=8, height=6)

    def test_bad_roi(self):
        for roi in ([0, 0, 8], [0, 0, 9, 6], [-1, 0, 8, 6], [1, 2, 1, 3],
                    [0, 0, 8, 7], [False, 0, 8, 6], [0.0, 0, 8, 6]):
            with self.subTest(roi=roi), self.assertRaises(ValueError):
                probe.validate_roi(roi=roi, width=8, height=6)

    def test_shift_inside_roi(self):
        probe.validate_shift(metrics={"equal": False, "changed_pixels": 1, "bbox": [2, 2, 3, 3]},
                             roi=[1, 1, 5, 5])

    def test_callback_without_pixel_changes_is_rejected(self):
        with self.assertRaises(RuntimeError):
            probe.validate_shift(metrics={"equal": True, "changed_pixels": 0, "bbox": None},
                                 roi=[1, 1, 5, 5])

    def test_outside_roi_is_rejected(self):
        for bbox in ([0, 2, 3, 3], [2, 0, 3, 3], [2, 2, 6, 3], [2, 2, 3, 6], None):
            with self.subTest(bbox=bbox), self.assertRaises(RuntimeError):
                probe.validate_shift(metrics={"equal": False, "changed_pixels": 1, "bbox": bbox},
                                     roi=[1, 1, 5, 5])

    def test_conversion_and_completion_required(self):
        self.assertEqual(probe.validate_conversions(events=events(), shift=0.01), 1)

    def test_missing_stages(self):
        for value in ([], events()[:1], events()[1:], events() + events()[1:]):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                probe.validate_conversions(events=value, shift=0.01)

    def test_conversion_metadata(self):
        for key, value in (("eye_shift", -0.01), ("faces", 0), ("raw_clone_verified", False),
                           ("original_restored", True), ("native_analysis_bypassed", True)):
            example = events()
            example[0][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                probe.validate_conversions(events=example, shift=0.01)

    def test_completion_metadata(self):
        for key in ("gpu_complete", "original_restored"):
            example = events()
            example[1][key] = False
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                probe.validate_conversions(events=example, shift=0.01)


if __name__ == "__main__":
    unittest.main()
