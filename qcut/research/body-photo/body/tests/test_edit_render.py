"""Owned editing composes geometry once and never publishes an unprotected failure."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from body import edit_render
from body.background import protection_alpha
from body.control_contract import validate_controls
from body.local_shape import validate_edits


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("editing_test_grid", ROOT / "engine/research/body_mesh_grid.py")
GRID = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GRID)


class EditingRenderTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="body-edit-render-")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        rows, columns = np.mgrid[:96, :128]
        self.rgba = np.stack((columns, rows * 2, columns + rows,
                              np.full_like(rows, 255)), -1).astype(np.uint8)
        self.mask = np.zeros((96, 128), np.uint8)
        self.mask[12:84, 36:92] = 255
        self.draws = []
        self.engine = SimpleNamespace(draw_mesh=Mock(side_effect=self.draw),
            process_images=lambda: {"private_native_images": []},
            plain=lambda value: json.loads(json.dumps(value, default=lambda array: array.tolist())))
        self.strokes = [{"start": [.5, .5], "end": [.53, .5], "radius": .12}]
        self.base, self.uv, self.triangles, _ = GRID.make_grid(128, 96, 30, 30)
        self.automatic_positions = self.base.copy()
        self.automatic_positions[12:18, 12:18, 0] += 1
        self.auto = Mock(side_effect=self.automatic)
        self.segment = Mock(return_value=(self.mask, {"provider": "test-mask"}))
        for context in (patch.dict(sys.modules, {"body_mesh_grid": GRID}),
                        patch.object(edit_render.leg_render, "run", self.auto),
                        patch.object(edit_render, "get_person_mask", self.segment)):
            context.start()
            self.addCleanup(context.stop)

    def draw(self, **arguments):
        self.draws.append(arguments)
        if arguments["rgba"] is self.rgba:
            result = self.rgba.copy()
            result[..., :3] ^= 64
        else:
            result = np.roll(arguments["rgba"], 3, axis=1)
        return result, {"private_native_images": []}

    def automatic(self, **arguments):
        vertices = GRID.pack_vertices(self.automatic_positions, self.uv, 128, 96)
        arguments["engine"].draw_mesh(rgba=arguments["rgba"], vertices=vertices,
                                      triangles=self.triangles, runtime=arguments["runtime"])
        return {"parts": {"SlimWaist": {"moved": True}}, "reason": None}

    def render(self, *, controls=None, protection=False, strokes=None):
        return edit_render.run(engine=self.engine, rgba=self.rgba,
            controls=validate_controls(controls=controls or {}),
            edits=validate_edits(edits={"backgroundProtection": protection,
                                       "strokes": self.strokes if strokes is None else strokes}),
            runtime=self.work, output=self.work / "result.png", report=self.work / "receipt.json")

    def test_manual_only_does_not_infer_body_pose_or_faces_and_samples_photo_once(self):
        report = self.render()
        self.auto.assert_not_called()
        self.segment.assert_not_called()
        self.engine.draw_mesh.assert_called_once()
        self.assertIs(self.draws[0]["rgba"], self.rgba)
        self.assertEqual(report["photoEdits"]["manual"]["appliedCount"], 1)
        self.assertEqual(report["sampling"], "one photograph warp; person mask uses identical mesh")
        self.assertFalse(report["photoEdits"]["backgroundProtection"]["applied"])

    def test_mask_and_photo_use_exactly_the_same_final_mesh(self):
        report = self.render(protection=True)
        self.assertEqual(len(self.draws), 2)
        photo, mask = self.draws
        self.assertIs(photo["rgba"], self.rgba)
        np.testing.assert_array_equal(photo["vertices"], mask["vertices"])
        np.testing.assert_array_equal(photo["triangles"], mask["triangles"])
        for channel in range(3):
            np.testing.assert_array_equal(mask["rgba"][..., channel], self.mask)
        np.testing.assert_array_equal(mask["rgba"][..., 3], 255)
        self.segment.assert_called_once()
        self.assertIs(self.segment.call_args.kwargs["rgba"], self.rgba)
        alpha, _ = protection_alpha(source_mask=self.mask, warped_mask=np.roll(self.mask, 3, axis=1))
        result = np.array(Image.open(self.work / "result.png"))
        np.testing.assert_array_equal(result[alpha == 0], self.rgba[alpha == 0])
        self.assertEqual(report["photoEdits"]["backgroundProtection"]["changedProtectedPixels"], 0)

    def test_explicit_compositor_receives_the_final_photo_and_mask_without_changing_legacy_default(self):
        compositor = Mock(wraps=edit_render.protect_background)
        arguments = dict(engine=self.engine, rgba=self.rgba, controls=validate_controls(controls={}),
            edits=validate_edits(edits={"backgroundProtection": True, "strokes": self.strokes}),
            runtime=self.work, output=self.work / "result.png", report=self.work / "receipt.json")
        report = edit_render.run(**arguments, background_compositor=compositor)
        compositor.assert_called_once()
        self.assertIs(compositor.call_args.kwargs["original"], self.rgba)
        np.testing.assert_array_equal(compositor.call_args.kwargs["source_mask"], self.mask)
        np.testing.assert_array_equal(compositor.call_args.kwargs["warped_mask"],
                                      np.roll(self.mask, 3, axis=1))
        self.assertEqual(report["photoEdits"]["backgroundProtection"]["changedProtectedPixels"], 0)
        compositor.reset_mock()
        edit_render.run(**arguments)
        compositor.assert_not_called()

    def test_explicit_compositor_failure_cannot_publish_a_successful_receipt(self):
        with self.assertRaisesRegex(ValueError, "background protection: compositor rejected"):
            edit_render.run(engine=self.engine, rgba=self.rgba,
                controls=validate_controls(controls={}),
                edits=validate_edits(edits={"backgroundProtection": True, "strokes": self.strokes}),
                runtime=self.work, output=self.work / "result.png", report=self.work / "receipt.json",
                background_compositor=Mock(side_effect=ValueError("compositor rejected")))
        self.assertFalse((self.work / "result.png").exists())
        self.assertFalse((self.work / "receipt.json").exists())

    def test_automatic_and_manual_capture_geometry_without_an_intermediate_photo_warp(self):
        original_draw = self.engine.draw_mesh
        report = self.render(controls={"SlimWaist": 70}, protection=True)
        self.assertIs(self.engine.draw_mesh, original_draw)
        self.auto.assert_called_once()
        self.assertIsInstance(self.auto.call_args.kwargs["engine"], edit_render.GeometryCapture)
        photos = [draw for draw in self.draws if draw["rgba"] is self.rgba]
        self.assertEqual(len(photos), 1)
        self.assertEqual(photos[0]["vertices"].shape, (81 * 81, 5))
        np.testing.assert_array_equal(photos[0]["vertices"], self.draws[-1]["vertices"])
        self.assertTrue(report["parts"]["SlimWaist"]["moved"])
        self.assertEqual(report["photoEdits"]["manual"]["appliedCount"], 1)
        original = np.array(Image.open(self.work / "result.png"))
        self.assertEqual(report["outputRgbaSha256"], hashlib.sha256(original.tobytes()).hexdigest())

    def test_automatic_only_keeps_original_grid_instead_of_resampling_it(self):
        self.render(controls={"SlimWaist": 70}, strokes=[])
        self.assertEqual(len(self.draws), 1)
        expected = GRID.pack_vertices(self.automatic_positions, self.uv, 128, 96)
        np.testing.assert_allclose(self.draws[0]["vertices"], expected, atol=1e-7, rtol=0)
        self.assertEqual(self.draws[0]["vertices"].shape, (31 * 31, 5))

    def test_no_deformation_does_not_invoke_gpu_or_segmentation(self):
        for strokes in ([], [{"start": [.5, .5], "end": [.5, .5], "radius": .12}]):
            with self.subTest(strokes=strokes):
                report = self.render(protection=True, strokes=strokes)
                self.engine.draw_mesh.assert_not_called()
                self.segment.assert_not_called()
                self.assertEqual(report["changedPixels"], 0)
                self.assertEqual(report["photoEdits"]["manual"]["appliedCount"], 0)
                self.assertFalse(report["photoEdits"]["backgroundProtection"]["applied"])
                np.testing.assert_array_equal(np.array(Image.open(self.work / "result.png")), self.rgba)

    def test_missing_person_never_silently_delivers_the_unprotected_warp(self):
        self.segment.side_effect = ValueError("no reliable person")
        with self.assertRaisesRegex(ValueError, "background protection"):
            self.render(protection=True)
        self.assertFalse((self.work / "result.png").exists())
        self.assertFalse((self.work / "receipt.json").exists())

    def test_corrupted_warped_mask_fails_closed(self):
        original = self.engine.draw_mesh.side_effect

        def corrupt(**arguments):
            result, receipt = original(**arguments)
            if arguments["rgba"] is not self.rgba:
                result[..., :3] = 0
            return result, receipt

        self.engine.draw_mesh.side_effect = corrupt
        with self.assertRaisesRegex(ValueError, "background protection"):
            self.render(protection=True)
        self.assertFalse((self.work / "result.png").exists())

    def test_manual_drag_wholly_on_protected_background_is_not_reported_as_applied(self):
        stroke = {"start": [.08, .5], "end": [.09, .5], "radius": .06}
        report = self.render(protection=True, strokes=[stroke])
        self.assertEqual(report["photoEdits"]["manual"]["appliedCount"], 0)
        self.assertIn("protected background", report["photoEdits"]["manual"]["strokes"][0]["reason"])
        self.assertEqual(report["changedPixels"], 0)
        self.engine.draw_mesh.assert_not_called()
        self.segment.assert_called_once()

    def test_automatic_change_does_not_make_a_blocked_background_drag_count_as_applied(self):
        stroke = {"start": [.08, .5], "end": [.09, .5], "radius": .06}
        report = self.render(controls={"SlimWaist": 70}, protection=True, strokes=[stroke])
        self.assertGreater(report["changedPixels"], 0)
        self.assertEqual(report["photoEdits"]["manual"]["appliedCount"], 0)
        self.assertTrue(report["parts"]["SlimWaist"]["moved"])
        self.assertTrue(report["photoEdits"]["backgroundProtection"]["applied"])

    def test_photo_capture_copies_mesh_to_avoid_solver_mutation(self):
        capture = edit_render.GeometryCapture(engine=self.engine)
        vertices = GRID.pack_vertices(self.base, self.uv, 128, 96)
        triangles = self.triangles.copy()
        result, _ = capture.draw_mesh(rgba=self.rgba, vertices=vertices,
                                     triangles=triangles, runtime=self.work)
        vertices[:] = 0
        triangles[:] = 0
        self.assertTrue(np.any(capture.mesh[0]))
        self.assertTrue(np.any(capture.mesh[1]))
        np.testing.assert_array_equal(result, self.rgba)
        self.assertFalse(np.shares_memory(result, self.rgba))
        self.engine.draw_mesh.assert_not_called()


class EditingPublicWrapperTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="body-edits-wrapper-")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.source, self.output, self.report = [self.work / name for name in ("source.png", "out.png", "out.json")]
        Image.new("RGBA", (64, 64), (60, 110, 150, 255)).save(self.source)
        with patch.object(sys, "path", [str(ROOT), *sys.path]):
            import render
        self.render_module = render
        self.engine = SimpleNamespace(__file__=str(ROOT / "engine/research/body_smart_render.py"),
                                      run=Mock(side_effect=self.legacy))
        for context in (patch.object(render, "verify_installation", return_value={"platformSupported": True}),
                        patch.object(render, "select_backend", return_value="metal"),
                        patch.dict(sys.modules, {"body_smart_render": self.engine})):
            context.start()
            self.addCleanup(context.stop)

    def legacy(self, *, rgba, controls, runtime, output, report):
        result = rgba.copy()
        result[20, 20, 0] ^= 1
        Image.fromarray(result).save(output)
        receipt = {"inputRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
                   "outputRgbaSha256": hashlib.sha256(result.tobytes()).hexdigest(),
                   "changedPixels": 1, "nativeGeometryUsed": False, "fixedLandmarks": False,
                   "independence": {"private_native_images": []}, "parts": {"SlimWaist": {"moved": True}}}
        report.write_text(json.dumps(receipt))
        return receipt

    def test_no_edit_options_keep_the_legacy_route(self):
        for edits in (None, {}):
            with self.subTest(edits=edits):
                self.output.unlink(missing_ok=True)
                self.report.unlink(missing_ok=True)
                fake = SimpleNamespace(run=Mock(side_effect=AssertionError("unexpected editing route")))
                with patch.dict(sys.modules, {"edit_render": fake}):
                    receipt = self.render_module.render_image(image=self.source, controls={"SlimWaist": 20},
                        output=self.output, report=self.report, edits=edits)
                fake.run.assert_not_called()
                self.assertEqual(receipt["actualEffectStatus"], "applied")
        self.assertEqual(self.engine.run.call_count, 2)

    def test_temporary_unprotected_outputs_cannot_escape_when_segmentation_fails(self):
        def fail(**arguments):
            self.legacy(**{key: value for key, value in arguments.items() if key not in ("edits", "engine")})
            raise ValueError("background protection: no reliable person mask")

        fake = SimpleNamespace(run=Mock(side_effect=fail))
        with patch.dict(sys.modules, {"edit_render": fake}):
            with self.assertRaisesRegex(ValueError, "background protection"):
                self.render_module.render_image(image=self.source, controls={"SlimWaist": 20},
                    output=self.output, report=self.report, edits={"backgroundProtection": True})
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())
        self.engine.run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
