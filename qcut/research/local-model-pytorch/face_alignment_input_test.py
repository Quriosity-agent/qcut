"""Public synthetic regressions for original alignment probes and evidence gates."""
import ctypes as ct
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from espresso_oracle import sha256
from face_alignment_entry_verify import fields, verify
from face_alignment_input_native import NativeAlignmentInput, copy_tensor, validate_request
from face_alignment_input_verify import difference, evidence_passed, requests, resize_candidates, run
from face_detector_native import TensorView


def passing_report(*, size=120):
    checks = ("crop_box", "staged_original_resize", "resize_formula", "network_input",
              "repeat_input", "repeat_raw_landmarks")
    return {"size": size, "raw": [2, 6] if size == 120 else [1, 6],
            "repeat_raw_equal": True, **{name: {"exact": True} for name in checks}}


class InputEvidenceTest(unittest.TestCase):
    def test_reciprocal_nearest_matches_boundary_evaluation(self):
        crop = np.broadcast_to((np.arange(948) % 256).astype(np.uint8)[None, :, None], (948, 948, 3))
        nearest, _ = resize_candidates(crop=crop, network_size=(120, 120))
        direct = int(np.floor(30 * (948 / 120)))
        self.assertEqual(direct, 237)
        self.assertEqual(int(nearest[30, 30, 0]), 236)

    def test_resize_identity_and_channel_order(self):
        crop = np.arange(120 * 120 * 3, dtype=np.uint8).reshape(120, 120, 3)
        for result in resize_candidates(crop=crop, network_size=(120, 120)):
            np.testing.assert_array_equal(result, crop)

    def test_truncating_linear_preserves_constant_channels(self):
        crop = np.full((59, 59, 3), [0, 129, 255], dtype=np.uint8)
        nearest, linear = resize_candidates(crop=crop, network_size=(120, 120))
        np.testing.assert_array_equal(linear, nearest)
        np.testing.assert_array_equal(linear[60, 60], [0, 129, 255])

    def test_requests_cover_size_threshold_and_both_flags(self):
        controls = list(requests())
        self.assertEqual(len(controls), 192)
        for size in (120, 160):
            subset = [item for item in controls if item["size"] == size]
            self.assertTrue({size - 1, size, size + 1}.issubset({item["rect"][2] for item in subset}))
            self.assertEqual({(item["allow_upscale"], item["legacy_anchor"]) for item in subset},
                             {(False, False), (False, True), (True, False), (True, True)})

    def test_comparison_reports_exact_counts_and_real_error(self):
        expected = np.zeros((2, 3), np.uint8)
        actual = expected.copy()
        actual[1, 2] = 255
        self.assertEqual(difference(actual=actual, expected=expected),
                         {"exact": False, "elements": 6, "mismatches": 1, "max_abs": 255.0})
        self.assertTrue(difference(actual=expected, expected=expected)["exact"])

    def test_comparison_rejects_type_shape_empty_and_nonfinite(self):
        expected = np.zeros((2, 3), np.float32)
        for actual in (np.zeros((3, 2), np.float32), np.zeros((2, 3), np.float64),
                       np.full((2, 3), np.nan, np.float32), np.full((2, 3), np.inf, np.float32)):
            with self.subTest(actual=actual):
                self.assertFalse(difference(actual=actual, expected=expected)["exact"])
        self.assertFalse(difference(actual=np.array([]), expected=np.array([]))["exact"])

    def test_gate_requires_every_stage_and_repeat_descriptor(self):
        for size in (120, 160):
            report = passing_report(size=size)
            self.assertTrue(evidence_passed(report=report))
            for key in report:
                with self.subTest(size=size, missing=key):
                    self.assertFalse(evidence_passed(report={name: value for name, value in report.items() if name != key}))
            for key in ("crop_box", "staged_original_resize", "resize_formula", "network_input",
                        "repeat_input", "repeat_raw_landmarks"):
                self.assertFalse(evidence_passed(report={**report, key: {"exact": False}}))
            for field, value in (("raw", [4, 0]), ("size", 240), ("repeat_raw_equal", 1)):
                self.assertFalse(evidence_passed(report={**report, field: value}))

    def test_existing_evidence_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_input_verify.private_path", side_effect=lambda *, path: Path(path)), \
                self.assertRaisesRegex(ValueError, "overwrite"):
            run(output=Path(directory), image="not-needed")

    def test_missing_fixture_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_input_verify.private_path", side_effect=lambda *, path: Path(path)):
            output = Path(directory) / "new"
            with self.assertRaisesRegex(ValueError, "fixture"):
                run(output=output, image=Path(directory) / "missing.png")
            self.assertFalse(output.exists())


