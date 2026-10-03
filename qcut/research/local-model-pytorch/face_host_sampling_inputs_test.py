"""Locked synthetic frames and signed tensors; no native library or model calls."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

import numpy as np

from face_alignment_replay import LockedFiles
from face_host_geometry_contract_test import geometry_row
import face_host_sampling_inputs as probe


class InputsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "geometry").mkdir()
        self.frame = np.full((480, 640, 4), [2, 9, 21, 255], np.uint8)
        data = self.frame.tobytes()
        (self.root / "geometry/frame-0.rgba").write_bytes(data)
        tensor = np.full((1, 120, 120, 3), [-107, -119, -126], np.int16).tobytes()
        path = self.root / "input.bin"
        path.write_bytes(tensor)
        self.descriptor = dict(prediction=0, file="frame-0.rgba", bytes=len(data), sha256=probe.digest(data=data))
        record = dict(name="data", inference=0, raw=[2, 6], dims_nwhc=[1, 120, 120, 3],
                      path=str(path), sha256=probe.digest(data=tensor))
        self.evidence = dict(geometry_snapshots=[geometry_row()], algorithm_frames=[self.descriptor],
                             captures=dict(networks={"32768": dict(inputs=[record])}))
        self.associations = [dict(prediction=0, inferences=[dict(size=120, network="32768", inference=0)])]

    def build(self, *, temporal=False):
        return probe.build_inputs(root=self.root, evidence=self.evidence, associations=self.associations,
                                  locked=LockedFiles(), temporal=temporal)

    def test_generated_input_is_owned_and_exact_without_mutating_evidence(self):
        before = deepcopy(self.evidence)
        inputs, cases = self.build()
        self.assertEqual(set(inputs), {(120, 0)})
        self.assertEqual(inputs[(120, 0)].dtype, np.int16)
        self.assertTrue(cases[0]["sampling_exact"])
        self.assertEqual(self.evidence, before)

    def test_deactivated_retained_warp_does_not_claim_face_identity(self):
        self.evidence["geometry_snapshots"][0]["faces"][0]["active"] = False
        inputs, cases = self.build(temporal=True)
        self.assertEqual(len(inputs), 1)
        self.assertFalse(cases[0]["active"])
        self.assertNotIn("id", cases[0])

    def test_ambiguous_initialized_faces_are_rejected_before_input_comparison(self):
        row = self.evidence["geometry_snapshots"][0]
        row["faces"].append(dict(deepcopy(row["faces"][0]), id=2, tracking_id=2, alignment=69632, slot=1))
        with self.assertRaisesRegex(ValueError, "multi-face selection"):
            self.build()

    def test_changed_rgba_and_tensor_fail_hash_guards(self):
        for path in (self.root / "geometry/frame-0.rgba", self.root / "input.bin"):
            before = path.read_bytes()
            path.write_bytes(b"x" + before[1:])
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.build()
            path.write_bytes(before)

    def test_sampling_mismatch_is_rejected_without_adjusting_forward(self):
        row = self.evidence["geometry_snapshots"][0]
        row["faces"][0]["forward"][0][2] = 120.0
        with self.assertRaisesRegex(RuntimeError, "no correction"):
            self.build()

    def test_descriptor_index_layout_hash_and_lengths_are_strict(self):
        for key, value in (("prediction", True), ("prediction", 1), ("file", "../outside.rgba"),
                           ("bytes", True), ("bytes", 1), ("sha256", "x")):
            with self.subTest(key=key):
                saved = self.descriptor[key]
                self.descriptor[key] = value
                with self.assertRaises(ValueError):
                    self.build()
                self.descriptor[key] = saved
        self.evidence["algorithm_frames"] = []
        with self.assertRaises(ValueError):
            self.build()

    def test_predictor_identity_and_multiple_inferences_are_not_guessed(self):
        self.associations[0]["inferences"][0]["network"] = "57344"
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            self.build()
        self.associations[0]["inferences"] = [dict(size=120, network="32768", inference=i) for i in (0, 1)]
        with self.assertRaisesRegex(ValueError, "shared-face routing"):
            self.build()

    def test_idle_is_not_substituted_with_previous_input(self):
        second = geometry_row(index=1)
        second["faces"][0]["active"] = False
        second["bytenn_sequence"] = 16
        self.evidence["geometry_snapshots"].append(second)
        self.evidence["algorithm_frames"].append(dict(self.descriptor, prediction=1, file="frame-1.rgba"))
        (self.root / "geometry/frame-1.rgba").write_bytes(self.frame.tobytes())
        self.associations.append(dict(prediction=1, inferences=[]))
        inputs, cases = self.build(temporal=True)
        self.assertEqual(len(inputs), 1)
        self.assertEqual(cases[1], dict(prediction=1, idle=True))
        second["faces"][0]["active"] = True
        with self.assertRaisesRegex(ValueError, "no-face window"):
            self.build(temporal=True)


if __name__ == "__main__":
    unittest.main()
