"""No-model tests of extension composition, refusal, and the single GPU draw."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from body import leg_render
from body.backend import BodyBackend
from body.control_contract import PUBLIC_CONTROLS, validate_controls
from body.leg_shape import resample_grid_delta
from body.tests.test_backend import FakeEngine, picture


def grid(width, height, rows, cols):
    base = np.stack(np.meshgrid(np.linspace(0, width, cols + 1), np.linspace(0, height, rows + 1)), -1)
    uv = base / [width, height]
    faces = []
    for row in range(rows):
        for col in range(cols):
            a = row * (cols + 1) + col
            faces.extend([(a, a + cols + 1, a + cols + 2), (a, a + cols + 2, a + 1)])
    return base.astype(np.float32), uv, np.array(faces), None


class LegRenderTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="leg-render-contract-")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.rgba = np.full((1600, 1000, 4), 128, np.uint8)
        self.rgba[..., 3] = 255
        self.original = self.rgba.copy()
        self.pose = np.full((18, 4), .95, dtype=np.float32)
        self.pose[:, 3] = 1
        self.pose[[8, 9, 10], :2] = [[350, 600], [350, 1000], [350, 1450]]
        self.pose[[11, 12, 13], :2] = [[650, 600], [650, 1000], [650, 1450]]
        self.perception = {"algorithmSize": [1000, 1600], "coarsePeople": 1}
        self.draws = []
        self.old = np.zeros((31, 31, 2), np.float32)

        def draw(**arguments):
            self.draws.append(arguments)
            result = arguments["rgba"].copy()
            result[900, 300, 0] += 1
            return result, {"privateNativeImages": []}

        def frame(**_):
            base, uv, triangles, _ = grid(1000, 1600, 30, 30)
            return {"base": base, "positions": base + self.old, "uv": uv, "tri": triangles,
                    "delta": self.old}, {"faceFound": False}

        self.engine = SimpleNamespace(load_networks=Mock(return_value=SimpleNamespace(provenance={"test": True})),
            still_pose=Mock(side_effect=lambda **_: (self.pose, self.perception)),
            internal_targets=lambda **arguments: arguments["values"],
            still_frame=Mock(side_effect=frame), GRID=(30, 30),
            part_summary=lambda **_: {"LongLeg": {"moved": True, "intensity": .35}},
            draw_mesh=Mock(side_effect=draw), process_images=lambda: {"private_native_images": []},
            plain=lambda value: json.loads(json.dumps(value, default=lambda array: array.tolist())), STILL_UPDATES=8)
        mesh = SimpleNamespace(make_grid=grid, pack_vertices=lambda *arguments: arguments[0].copy())
        context = patch.dict(sys.modules, {"body_mesh_grid": mesh})
        context.start()
        self.addCleanup(context.stop)

    def render(self, **controls):
        values = validate_controls(controls=controls)
        receipt = leg_render.run(engine=self.engine, rgba=self.rgba, controls=values,
            runtime=self.work, output=self.work / "out.png", report=self.work / "out.json")
        saved = json.loads((self.work / "out.json").read_bytes())
        self.assertEqual(saved["controls"], values)
        self.assertEqual(saved["inputRgbaSha256"], hashlib.sha256(self.original.tobytes()).hexdigest())
        with Image.open(self.work / "out.png") as result:
            self.assertEqual(result.size, (1000, 1600))
            self.assertEqual(saved["outputRgbaSha256"], hashlib.sha256(result.tobytes()).hexdigest())
        np.testing.assert_array_equal(self.rgba, self.original)
        return receipt

    def test_only_legs_use_one_pose_one_draw_and_no_face_dependency(self):
        receipt = self.render(ThighWidth=-50, CalfWidth=50)
        self.engine.load_networks.assert_called_once()
        self.engine.still_pose.assert_called_once()
        self.engine.still_frame.assert_not_called()
        self.engine.draw_mesh.assert_called_once()
        self.assertEqual(receipt["grid"], [80, 80])
        for name in ("ThighWidth", "CalfWidth"):
            self.assertTrue(receipt["parts"][name]["moved"])
        self.assertFalse(receipt["nativeGeometryUsed"])
        self.assertFalse(receipt["backgroundProtection"])

    def test_combination_interpolates_geometry_and_samples_original_once(self):
        base, *_ = grid(1000, 1600, 30, 30)
        self.old[..., 0] = base[..., 0] * .01
        receipt = self.render(StretchLeg=100, ThighWidth=-50)
        self.engine.still_frame.assert_called_once()
        targets = self.engine.still_frame.call_args.kwargs["targets"]
        self.assertEqual(targets["StretchLeg"], 100)
        self.assertNotIn("ThighWidth", targets)
        self.assertEqual(len(targets), len(PUBLIC_CONTROLS) - 2)
        self.assertIs(self.draws[0]["rgba"], self.rgba)
        positions = self.draws[0]["vertices"]
        expected, *_ = grid(1000, 1600, 80, 80)
        expected += resample_grid_delta(delta=self.old, rows=80, cols=80)
        np.testing.assert_allclose(positions[65:], expected[65:], rtol=0, atol=.0001)
        self.assertTrue(receipt["parts"]["LongLeg"]["moved"])
        self.assertTrue(receipt["parts"]["ThighWidth"]["moved"])
        self.assertEqual(len(self.draws), 1)

    def test_missing_either_side_does_not_silently_apply_one_sided(self):
        self.pose[12, 3] = 0
        receipt = self.render(ThighWidth=-50)
        self.assertFalse(receipt["parts"]["ThighWidth"]["moved"])
        self.assertEqual(receipt["changedPixels"], 0)
        self.engine.draw_mesh.assert_not_called()

    def test_group_photo_does_not_guess_the_selected_person(self):
        self.perception["coarsePeople"] = 2
        receipt = self.render(CalfWidth=50)
        self.assertFalse(receipt["parts"]["CalfWidth"]["moved"])
        self.assertIn("exactly one", receipt["parts"]["CalfWidth"]["reason"])
        self.assertTrue(receipt["identity"])
        self.engine.draw_mesh.assert_not_called()

    def test_no_person_records_model_provenance_and_preserves_pixels(self):
        self.pose = None
        receipt = self.render(ThighWidth=50, CalfWidth=-50)
        self.assertEqual(receipt["reason"], "no person detected")
        self.assertEqual(receipt["changedPixels"], 0)
        self.assertEqual(receipt["independence"], {"private_native_images": []})
        self.engine.still_frame.assert_not_called()
        self.engine.draw_mesh.assert_not_called()

    def test_unavailable_leg_does_not_discard_an_available_original_control(self):
        self.pose[10, 3] = 0
        base, *_ = grid(1000, 1600, 30, 30)
        self.old[..., 0] = base[..., 0] * .01
        receipt = self.render(StretchLeg=100, CalfWidth=-50)
        self.assertFalse(receipt["parts"]["CalfWidth"]["moved"])
        self.assertTrue(receipt["parts"]["LongLeg"]["moved"])
        self.assertGreater(receipt["changedPixels"], 0)
        self.engine.draw_mesh.assert_called_once()
        self.assertEqual(receipt["grid"], [30, 30])
        np.testing.assert_array_equal(self.draws[0]["vertices"], base + self.old)

    def test_combination_uses_pinned_final_positions_including_boundary_clamp(self):
        self.old[..., 0] = .25
        original_frame = self.engine.still_frame.side_effect

        def clamped(**arguments):
            state, faces = original_frame(**arguments)
            state["positions"][:, 0] = state["base"][:, 0]
            return state, faces

        self.engine.still_frame.side_effect = clamped
        receipt = self.render(StretchLeg=100, ThighWidth=-50)
        self.assertTrue(receipt["parts"]["ThighWidth"]["moved"])
        self.assertTrue(np.all(self.draws[0]["vertices"][:, 0, 0] == 0))


class LegFeedbackTests(unittest.TestCase):
    def response(self, *, moved, reason=None, scale=1):
        with tempfile.TemporaryDirectory(prefix="leg-feedback-") as temporary:
            fake = FakeEngine(fault=None if moved else "no-person")

            def runner(**arguments):
                fake(**arguments)
                path = arguments["report"]
                receipt = json.loads(path.read_bytes())
                receipt["parts"]["ThighWidth"].update(moved=moved, reason=reason, safetyScale=scale)
                path.write_text(json.dumps(receipt), encoding="utf-8")

            backend = BodyBackend(root=temporary, runner=runner, platform="darwin")
            try:
                photo = backend.import_photo(data=picture())
                return backend.render(request={"photoId": photo["photoId"], "values": {"ThighWidth": -50}})
            finally:
                backend.close()

    def test_unsupported_group_and_mesh_each_have_specific_explanation(self):
        for reason, phrase in [("exactly one detected person is required", "单个人物"),
                ("combined mesh would fold; leg width was not applied", "网格翻折"),
                ("both legs need confident visible joints", "双腿")]:
            with self.subTest(reason=reason):
                response = self.response(moved=False, reason=reason)
                self.assertEqual(response["status"], "unavailable")
                self.assertIn(phrase, response["controls"]["ThighWidth"]["message"])

    def test_reduced_displacement_is_disclosed_after_real_pixel_evidence(self):
        response = self.response(moved=True, scale=.5)
        self.assertEqual(response["status"], "applied")
        self.assertIn("实际形变量已降低", response["controls"]["ThighWidth"]["message"])

    def test_optional_diagnostic_values_cannot_crash_successful_delivery(self):
        for scale in (None, "invalid", True, []):
            with self.subTest(scale=scale):
                response = self.response(moved=True, scale=scale)
                self.assertEqual(response["status"], "applied")


if __name__ == "__main__":
    unittest.main()