class NativeInputBoundaryTest(unittest.TestCase):
    def request(self, **changes):
        request = {"frame": np.zeros((80, 80, 3), np.uint8), "rect": (0, 0, 40, 40),
                   "network_size": (120, 120), "expansion": 1.5, "allow_upscale": False, "legacy_anchor": False}
        return validate_request(**{**request, **changes})

    def test_noncontiguous_request_becomes_owned_contiguous_storage(self):
        frame = np.arange(160 * 160 * 3, dtype=np.uint8).reshape(160, 160, 3)[::2, ::2]
        image, _, _ = self.request(frame=frame)
        self.assertTrue(image.flags.c_contiguous)
        np.testing.assert_array_equal(image, frame)

    def test_invalid_requests_rejected_before_native_execution(self):
        invalid = [{"frame": np.zeros((0, 80, 3), np.uint8)}, {"frame": np.zeros((80, 80, 4), np.uint8)},
                   {"frame": np.zeros((80, 80, 3), np.float32)}, {"rect": (0, 0, np.nan, 30)},
                   {"rect": (0, 0, 0, 30)}, {"rect": (9000, 0, 30, 30)}, {"network_size": [120, 120]},
                   {"network_size": (True, 120)}, {"network_size": (1, 120)}, {"network_size": (161, 120)},
                   {"allow_upscale": 1}, {"legacy_anchor": 0}, {"expansion": np.inf}, {"expansion": 1000}]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.request(**changes)

    def test_tensor_copy_uses_nhwc_and_does_not_borrow_native_memory(self):
        for kind, dtype in ((1, np.int8), (2, np.int16), (4, np.float32)):
            array = np.arange(24, dtype=dtype).reshape(1, 2, 4, 3)
            view = TensorView(array.ctypes.data, (ct.c_int * 4)(1, 4, 2, 3), (ct.c_int * 2)(kind, 6))
            value, raw = copy_tensor(view=view)
            np.testing.assert_array_equal(value, array)
            self.assertEqual(raw, (kind, 6))
            array[:] = 0
            self.assertEqual(value[0, 1, 3, 2], 23)

    def test_descriptor_and_memory_limits_rejected_before_dereference(self):
        for data, dims, raw in ((0, (1, 120, 120, 3), (1, 6)), (1, (1, 120, 120, 3), (99, 6)),
                                (1, (2, 120, 120, 3), (1, 6)), (1, (1, 0, 120, 3), (1, 6)),
                                (1, (1, 120, 120, 3), (1, 25)), (1, (1, 512, 512, 512), (4, 0))):
            with self.subTest(dims=dims, raw=raw), self.assertRaises(ValueError):
                copy_tensor(view=TensorView(data, (ct.c_int * 4)(*dims), (ct.c_int * 2)(*raw)))

    def test_nonfinite_tensor_rejected(self):
        array = np.array([np.nan], np.float32)
        view = TensorView(array.ctypes.data, (ct.c_int * 4)(1, 1, 1, 1), (ct.c_int * 2)(4, 0))
        with self.assertRaises(ValueError):
            copy_tensor(view=view)

    def test_unsupported_inference_profiles_do_not_call_native_code(self):
        oracle = object.__new__(NativeAlignmentInput)
        oracle.detector, oracle.predictors, oracle.infer_function = Mock(), {120: 1, 160: 2}, Mock()
        for pixels in (np.zeros((119, 119, 3), np.uint8), np.zeros((120, 160, 3), np.uint8),
                       np.zeros((120, 120, 4), np.uint8), np.zeros((120, 120, 3), np.float32)):
            with self.assertRaises(ValueError):
                oracle.infer(pixels=pixels)
        oracle.infer_function.assert_not_called()

    def test_closed_oracle_rejected_before_native_execution(self):
        oracle = object.__new__(NativeAlignmentInput)
        oracle.detector = Mock()
        oracle.detector.require_open.side_effect = ValueError("closed")
        with self.assertRaisesRegex(ValueError, "closed"):
            oracle.infer(pixels=np.zeros((120, 120, 3), np.uint8))


