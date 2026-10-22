"""Exercise automatic contour composition through the actual CPU rasterizer."""
import hashlib
import unittest
from unittest.mock import patch

import numpy as np

from body import portable_engine, region_render
from body.glute_analysis import PROVIDER, analyze_contours, unavailable_detection
from body.photo_controls import validate_photo_controls
from body.tests import test_region_render as fixture_module


def selection():
    return {"view": "side-right", "anchors": [{"peak": [.60, .50], "fold": [.58, .65]}]}


class AutoGluteRenderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.RegionRenderIntegrationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.digest = hashlib.sha256(self.fixture.rgba.tobytes()).hexdigest()
        self.detected = {"provider": PROVIDER, "available": True, "confidence": .84,
                         "inputRgbaSha256": self.digest, "anatomicalLandmarksDetected": False,
                         "selection": selection()}
        self.unavailable = unavailable_detection(source_hash=self.digest, reason="臀下缘遮挡，需手动校正")

    def render(self, *, controls, auto=True, manual=None, protect=False):
        fx = self.fixture
        return region_render.run(engine=fx.engine, rgba=fx.rgba,
            controls=validate_photo_controls(controls=controls, extended=True),
            edits={"backgroundProtection": protect, "strokes": [], "autoButtocks": auto,
                   **({"buttocks": manual} if manual else {})},
            runtime=fx.work, output=fx.output, report=fx.report,
            mask_provider=fx.mask, background_compositor=fx.compositor)

    def test_automatic_selection_changes_actual_pixels_with_source_bound_and_non_anatomical_evidence(self):
        fx = self.fixture
        with patch.object(region_render, "analyze_contours", return_value=self.detected) as analyze:
            receipt = self.render(controls={"ButtLift": 100})
        lift = receipt["parts"]["ButtLift"]
        self.assertTrue(lift["moved"])
        self.assertEqual(lift["anchorSource"], "automatic-pose-silhouette-contour")
        self.assertTrue(lift["contourLandmarksDetected"])
        self.assertFalse(lift["anatomicalLandmarksDetected"])
        self.assertFalse(lift["reconstructs3D"])
        self.assertEqual(receipt["photoEdits"]["buttocksDetection"], self.detected)
        self.assertIs(analyze.call_args.kwargs["rgba"], fx.rgba)
        self.assertIs(analyze.call_args.kwargs["person_mask"], fx.data["person_mask"])
        self.assertIs(analyze.call_args.kwargs["pose"], fx.pose)
        self.assertGreater(receipt["changedPixels"], 0)
        np.testing.assert_array_equal(fx.pixels()[:65], fx.original[:65])
        np.testing.assert_array_equal(fx.pixels()[220:], fx.original[220:])
        self.assertEqual(len(fx.draws), 1)
        fx.assert_receipt_pixels(receipt=receipt)

    def test_unavailable_auto_never_falls_back_to_old_joint_lift_even_with_reliable_joints(self):
        fx = self.fixture
        with patch.object(region_render, "analyze_contours", return_value=self.unavailable), \
             patch.object(region_render, "build_region_delta", wraps=region_render.build_region_delta) as build:
            receipt = self.render(controls={"ButtLift": 100})
        self.assertEqual(build.call_args.kwargs["controls"]["ButtLift"], 0)
        self.assertIs(build.call_args.kwargs["pose"], fx.pose)
        self.assertFalse(receipt["parts"]["ButtLift"]["moved"])
        self.assertFalse(receipt["parts"]["ButtLift"]["contourLandmarksDetected"])
        self.assertEqual(receipt["parts"]["ButtLift"]["reason"], self.unavailable["reason"])
        self.assertEqual(receipt["changedPixels"], 0)
        fx.engine.draw_mesh.assert_not_called()
        np.testing.assert_array_equal(fx.pixels(), fx.original)
        fx.assert_receipt_pixels(receipt=receipt)

    def test_unavailable_auto_keeps_other_control_output_pixel_identical_to_its_independent_run(self):
        fx = self.fixture
        baseline = fx.run_region(controls={"Abdomen": 80, "BodySkinTone": -30})
        before = fx.pixels().copy()
        with patch.object(region_render, "analyze_contours", return_value=self.unavailable):
            receipt = self.render(controls={"ButtLift": 100, "Abdomen": 80, "BodySkinTone": -30})
        np.testing.assert_array_equal(fx.pixels(), before)
        self.assertFalse(receipt["parts"]["ButtLift"]["moved"])
        self.assertTrue(receipt["parts"]["Abdomen"]["moved"])
        self.assertTrue(receipt["parts"]["BodySkinTone"]["moved"])
        self.assertEqual(receipt["changedPixels"], baseline["changedPixels"])
        fx.assert_receipt_pixels(receipt=receipt)

    def test_manual_points_override_auto_without_running_analysis_or_requiring_pose(self):
        fx = self.fixture
        fx.pose = None
        fx.perception["coarsePeople"] = 0
        with patch.object(region_render, "analyze_contours") as analyze:
            receipt = self.render(controls={"ButtLift": 100, "Abdomen": 70}, manual=selection())
        analyze.assert_not_called()
        fx.mask.assert_not_called()
        lift = receipt["parts"]["ButtLift"]
        self.assertTrue(lift["moved"])
        self.assertEqual(lift["anchorSource"], "user-supplied-manual-contour")
        self.assertFalse(lift["contourLandmarksDetected"])
        self.assertNotIn("buttocksDetection", receipt["photoEdits"])
        self.assertFalse(receipt["parts"]["Abdomen"]["moved"])
        self.assertEqual(receipt["edits"]["buttocks"], selection())
        fx.assert_receipt_pixels(receipt=receipt)

    def test_auto_false_retains_exact_legacy_joint_lift_and_does_not_run_detection(self):
        fx = self.fixture
        baseline = fx.run_region(controls={"ButtLift": 100})
        pixels = fx.pixels().copy()
        with patch.object(region_render, "analyze_contours") as analyze:
            receipt = self.render(controls={"ButtLift": 100}, auto=False)
        analyze.assert_not_called()
        np.testing.assert_array_equal(fx.pixels(), pixels)
        self.assertEqual(receipt["parts"]["ButtLift"], baseline["parts"]["ButtLift"])
        self.assertNotIn("buttocksDetection", receipt["photoEdits"])
        fx.assert_receipt_pixels(receipt=receipt)

    def test_automatic_zero_still_analyzes_for_import_but_writes_exact_original_pixels(self):
        fx = self.fixture
        with patch.object(region_render, "analyze_contours", return_value=self.detected) as analyze:
            receipt = self.render(controls={"ButtLift": 0})
        analyze.assert_called_once()
        self.assertEqual(receipt["changedPixels"], 0)
        self.assertFalse(receipt["parts"]["ButtLift"]["moved"])
        self.assertEqual(receipt["photoEdits"]["buttocksDetection"], self.detected)
        self.assertEqual(receipt["inputRgbaSha256"], receipt["outputRgbaSha256"])
        fx.engine.draw_mesh.assert_not_called()
        fx.assert_receipt_pixels(receipt=receipt)

    def test_auto_protection_reuses_single_segmentation_and_same_final_photo_and_mask_geometry(self):
        fx = self.fixture
        with patch.object(region_render, "analyze_contours", return_value=self.detected):
            receipt = self.render(controls={"ButtLift": 100}, protect=True)
        fx.mask.assert_called_once()
        self.assertEqual(receipt["photoEdits"]["backgroundProtection"]["changedProtectedPixels"], 0)
        self.assertEqual(len(fx.draws), 2)
        np.testing.assert_array_equal(fx.draws[0]["vertices"], fx.draws[1]["vertices"])
        np.testing.assert_array_equal(fx.draws[0]["triangles"], fx.draws[1]["triangles"])
        fx.assert_receipt_pixels(receipt=receipt)

    def test_segmentation_failure_disables_auto_but_does_not_disable_other_unprotected_geometry(self):
        fx = self.fixture
        fx.mask.side_effect = ValueError("unreliable segmentation")
        with patch.object(region_render, "analyze_contours", wraps=analyze_contours) as analyze:
            receipt = self.render(controls={"ButtLift": 100, "Abdomen": 80})
        self.assertIsNone(analyze.call_args.kwargs["person_mask"])
        self.assertIn("unreliable segmentation", analyze.call_args.kwargs["mask_error"])
        self.assertFalse(receipt["photoEdits"]["buttocksDetection"]["available"])
        self.assertFalse(receipt["parts"]["ButtLift"]["moved"])
        self.assertTrue(receipt["parts"]["Abdomen"]["moved"])
        fx.assert_receipt_pixels(receipt=receipt)

    def test_auto_adapter_routes_even_zero_controls_to_analysis_without_changing_legacy_zero_route(self):
        fx = self.fixture
        adapter = portable_engine.PortableEngine(engine=fx.engine, body_root=fixture_module.ROOT)
        controls = validate_photo_controls(controls={}, extended=True)
        arguments = {"rgba": fx.rgba, "runtime": fx.work, "output": fx.output, "report": fx.report}
        with patch.object(region_render, "run", return_value="automatic") as regions, \
             patch.object(portable_engine.edit_render, "run", return_value="legacy-zero"):
            self.assertEqual(adapter.run(controls=controls, edits={"backgroundProtection": False,
                "strokes": [], "autoButtocks": True}, **arguments), "automatic")
            self.assertIs(regions.call_args.kwargs["engine"], adapter)
            self.assertEqual(adapter.run(controls=controls, **arguments), "legacy-zero")
            self.assertEqual(regions.call_count, 1)


if __name__ == "__main__":
    unittest.main()
