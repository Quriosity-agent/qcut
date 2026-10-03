"""Synthetic locked RGBA/int8 fixtures only; no SDK, native host or model calls."""
from argparse import Namespace
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_replay import LockedFiles
from face_host_geometry_contract_test import geometry_row
import face_host_sampling_160_inputs as probe


class Sampling160Tests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "geometry").mkdir()
        (self.root / "capture").mkdir()
        self.frame = np.full((480, 640, 4), [2, 9, 21, 255], np.uint8)
        self.tensor = np.full((1, 160, 160, 3), [-107, -119, -126], np.int8)
        self.path = self.root / "capture/input-0.bin"
        self.path.write_bytes(self.tensor.tobytes())
        self.record = dict(name="data", inference=0, raw=[1, 6], dims_nwhc=[1, 160, 160, 3],
                           path=str(self.path), sha256=probe.digest(data=self.tensor.tobytes()))
        self.network = dict(inputs=[self.record], successful_inferences=[0])
        self.evidence = dict(geometry_snapshots=[], algorithm_frames=[],
                             captures=dict(networks={"57344": self.network}), source_sha256={})
        self.associations = []
        self.append_snapshot(inference=0)

    def append_snapshot(self, *, inference=None, active=True, identity=1):
        index = len(self.associations)
        row = geometry_row(index=index)
        row["faces"][0].update(active=active, id=identity, tracking_id=identity)
        lower = self.associations[-1]["neural_window"][1] if index else 0
        row["bytenn_sequence"] = lower + (16 if inference is not None else 0)
        items = ([] if inference is None else [dict(size=160, network="57344", inference=inference,
                                                  record_index=lower + 1)])
        self.associations.append(dict(prediction=index, neural_window=[lower, row["bytenn_sequence"]], inferences=items))
        self.evidence["geometry_snapshots"].append(row)
        data = self.frame.tobytes()
        name = f"frame-{index}.rgba"
        (self.root / "geometry" / name).write_bytes(data)
        self.evidence["algorithm_frames"].append(dict(prediction=index, file=name, bytes=len(data),
                                                       sha256=probe.digest(data=data)))
        return row

    def append_input(self):
        inference = len(self.network["successful_inferences"])
        path = self.root / f"capture/input-{inference}.bin"
        path.write_bytes(self.tensor.tobytes())
        self.network["inputs"].append(dict(deepcopy(self.record), inference=inference, path=str(path)))
        self.network["successful_inferences"].append(inference)
        return inference

    def build(self, *, locked=None, temporal=True):
        return probe.build_inputs(root=self.root, evidence=self.evidence, associations=self.associations,
                                  locked=locked or LockedFiles(), temporal=temporal)

    def test_owned_int8_exact_bytes_and_required_case_provenance(self):
        before = deepcopy(self.evidence)
        inputs, cases = self.build()
        self.assertEqual(set(inputs), {(160, 0)})
        actual = inputs[(160, 0)]
        self.assertEqual(actual.dtype, np.int8)
        self.assertEqual(actual.shape, (1, 160, 160, 3))
        self.assertTrue(actual.flags.owndata)
        self.assertEqual(actual.tobytes(), self.tensor.tobytes())
        self.assertEqual(self.evidence, before)
        self.assertEqual(cases[0]["input_sha256"], self.record["sha256"])
        for field in ("prediction", "inference", "slot", "active", "sampling_exact", "algorithm_frame_sha256",
                      "network", "network_source_role", "input_source"):
            self.assertIn(field, cases[0])
        self.assertEqual(cases[0]["different_values"], 0)
        self.assertNotIn("id", cases[0])

    def test_sampler_receives_actual_forward_and_explicit_160_size(self):
        with patch.object(probe, "signed_input", wraps=probe.signed_input) as sampler:
            self.build()
        self.assertEqual(sampler.call_args.kwargs["size"], (160, 160))
        np.testing.assert_array_equal(sampler.call_args.kwargs["forward"], np.eye(2, 3, dtype=np.float32))

    def test_signed_range_checked_before_int8_conversion(self):
        for value in (-129, 128, 32767):
            bad = self.tensor.astype(np.int16)
            bad[0, 0, 0, 0] = value
            with self.subTest(value=value), patch.object(probe, "signed_input", return_value=bad):
                with self.assertRaisesRegex(ValueError, "before int8"):
                    self.build()

    def test_sampler_shape_dtype_and_object_are_strict(self):
        for value in (None, [], self.tensor, self.tensor.astype(np.float32), np.zeros((160, 160, 3), np.int16)):
            with self.subTest(type=type(value)), patch.object(probe, "signed_input", return_value=value):
                with self.assertRaisesRegex(ValueError, "bounded signed sampler"):
                    self.build()

    def test_sampling_mismatch_returns_diagnostics_not_replacement_or_captured_input(self):
        data = bytearray(self.path.read_bytes())
        data[0] = 127
        self.path.write_bytes(data)
        self.record["sha256"] = probe.digest(data=data)
        with self.assertRaises(probe.SamplingMismatch) as caught:
            self.build()
        self.assertEqual(caught.exception.cases[0]["different_values"], 1)
        self.assertEqual(caught.exception.cases[0]["maximum_difference"], 234)
        self.assertFalse(caught.exception.cases[0]["sampling_exact"])
        self.assertFalse(hasattr(caught.exception, "inputs"))

    def test_no_partial_mapping_when_later_inference_mismatches(self):
        self.append_snapshot(active=False)
        inference = self.append_input()
        self.append_snapshot(inference=inference, identity=2)
        record = self.network["inputs"][-1]
        data = bytes(self.tensor.nbytes)
        Path(record["path"]).write_bytes(data)
        record["sha256"] = probe.digest(data=data)
        with self.assertRaises(probe.SamplingMismatch) as caught:
            self.build()
        self.assertEqual([case["sampling_exact"] for case in caught.exception.cases], [True, False])

    def test_idle_windows_have_no_cases_and_recovery_new_identity_is_allowed(self):
        self.append_snapshot(active=False)
        self.append_snapshot(active=False)
        self.append_snapshot(inference=self.append_input(), identity=2)
        inputs, cases = self.build()
        self.assertEqual(set(inputs), {(160, 0), (160, 1)})
        self.assertEqual([case["prediction"] for case in cases], [0, 3])

    def test_retained_no_face_warp_is_not_initialization_input(self):
        self.evidence["geometry_snapshots"][0]["faces"][0]["active"] = False
        with self.assertRaisesRegex(ValueError, "no retained no-face"):
            self.build()

    def test_stale_active_or_retained_identity_cannot_select_160(self):
        for prior_active, identity in ((True, 2), (False, 1)):
            before = deepcopy((self.evidence, self.associations))
            if not prior_active:
                self.append_snapshot(active=False)
            self.append_snapshot(inference=self.append_input(), identity=identity)
            with self.subTest(prior_active=prior_active), self.assertRaisesRegex(ValueError, "stale warp"):
                self.build()
            self.evidence, self.associations = before
            self.network = self.evidence["captures"]["networks"]["57344"]

    def test_ambiguous_initialized_pool_rejected_without_sampling(self):
        row = self.evidence["geometry_snapshots"][0]
        row["faces"].append(dict(deepcopy(row["faces"][0]), slot=1, alignment=69632, id=2, tracking_id=2))
        with patch.object(probe, "signed_input") as sampler:
            with self.assertRaisesRegex(ValueError, "multi-face selection"):
                self.build()
            sampler.assert_not_called()

    def test_detection_forward_inverse_must_match_without_fitting(self):
        self.evidence["geometry_snapshots"][0]["faces"][0]["detection_inverse"][0][2] = 1.0
        with self.assertRaisesRegex(ValueError, "detection forward/inverse"):
            self.build()

    def test_missing_unknown_and_failed_inference_not_substituted(self):
        for items in ([], [dict(self.associations[0]["inferences"][0], inference=1)]):
            with self.subTest(items=items):
                original = self.associations[0]["inferences"]
                self.associations[0]["inferences"] = items
                with self.assertRaisesRegex(ValueError, "every actual|no completed"):
                    self.build()
                self.associations[0]["inferences"] = original

    def test_duplicate_association_keys_and_record_indices_rejected(self):
        item = self.associations[0]["inferences"][0]
        for extra in (dict(item, record_index=2), dict(item, inference=1)):
            self.associations[0]["inferences"] = [item, extra]
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, "reused"):
                self.build()

    def test_multiple_distinct_160_calls_remain_unsupported(self):
        self.append_input()
        self.associations[0]["inferences"].append(dict(size=160, network="57344", inference=1, record_index=2))
        with self.assertRaisesRegex(ValueError, "multi-inference face routing"):
            self.build()

    def test_typed_association_fields_reject_bool_unknown_and_outside_windows(self):
        item = self.associations[0]["inferences"][0]
        for field, values in (("size", [True, "160", 121]), ("inference", [True, -1, 129]),
                              ("record_index", [True, -1, 16]), ("network", [57344, "32768", "other"])):
            original = item[field]
            for value in values:
                item[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.build()
            item[field] = original

    def test_typed_prediction_and_neural_windows_follow_shared_sequence(self):
        association = self.associations[0]
        for field, values in (("prediction", [True, 1, "0"]),
                              ("neural_window", [[False, 16], [0, True], [1, 16], [0, 17], None])):
            original = association[field]
            for value in values:
                association[field] = value
                with self.subTest(field=field), self.assertRaises(ValueError):
                    self.build()
            association[field] = original

    def test_shared_owner_request_predictor_and_marker_guards_are_kept(self):
        self.append_snapshot(active=False)
        row = self.evidence["geometry_snapshots"][-1]
        for field, value in (("handle", 12288), ("request", [0, 641, 480, 2564, 0]), ("bytenn_sequence", 15)):
            original = row[field]
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.build()
            row[field] = original
        row["predictors"][1]["network"] = 61440
        with self.assertRaises(ValueError):
            self.build()

    def test_inventory_requires_exact_int8_storage_and_dimensions(self):
        for field, value in (("raw", [2, 6]), ("raw", [True, 6]), ("raw", [1, True]),
                              ("dims_nwhc", [1, 120, 120, 3]), ("dims_nwhc", [True, 160, 160, 3]),
                              ("name", "other"), ("inference", True)):
            original = self.record[field]
            self.record[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.build()
            self.record[field] = original

    def test_inventory_successes_and_duplicate_or_missing_inputs_are_strict(self):
        for successes in (None, [], [True], [1], [0, 0], list(range(130))):
            self.network["successful_inferences"] = successes
            with self.subTest(successes=successes), self.assertRaises(ValueError):
                self.build()
        self.network["successful_inferences"] = [0, 1]
        self.network["inputs"] = [self.record, deepcopy(self.record)]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.build()
        self.network["inputs"] = []
        with self.assertRaisesRegex(ValueError, "one actual input"):
            self.build()

    def test_frame_descriptor_count_identity_and_dimensions_are_strict(self):
        descriptor = self.evidence["algorithm_frames"][0]
        for field, value in (("prediction", True), ("prediction", 1), ("bytes", True), ("bytes", 1),
                              ("file", "../outside.rgba"), ("sha256", "bad")):
            original = descriptor[field]
            descriptor[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.build()
            descriptor[field] = original
        self.evidence["algorithm_frames"] = []
        with self.assertRaises(ValueError):
            self.build()

    def test_changed_frame_and_tensor_fail_hash_guards(self):
        for path in (self.path, self.root / "geometry/frame-0.rgba"):
            before = path.read_bytes()
            path.write_bytes(b"x" + before[1:])
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.build()
            path.write_bytes(before)

    def test_native_tensor_size_and_path_cannot_escape_capture(self):
        self.path.write_bytes(b"x")
        self.record["sha256"] = probe.digest(data=b"x")
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.build()
        outside = self.root / "outside.bin"
        outside.write_bytes(self.tensor.tobytes())
        self.record["path"] = str(outside)
        with self.assertRaisesRegex(ValueError, "escaped actual capture"):
            self.build()

    def test_locked_recheck_detects_changes_during_sampling(self):
        original = probe.signed_input
        def change_frame(**kwargs):
            frame_path = self.root / "geometry/frame-0.rgba"
            frame_path.write_bytes(b"x" + frame_path.read_bytes()[1:])
            return original(**kwargs)
        with patch.object(probe, "signed_input", side_effect=change_frame):
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.build()

    def test_source_hash_and_source_recheck_are_locked(self):
        source = self.root / "source.py"
        source.write_bytes(b"synthetic")
        locked = LockedFiles()
        with patch.object(probe, "SOURCE_ROOT", self.root):
            probe.lock_sources(sources={"source.py": probe.digest(data=b"synthetic")}, locked=locked)
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.build(locked=locked)

    def test_source_names_hash_types_and_symlink_escapes_are_rejected(self):
        research = self.root / "research"
        research.mkdir()
        outside = self.root / "outside.py"
        outside.write_bytes(b"synthetic")
        (research / "link.py").symlink_to(outside)
        with patch.object(probe, "SOURCE_ROOT", research):
            for sources in ({"../outside.py": "0" * 64}, {str(outside): "0" * 64},
                            {"file.py": True}, {"link.py": probe.digest(data=b"synthetic")}, {}, None):
                with self.subTest(sources=sources), self.assertRaises(ValueError):
                    probe.lock_sources(sources=sources, locked=LockedFiles())

    def test_evidence_association_objects_and_temporal_flag_are_typed(self):
        for evidence in (None, [], False):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                probe.build_inputs(root=self.root, evidence=evidence, associations=self.associations, locked=LockedFiles())
        for associations in (None, [], [False]):
            with self.subTest(associations=associations), self.assertRaises(ValueError):
                probe.build_inputs(root=self.root, evidence=self.evidence, associations=associations, locked=LockedFiles())
        with self.assertRaises(ValueError):
            self.build(temporal=1)

    def mocked_run(self, *, diagnostic, mismatch=False):
        self.out = self.root / "out"
        self.out.mkdir()
        self.evidence["prediction_inferences"] = self.associations
        (self.root / "report.json").write_text(json.dumps(self.evidence))
        if mismatch:
            self.tensor.fill(0)
            self.path.write_bytes(self.tensor.tobytes())
            self.record["sha256"] = probe.digest(data=self.tensor.tobytes())
            (self.root / "report.json").write_text(json.dumps(self.evidence))
        patches = [(probe.sequence, "fresh_output", dict(return_value=self.out)),
                   (probe.parity, "no_torch", {}), (probe, "validate_dynamic", {}),
                   (probe, "lock_sources", {}), (probe.observed, "snapshots", dict(return_value=self.evidence["geometry_snapshots"])),
                   (probe.capture, "inventory", dict(return_value=self.evidence["captures"])),
                   (probe.observed, "lock_inventory", {}),
                   (probe, "associate_inferences", dict(return_value=self.associations)),
                   (probe, "SOURCE_NAMES", dict(new=(Path(probe.__file__).name,)))]
        for obj, name, kwargs in patches:
            self.enterContext(patch.object(obj, name, **kwargs))
        return probe.run(args=Namespace(capture=self.root, out=self.out, diagnostic=diagnostic))

    def test_mocked_run_saves_generated_int8_but_claims_no_onnx_consumption(self):
        report = self.mocked_run(diagnostic=False)
        self.assertTrue(report["passed"])
        self.assertTrue(report["independent_160_sampling_inputs_generated"])
        self.assertFalse(report["independent_160_sampling_input_used"])
        self.assertFalse(report["native_inference_called"])
        saved = np.load(self.out / "size-160-infer-000.npy", allow_pickle=False)
        np.testing.assert_array_equal(saved, self.tensor)

    def test_mocked_diagnostic_run_is_complete_failed_and_saves_no_replacements(self):
        report = self.mocked_run(diagnostic=True, mismatch=True)
        self.assertTrue(report["completed"])
        self.assertFalse(report["passed"])
        self.assertTrue(report["diagnostic_only"])
        self.assertEqual(report["exact_inferences"], 0)
        self.assertEqual(list(self.out.glob("*.npy")), [])

    def test_mocked_strict_run_writes_failure_report_and_raises(self):
        with self.assertRaises(probe.SamplingMismatch):
            self.mocked_run(diagnostic=False, mismatch=True)
        report = json.loads((self.out / "report.json").read_text())
        self.assertFalse(report["passed"])
        self.assertFalse(report["completed"])
        self.assertEqual(report["cases"][0]["prediction"], 0)
        self.assertEqual(list(self.out.glob("*.npy")), [])


if __name__ == "__main__":
    unittest.main()