class EntryCaptureTest(unittest.TestCase):
    def fixture(self, *, root):
        capture = root / "capture"
        capture.mkdir()
        index = 0
        for size, kind, dtype in ((120, 2, np.int16), (160, 1, np.int8)):
            profile = root / f"profile-{size}"
            profile.mkdir()
            data = np.full((1, size, size, 3), -127, dtype)
            landmarks = np.arange(212, dtype=np.float32).reshape(1, 1, 1, 212)
            np.save(profile / "actual-network-input.npy", data)
            np.save(profile / "actual-raw-landmarks.npy", landmarks)
            report = {**passing_report(size=size), "input_sha256": sha256(path=profile / "actual-network-input.npy"),
                      "landmarks_sha256": sha256(path=profile / "actual-raw-landmarks.npy")}
            (profile / "report.json").write_text(json.dumps(report))
            for inference in (0, 1):
                for name, value, record_kind, dims, raw in (
                        ("data", data, "espresso-input", f"1,{size},{size},3", f"{kind},6"),
                        ("fc_landmark_s1", landmarks, "espresso-output", "1,1,1,212", "4,0")):
                    path = capture / f"{index:03d}-{record_kind}.json"
                    detail = f"self={size} name={name} inference={inference} dims={dims} raw={raw}"
                    path.write_text(json.dumps({"index": index, "kind": record_kind, "detail": detail, "bytes": value.nbytes}))
                    path.with_suffix(".bin").write_bytes(value.tobytes())
                    index += 1
                path = capture / f"{index:03d}-espresso-inference.json"
                path.write_text(json.dumps({"index": index, "kind": "espresso-inference", "bytes": 0,
                                            "detail": f"self={size} inference={inference} rc=0"}))
                index += 1
        return capture

    def test_exact_entry_bytes_and_outputs_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = verify(capture=self.fixture(root=root), profiles=root)
            self.assertTrue(report["passed"])
            self.assertEqual(len(report["cases"]), 8)

    def test_empty_capture_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            verify(capture=Path(directory), profiles=Path(directory))

    def test_missing_failed_duplicate_and_truncated_evidence_rejected(self):
        for mode in ("missing", "failed", "duplicate", "truncated", "profile-changed"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                capture = self.fixture(root=root)
                if mode == "missing":
                    (capture / "002-espresso-inference.json").unlink()
                elif mode == "failed":
                    path = capture / "002-espresso-inference.json"
                    record = json.loads(path.read_text())
                    record["detail"] = record["detail"].replace("rc=0", "rc=1")
                    path.write_text(json.dumps(record))
                elif mode == "duplicate":
                    path = capture / "000-espresso-input.json"
                    (capture / "099-espresso-input.json").write_text(path.read_text())
                elif mode == "truncated":
                    (capture / "000-espresso-input.bin").write_bytes(b"partial")
                else:
                    (root / "profile-120" / "actual-network-input.npy").write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    verify(capture=capture, profiles=root)

    def test_wrong_entry_bytes_report_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capture = self.fixture(root=root)
            path = capture / "000-espresso-input.bin"
            value = np.fromfile(path, dtype=np.int16)
            value[0] += 1
            path.write_bytes(value.tobytes())
            report = verify(capture=capture, profiles=root)
            self.assertFalse(report["passed"])
            self.assertEqual(report["cases"][0]["mismatches"], 1)

    def test_duplicate_metadata_keys_rejected(self):
        with self.assertRaises(ValueError):
            fields(record={"detail": "self=1 self=2"})


if __name__ == "__main__":
    unittest.main()
