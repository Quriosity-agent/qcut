"""No GPU: fixed-gain pixel math and fail-closed candidate ownership flags."""
import copy
from pathlib import Path
import tempfile
import unittest

from PIL import Image

import face_feature_campaign_evidence as evidence


class EvidenceTests(unittest.TestCase):
    def accepted(self):
        candidate = dict(profile="actual-preprocess-owned-chain-v1", failures=[])
        for name in ("passed", "completed", "geometry_exact", "final_consumer_parity", "independent_120_sampling_input_used",
                     "independent_160_sampling_input_used", "owned_initialization_used", "owned_temporal_smoothing_used"):
            candidate[name] = True
        for name in ("captured_tensor_input_used", "native_final_point_input_used", "native_160_sampling_input_required",
                     "native_inference_called", "native_analysis_bypassed", "diagnostic_only", "product_parity_verified",
                     "arbitrary_frame_backend_connected"):
            candidate[name] = False
        rendered = dict(profile="actual-preprocess-owned-chain-render-v1", failures=[], passed=True, completed=True,
                        external_replay_verified=True, pixel_parity_verified=True, native_analysis_bypassed=False,
                        product_parity_verified=False, arbitrary_frame_backend_connected=False)
        proof = dict(profile="actual-preprocess-owned-chain-audit-v1", failures=[], passed=True, completed=True,
            geometry_exact=True, final_consumer_parity=True, pixel_parity_verified=True, external_replay_verified=True,
            fixed_profile_only=True, native_execution_performed=False, inference_performed=False,
            product_parity_verified=False, arbitrary_frame_backend_connected=False, independent_full_frame_preprocessing=False)
        return dict(candidate=candidate, rendered=rendered, proof=proof)

    def test_owned_audited_flags_accepted(self):
        evidence.acceptance(**self.accepted())

    def test_every_acceptance_flag_fails_closed_on_missing_wrong_type_or_value(self):
        original = self.accepted()
        for group, row in original.items():
            for name, value in row.items():
                if type(value) is not bool:
                    continue
                for bad in (None, int(value), not value):
                    values = copy.deepcopy(original)
                    values[group][name] = bad
                    with self.subTest(group=group, name=name, bad=bad), self.assertRaises(ValueError):
                        evidence.acceptance(**values)

    def test_native_160_temporal_route_is_not_owned_candidate_parity(self):
        values = self.accepted()
        values["candidate"]["independent_160_sampling_input_used"] = False
        values["candidate"]["native_160_sampling_input_required"] = True
        with self.assertRaises(ValueError):
            evidence.acceptance(**values)

    def test_profiles_and_failure_lists_required(self):
        for group in self.accepted():
            for key, value in (("profile", "temporal-only"), ("failures", ["partial"]), ("failures", None)):
                values = self.accepted()
                values[group][key] = value
                with self.subTest(group=group, key=key), self.assertRaises(ValueError):
                    evidence.acceptance(**values)

    def test_pngs_fixed_gain_saturation_alpha_and_exact_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = dict(original=bytes([0, 0, 0, 255, 0, 0, 0, 255]),
                          native=bytes([1, 2, 3, 255, 32, 0, 0, 250]),
                          candidate=bytes([1, 2, 3, 255, 32, 0, 0, 250]))
            row = evidence.frame_pngs(pixels=pixels, directory=directory, index=0, width=2, height=1)
            self.assertEqual(len(list(directory.glob("*.png"))), 6)
            with Image.open(directory / row["metrics"]["original-native"]["path"]) as image:
                self.assertEqual(image.mode, "L")
                self.assertEqual(image.tobytes(), bytes([24, 255]))
            self.assertEqual(row["metrics"]["original-native"]["alpha_max"], 5)
            self.assertEqual(row["metrics"]["native-candidate"]["changed_pixels"], 0)
            for role in pixels:
                with Image.open(directory / row["files"][role]["path"]) as image:
                    self.assertEqual(image.tobytes(), pixels[role])

    def test_alpha_only_difference_cannot_hide_behind_black_rgb_diff(self):
        with tempfile.TemporaryDirectory() as temporary:
            pixels = dict(original=bytes([0, 0, 0, 255]), native=bytes([0, 0, 0, 255]), candidate=bytes([0, 0, 0, 0]))
            row = evidence.frame_pngs(pixels=pixels, directory=Path(temporary), index=0, width=1, height=1)
            self.assertEqual(row["metrics"]["native-candidate"]["rgb_max"], 0)
            self.assertEqual(row["metrics"]["native-candidate"]["alpha_max"], 255)
            self.assertEqual(row["metrics"]["native-candidate"]["changed_pixels"], 1)

    def test_partial_images_rejected_before_any_png(self):
        with tempfile.TemporaryDirectory() as temporary:
            for pixels in ({"original": b""}, dict(original=b"", native=b"", candidate=b"")):
                with self.assertRaises(ValueError):
                    evidence.frame_pngs(pixels=pixels, directory=Path(temporary), index=0, width=1, height=1)
            self.assertEqual(list(Path(temporary).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
