"""Real CPU composition and publication boundaries for the optional photo controls."""
from contextlib import nullcontext
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

from body import cpu_raster, portable_engine, region_render
from body.backend import AppError, EngineRunner
from body.body_skin import apply_body_skin
from body.control_contract import PUBLIC_CONTROLS, validate_controls
from body.photo_controls import EXTRA_RANGES, REGION_CONTROLS, SKIN_CONTROLS, validate_photo_controls
from body.portable_background import protect_background
from body.tests.test_body_skin import scene


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("region_test_grid", ROOT / "engine/research/body_mesh_grid.py")
GRID = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GRID)


def plain(value):
    return json.loads(json.dumps(value, default=lambda item: item.tolist()))


class RegionRenderIntegrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="body-region-render-")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.data = scene(textured=True)
        self.rgba = self.data["rgba"]
        self.original = self.rgba.copy()
        self.height, self.width = self.rgba.shape[:2]
        self.pose = self.data["pose"]
        self.perception = {"algorithmSize": [self.width, self.height], "coarsePeople": 1}
        self.base, self.uv, self.triangles, _ = GRID.make_grid(self.width, self.height, 30, 30)
        self.positions = self.base.copy()
        self.positions[10:20, 8:22, 0] += .8
        self.draws, self.events = [], []
        self.engine = SimpleNamespace(
            __file__=str(ROOT / "engine/research/body_smart_render.py"),
            load_networks=Mock(return_value=SimpleNamespace(provenance={"testPerception": True})),
            still_pose=Mock(side_effect=lambda **_: (self.pose, self.perception)),
            internal_targets=lambda *, values: {"SlimWaist": values.get("SlimWaist", 0) / 100},
            still_frame=Mock(side_effect=self.frame),
            part_summary=lambda *, result: {"SlimWaist": {"intensity": .1, "moved": True}},
            draw_mesh=Mock(side_effect=self.draw), process_images=lambda: {"private_native_images": []},
            plain=plain, GRID=[30, 30], STILL_UPDATES=1)
        self.mask = Mock(return_value=(self.data["person_mask"], {"provider": "fixture"}))
        self.faces = Mock(return_value=self.data["faces"])
        self.compositor = Mock(wraps=protect_background)
        self.output, self.report = self.work / "result.png", self.work / "receipt.json"
        for context in (patch.dict(sys.modules, {"body_mesh_grid": GRID}),
                        patch.object(region_render, "_face_seeds", self.faces)):
            context.start()
            self.addCleanup(context.stop)

    def frame(self, **_):
        return {"base": self.base, "positions": self.positions, "uv": self.uv,
                "tri": self.triangles}, {"fixture": True}

    def draw(self, **arguments):
        self.events.append("draw")
        self.draws.append(arguments)
        return cpu_raster.draw_mesh(**arguments)

    def run_region(self, *, controls, protection=False, strokes=None, buttocks=None):
        return region_render.run(engine=self.engine, rgba=self.rgba,
            controls=validate_photo_controls(controls=controls, extended=True),
            edits={"backgroundProtection": protection, "strokes": strokes or [],
                   **({"buttocks": buttocks} if buttocks is not None else {})},
            runtime=self.work, output=self.output, report=self.report,
            mask_provider=self.mask, background_compositor=self.compositor)

    def pixels(self):
        with Image.open(self.output) as image:
            return np.array(image.convert("RGBA"))

    def assert_receipt_pixels(self, *, receipt):
        pixels = self.pixels()
        changed = np.count_nonzero(np.any(pixels != self.original, axis=-1))
        self.assertEqual(receipt["changedPixels"], changed)
        self.assertEqual(receipt["inputRgbaSha256"], hashlib.sha256(self.original.tobytes()).hexdigest())
        self.assertEqual(receipt["outputRgbaSha256"], hashlib.sha256(pixels.tobytes()).hexdigest())
        self.assertEqual(json.loads(self.report.read_text())["outputRgbaSha256"], receipt["outputRgbaSha256"])
        np.testing.assert_array_equal(self.rgba, self.original)
        np.testing.assert_array_equal(pixels[..., 3], 255)

    def public_render(self, *, controls, protection=False, backend="cpu", buttocks=None):
        # The CLI uses top-level module names; bind those names to this isolated fixture.
        with patch.object(sys, "path", [str(ROOT), *sys.path]):
            from body import render
        source = self.work / "source.png"
        Image.fromarray(self.rgba).save(source)
        with patch.dict(sys.modules, {"body_smart_render": self.engine, "portable_engine": portable_engine,
                                      "portable_math": SimpleNamespace(portable_math=nullcontext)}), \
             patch.object(render, "verify_installation", return_value={"verified": True}), \
             patch.object(render, "engine_environment", return_value=nullcontext()), \
             patch.object(render, "select_backend", return_value=backend), \
             patch.object(portable_engine, "load_skeleton", self.engine.load_networks), \
             patch.object(portable_engine, "get_native_inventory", self.engine.process_images), \
             patch.object(portable_engine, "get_person_mask", self.mask), \
             patch.object(portable_engine, "protect_background", self.compositor):
            return render.render_image(image=source, controls=controls, output=self.output,
                report=self.report, body_root=ROOT, backend=backend,
                edits={"backgroundProtection": protection, "strokes": [],
                       **({"buttocks": buttocks} if buttocks is not None else {})})

    def test_manual_glute_contour_works_without_pose_and_keeps_other_pose_gates(self):
        self.pose = None
        self.perception["coarsePeople"] = 0
        selection = {"view": "side-right", "anchors": [{"peak": [.60, .50], "fold": [.58, .65]}]}
        receipt = self.public_render(controls={"ButtLift": 100, "Abdomen": 70}, buttocks=selection)
        self.assertEqual(receipt["actualEffectStatus"], "applied")
        lift = receipt["parts"]["ButtLift"]
        self.assertEqual(lift["anchorSource"], "user-supplied-manual-contour")
        self.assertFalse(lift["contourLandmarksDetected"])
        self.assertTrue(lift["moved"])
        self.assertFalse(receipt["parts"]["Abdomen"]["moved"])
        self.assertEqual(receipt["edits"]["buttocks"], selection)
        np.testing.assert_array_equal(self.pixels()[:65], self.original[:65])
        np.testing.assert_array_equal(self.pixels()[220:], self.original[220:])
        self.assert_receipt_pixels(receipt=receipt)

    def test_manual_glute_contour_uses_same_background_mesh(self):
        selection = {"view": "rear", "anchors": [{"peak": [.35, .50], "fold": [.36, .65]},
                                                     {"peak": [.65, .50], "fold": [.64, .65]}]}
        receipt = self.run_region(controls={"ButtLift": 100}, protection=True, buttocks=selection)
        self.assertTrue(receipt["parts"]["ButtLift"]["moved"])
        self.assertEqual(receipt["photoEdits"]["backgroundProtection"]["changedProtectedPixels"], 0)
        photo, final_mask = self.draws[-2:]
        np.testing.assert_array_equal(photo["vertices"], final_mask["vertices"])
        self.assert_receipt_pixels(receipt=receipt)

    def test_metal_rejects_contour_selection_even_at_zero_before_processing(self):
        selection = {"view": "side-right", "anchors": [{"peak": [.60, .50], "fold": [.58, .65]}]}
        with self.assertRaisesRegex(ValueError, "CPU"):
            self.public_render(controls={"SlimWaist": 0}, backend="metal", buttocks=selection)
        self.engine.load_networks.assert_not_called()

    def test_missing_region_joints_preserve_exact_legacy_mesh_and_png(self):
        vertices = GRID.pack_vertices(self.positions, self.uv, self.width, self.height)
        expected, _ = cpu_raster.draw_mesh(rgba=self.rgba, vertices=vertices,
                                          triangles=self.triangles, runtime=self.work)
        original_pose = self.pose.copy()
        cases = [(2, {"Abdomen": 100, "ButtShape": -50}),
                 (10, {"LegStraighten": 100, "AnkleWidth": -50})]
        for missing, requested in cases:
            with self.subTest(missing_joint=missing):
                self.pose = original_pose.copy()
                self.pose[missing, 3] = 0
                self.draws.clear()
                receipt = self.run_region(controls={"SlimWaist": 70, **requested})
                self.assertEqual(len(self.draws), 1)
                np.testing.assert_array_equal(self.draws[0]["vertices"], vertices)
                np.testing.assert_array_equal(self.draws[0]["triangles"], self.triangles)
                np.testing.assert_array_equal(self.pixels(), expected)
                self.assertTrue(receipt["parts"]["SlimWaist"]["moved"])
                for name in requested:
                    self.assertFalse(receipt["parts"][name]["moved"])
                    self.assertIn("joints", receipt["parts"][name]["reason"])
                self.mask.assert_not_called()
                self.assert_receipt_pixels(receipt=receipt)

    def test_skin_is_processed_on_original_before_one_photo_warp(self):
        adjusted = []

        def skin(**arguments):
            self.events.append("skin")
            self.assertIs(arguments["rgba"], self.rgba)
            result = apply_body_skin(**arguments)
            adjusted.append(result[0])
            return result

        with patch.object(region_render, "apply_body_skin", side_effect=skin):
            receipt = self.run_region(controls={"SlimWaist": 70, "Abdomen": 80, "BodySkinTone": -40})
        self.assertEqual(self.events, ["skin", "draw"])
        self.assertEqual(len(self.draws), 1)
        self.assertIs(self.draws[0]["rgba"], adjusted[0])
        self.assertTrue(np.any(adjusted[0] != self.rgba))
        self.assertEqual(len(self.draws[0]["vertices"]), 81 * 81)
        self.assertTrue(receipt["parts"]["BodySkinTone"]["moved"])
        self.assertTrue(receipt["parts"]["Abdomen"]["moved"])
        self.assertTrue(receipt["parts"]["SlimWaist"]["moved"])
        self.assertIs(self.faces.call_args.kwargs["rgba"], self.rgba)
        self.assertIs(self.mask.call_args.kwargs["rgba"], self.rgba)
        self.assert_receipt_pixels(receipt=receipt)

    def test_skin_only_preserves_head_clothing_and_excluded_support_without_a_warp(self):
        receipt = self.run_region(controls={"BodySkinTone": 50, "BodySkinWarmth": -50,
                                            "BodySkinSmooth": 100, "BodyBlemish": 100})
        result = self.pixels()
        np.testing.assert_array_equal(result[:74], self.original[:74])
        np.testing.assert_array_equal(result[85:153, 76:118], self.original[85:153, 76:118])
        np.testing.assert_array_equal(result[self.data["person_mask"] == 0],
                                      self.original[self.data["person_mask"] == 0])
        self.assertGreater(receipt["changedPixels"], 0)
        self.engine.draw_mesh.assert_not_called()
        self.assertEqual(set(receipt["parts"]) & set(EXTRA_RANGES), set(EXTRA_RANGES))
        for name in SKIN_CONTROLS:
            self.assertEqual(receipt["parts"][name]["changedProtectedPixels"], 0)
            self.assertFalse(receipt["parts"][name]["textureGenerated"])
        self.assert_receipt_pixels(receipt=receipt)

    def test_skin_only_background_protection_has_valid_receipt_and_unwarped_mask(self):
        receipt = self.public_render(controls={"BodySkinTone": 50}, protection=True)
        self.compositor.assert_called_once()
        arguments = self.compositor.call_args.kwargs
        np.testing.assert_array_equal(arguments["source_mask"], self.data["person_mask"])
        np.testing.assert_array_equal(arguments["warped_mask"], self.data["person_mask"])
        protection = receipt["photoEdits"]["backgroundProtection"]
        self.assertTrue(protection["requested"])
        self.assertTrue(protection["applied"])
        self.assertEqual(protection["changedProtectedPixels"], 0)
        self.assertGreater(protection["protectedPixels"], 0)
        self.assertFalse(protection["backgroundReconstruction"])
        self.assertEqual(receipt["actualEffectStatus"], "applied")
        self.assertTrue(receipt["parts"]["BodySkinTone"]["moved"])
        self.assert_receipt_pixels(receipt=receipt)

    def test_photo_and_protection_mask_share_final_region_and_manual_mesh(self):
        stroke = {"start": [.5, .52], "end": [.52, .52], "radius": .12}
        receipt = self.run_region(controls={"Abdomen": 100, "BodySkinTone": 50},
                                  protection=True, strokes=[stroke])
        self.assertEqual(len(self.draws), 3)
        guard, photo, final_mask = self.draws
        self.assertTrue(np.all(guard["rgba"][..., 0] == self.data["person_mask"]))
        self.assertFalse(np.array_equal(photo["rgba"], self.rgba))
        np.testing.assert_array_equal(photo["vertices"], final_mask["vertices"])
        np.testing.assert_array_equal(photo["triangles"], final_mask["triangles"])
        self.assertFalse(np.array_equal(guard["vertices"], photo["vertices"]))
        self.assertEqual(receipt["photoEdits"]["manual"]["appliedCount"], 1)
        self.assertEqual(receipt["photoEdits"]["backgroundProtection"]["changedProtectedPixels"], 0)
        self.assert_receipt_pixels(receipt=receipt)

    def test_missing_person_returns_original_and_unavailable_in_public_receipt(self):
        self.pose = None
        self.perception["coarsePeople"] = 0
        receipt = self.public_render(controls={"Abdomen": 100, "BodySkinTone": 50})
        self.assertEqual(receipt["actualEffectStatus"], "unavailable")
        self.assertEqual(receipt["changedPixels"], 0)
        self.assertFalse(receipt["parts"]["Abdomen"]["moved"])
        self.assertFalse(receipt["parts"]["BodySkinTone"]["moved"])
        self.faces.assert_not_called()
        np.testing.assert_array_equal(self.pixels(), self.original)
        self.assert_receipt_pixels(receipt=receipt)

    def test_missing_face_skin_seeds_returns_original_and_unavailable(self):
        self.faces.return_value = None
        receipt = self.public_render(controls={"BodySkinTone": 50})
        self.assertEqual(receipt["actualEffectStatus"], "unavailable")
        self.assertEqual(receipt["parts"]["BodySkinTone"]["reasonCode"], "missing-face-seeds")
        self.assertFalse(receipt["parts"]["BodySkinTone"]["moved"])
        np.testing.assert_array_equal(self.pixels(), self.original)
        self.assert_receipt_pixels(receipt=receipt)

    def test_unavailable_skin_preserves_other_applied_geometry_and_both_part_keys(self):
        self.faces.return_value = None
        receipt = self.public_render(controls={"Abdomen": 100, "BodySkinWarmth": -50})
        self.assertEqual(receipt["actualEffectStatus"], "applied")
        self.assertTrue(receipt["parts"]["Abdomen"]["moved"])
        self.assertFalse(receipt["parts"]["BodySkinWarmth"]["moved"])
        self.assertEqual(receipt["parts"]["BodySkinWarmth"]["reasonCode"], "missing-face-seeds")
        self.assert_receipt_pixels(receipt=receipt)

    def test_all_new_public_part_keys_survive_with_their_actual_requested_values(self):
        self.pose[9, 0] += 3
        self.pose[12, 0] -= 3
        values = {"Abdomen": 80, "ButtLift": 60, "ButtShape": -40, "LegStraighten": 80,
                  "AnkleWidth": -40, "BodySkinTone": 40, "BodySkinWarmth": -30,
                  "BodySkinSmooth": 75, "BodyBlemish": 60}
        receipt = self.public_render(controls=values)
        self.assertEqual(set(receipt["parts"]), set(PUBLIC_CONTROLS) | set(EXTRA_RANGES))
        for name, value in values.items():
            self.assertEqual(receipt["controls"][name], value)
            self.assertIn("moved", receipt["parts"][name])
            self.assertIn("intensity", receipt["parts"][name])
        self.assertTrue(all(receipt["parts"][name]["moved"] for name in REGION_CONTROLS))
        self.assert_receipt_pixels(receipt=receipt)

    def test_protection_model_failure_never_publishes_region_output(self):
        self.mask.side_effect = ValueError("no reliable person mask")
        with self.assertRaisesRegex(ValueError, "background protection"):
            self.public_render(controls={"Abdomen": 100}, protection=True)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    def test_protection_compositor_failure_never_publishes_skin_only_output(self):
        self.compositor.side_effect = ValueError("rejected protection mask")
        with self.assertRaisesRegex(ValueError, "^background protection: rejected protection mask$"):
            self.public_render(controls={"BodySkinTone": 50}, protection=True)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    def test_tight_crop_protection_failure_maps_to_actionable_api_error(self):
        mask = np.full(self.rgba.shape[:2], 255, dtype=np.uint8)
        mask[:4] = mask[-4:] = 0
        mask[:, :4] = mask[:, -4:] = 0
        self.mask.return_value = mask, {"provider": "tight-crop-fixture"}
        with self.assertRaisesRegex(ValueError, "^background protection: insufficient distant background") as raised:
            self.public_render(controls={"Abdomen": 100}, protection=True)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

        stderr = json.dumps({"error": str(raised.exception)})
        (self.work / "render.py").write_text(
            "import sys\nsys.stderr.write(" + repr(stderr) + ")\nraise SystemExit(1)\n", encoding="utf-8")
        runner = EngineRunner(root=self.work)
        self.addCleanup(runner.close)
        with self.assertRaises(AppError) as failed:
            runner(source=self.work / "source.png", values={"Abdomen": 100},
                output=self.output, report=self.report,
                edits={"backgroundProtection": True, "strokes": []})
        self.assertEqual((failed.exception.status, failed.exception.code), (422, "background_unavailable"))
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    def test_metal_rejects_cpu_only_controls_before_loading_or_processing(self):
        for controls in ({"Abdomen": 80}, {"BodySkinTone": 0}, {"BodySkinWarmth": -50}):
            with self.subTest(controls=controls), self.assertRaisesRegex(ValueError, "未知美体项目"):
                self.public_render(controls=controls, backend="metal")
        self.engine.load_networks.assert_not_called()
        self.mask.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_adapter_routes_only_nonzero_extra_controls_to_region_composition(self):
        adapter = portable_engine.PortableEngine(engine=self.engine, body_root=ROOT)
        arguments = {"rgba": self.rgba, "runtime": self.work, "output": self.output, "report": self.report}
        with patch.object(region_render, "run", return_value="regions") as region, \
             patch.object(portable_engine.leg_render, "run", return_value="legacy") as legacy, \
             patch.object(portable_engine.edit_render, "run", return_value="edits") as edits:
            for name, (_, maximum) in EXTRA_RANGES.items():
                values = validate_photo_controls(controls={name: maximum}, extended=True)
                self.assertEqual(adapter.run(controls=values, **arguments), "regions")
                self.assertIs(region.call_args.kwargs["engine"], adapter)
                self.assertEqual(region.call_args.kwargs["controls"][name], maximum)
            self.assertEqual(region.call_count, 9)
            zero_extra = validate_photo_controls(controls={"SlimWaist": 70, "Abdomen": 0}, extended=True)
            self.assertEqual(adapter.run(controls=zero_extra, **arguments), "legacy")
            self.assertEqual(legacy.call_args.kwargs["controls"], validate_controls(controls={"SlimWaist": 70}))
            neutral = validate_photo_controls(controls={"BodySkinTone": 0}, extended=True)
            self.assertEqual(adapter.run(controls=neutral, **arguments), "edits")
            self.assertEqual(set(edits.call_args.kwargs["controls"]), set(PUBLIC_CONTROLS))
            self.assertEqual(region.call_count, 9)


if __name__ == "__main__":
    unittest.main()
