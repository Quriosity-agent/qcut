"""Portable safeguards retain explicit routing and per-control refusal evidence."""
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

from body import portable_engine
from body.backend import control_message


class PortableSafetyAdapterTests(unittest.TestCase):
    def setUp(self):
        self.photo = np.full((96, 64, 4), 255, np.uint8)
        self.pose = np.zeros((18, 4), np.float32)
        self.perception = {"algorithmSize": [64, 96], "coarsePeople": 1}
        self.state = {"positions": np.zeros((2, 2, 2), np.float32)}
        self.faces = {"faceFound": False}
        self.original_summary = {"LongLeg": {"moved": True, "intensity": .2},
                                 "SlimWaist": {"moved": True, "intensity": .1}}
        self.native = SimpleNamespace(
            still_pose=Mock(return_value=(self.pose, self.perception)),
            still_frame=Mock(return_value=(self.state, self.faces)),
            part_summary=Mock(return_value=self.original_summary))
        self.adapter = portable_engine.PortableEngine(engine=self.native, body_root=Path("/test/body"))
        self.arguments = dict(rgba=self.photo, points=self.pose, algorithm_size=[64, 96],
                              targets={"LongLeg": .2, "SlimWaist": .1}, runtime=Path("/test/runtime"))

    def test_only_long_leg_is_removed_when_joints_are_unavailable(self):
        refused = {"eligible": False, "reason": "both hips, knees and ankles must be visible"}
        with patch.object(portable_engine, "evaluate_long_leg", return_value=refused) as gate, \
                patch.object(portable_engine, "adjust_long_leg") as geometry:
            self.adapter.still_pose(rgba=self.photo, networks=object())
            result, faces = self.adapter.still_frame(**self.arguments)
        self.assertIs(gate.call_args.kwargs["perception"], self.perception)
        self.assertEqual(self.native.still_frame.call_args.kwargs["targets"],
                         {"LongLeg": 0, "SlimWaist": .1})
        self.assertEqual(self.arguments["targets"], {"LongLeg": .2, "SlimWaist": .1})
        self.assertIs(faces, self.faces)
        geometry.assert_not_called()
        summary = self.adapter.part_summary(result=result)
        self.assertFalse(summary["LongLeg"]["moved"])
        self.assertTrue(summary["LongLeg"]["portableSafety"])
        self.assertEqual(summary["LongLeg"]["reason"], refused["reason"])
        self.assertTrue(summary["SlimWaist"]["moved"])
        self.assertTrue(self.original_summary["LongLeg"]["moved"])
        self.assertNotIn("portableLongLeg", self.state)

    def test_complete_legs_receive_only_the_portable_geometry_replacement(self):
        eligible = {"eligible": True, "reason": None, "points": {}}
        corrected = {"positions": np.ones((2, 2, 2), np.float32)}
        diagnostics = {"moved": True, "method": "test-foot-anchor", "reason": None}
        with patch.object(portable_engine, "evaluate_long_leg", return_value=eligible), \
                patch.object(portable_engine, "adjust_long_leg", return_value=(corrected, diagnostics)) as geometry:
            result, _ = self.adapter.still_frame(**self.arguments)
        self.assertIs(geometry.call_args.kwargs["state"], self.state)
        self.assertEqual(geometry.call_args.kwargs["target"], .2)
        self.assertEqual((geometry.call_args.kwargs["width"], geometry.call_args.kwargs["height"]), (64, 96))
        self.assertIs(geometry.call_args.kwargs["eligibility"], eligible)
        summary = self.adapter.part_summary(result=result)
        self.assertTrue(summary["LongLeg"]["moved"])
        self.assertEqual(summary["LongLeg"]["geometry"], diagnostics)
        self.assertEqual(self.native.still_frame.call_args.kwargs["targets"], self.arguments["targets"])

    def test_unrelated_controls_do_not_invoke_or_change_long_leg_policy(self):
        arguments = {**self.arguments, "targets": {"LongLeg": 0, "SlimWaist": .1}}
        with patch.object(portable_engine, "evaluate_long_leg") as gate, \
                patch.object(portable_engine, "adjust_long_leg") as geometry:
            state, faces = self.adapter.still_frame(**arguments)
        self.assertIs(state, self.state)
        self.assertIs(faces, self.faces)
        self.assertIs(self.adapter.part_summary(result=state), self.original_summary)
        gate.assert_not_called()
        geometry.assert_not_called()

    def test_only_portable_edit_route_receives_new_background_compositor(self):
        arguments = dict(rgba=self.photo, controls={"SlimWaist": 70}, runtime=Path("/runtime"),
                         output=Path("/output.png"), report=Path("/report.json"))
        with patch.object(portable_engine.edit_render, "run", return_value={}) as render:
            self.adapter.run(**arguments, edits={"backgroundProtection": True, "strokes": []})
        self.assertIs(render.call_args.kwargs["mask_provider"], portable_engine.get_person_mask)
        self.assertIs(render.call_args.kwargs["background_compositor"], portable_engine.protect_background)


class PortableSafetyFeedbackTests(unittest.TestCase):
    def test_portable_refusal_and_foot_preservation_are_explicit(self):
        for applied, phrase in [(False, "脚踝"), (True, "保留脚部")]:
            message = control_message(name="StretchLeg", value=100, applied=applied,
                                      detail={"portableSafety": True}, unavailable="legacy unavailable")
            self.assertIn(phrase, message)

    def test_legacy_messages_do_not_change(self):
        for applied, expected in [(False, "legacy unavailable"), (True, "已作用于对应部位。")]:
            self.assertEqual(control_message(name="StretchLeg", value=100, applied=applied,
                detail={}, unavailable="legacy unavailable"), expected)


if __name__ == "__main__":
    unittest.main()
