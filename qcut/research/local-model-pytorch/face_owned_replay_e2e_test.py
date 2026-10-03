"""Pure replay evidence contracts; no image decoder or vendor host is invoked."""

import copy
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import face_owned_replay_e2e as probe


def face(*, identity: int = 7) -> dict:
    return {"id": identity,
            "points": [[0.2 + index / 1000, 0.6 - index / 2000] for index in range(106)]}


def replay(*, timestamps: tuple = (0,)) -> dict:
    return dict(version=1, coordinate_space=probe.consumer.COORDINATE_SPACE,
                width=100, height=80, image_sha256="a" * 64,
                frames=[dict(timestamp_us=timestamp, faces=[face()]) for timestamp in timestamps])


def evidence(*, value: dict, shift: float = 0) -> list[dict]:
    records = []
    for frame in value["frames"]:
        applied = copy.deepcopy(frame["faces"])
        for person in applied:
            for index, point in enumerate(person["points"]):
                for axis in range(2):
                    number = point[axis] + (shift if axis == 0 and 52 <= index <= 63 else 0)
                    point[axis] = struct.unpack("<f", struct.pack("<f", number))[0]
        records.extend([
            dict(event="owned_face_conversion", timestamp_us=frame["timestamp_us"],
                 faces=len(applied), faces_before=copy.deepcopy(frame["faces"]), faces_applied=applied,
                 raw_clone_verified=True, original_restored=False, native_analysis_bypassed=False,
                 eye_shift=0, external_points=True, source_points_unchanged=True,
                 owned_points_isolated=True),
            dict(event="owned_face_restored", gpu_complete=True, original_restored=True),
        ])
    return records


def capture(*, records: list[dict]) -> dict:
    return probe.capture_replay(events=records, width=100, height=80, image_hash="a" * 64)


def validate(*, records: list[dict], value: dict, shift: float = 0) -> int:
    return probe.validate_external_events(events=records, replay=value, shift=shift)


class CaptureTests(unittest.TestCase):
    def test_filters_nonconversion_records_without_mutating_input(self):
        value = replay(timestamps=(0, 0, 33_333, 100_000))
        records = [dict(event="algorithm_update"), *evidence(value=value), dict(event="diagnostic")]
        original = copy.deepcopy(records)
        self.assertEqual(capture(records=records), value)
        self.assertEqual(records, original)

    def test_no_conversion_is_not_a_valid_capture(self):
        for records in ([], [dict(event="owned_face_restored")], [dict(event="unknown")]):
            with self.subTest(records=records), self.assertRaises(ValueError):
                capture(records=records)

    def test_missing_capture_fields(self):
        for key in ("timestamp_us", "faces_before"):
            records = evidence(value=replay())
            records[0].pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                capture(records=records)

    def test_invalid_timestamps(self):
        for timestamp in (-1, 100_001, True, 0.0, "0", None):
            records = evidence(value=replay())
            records[0]["timestamp_us"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                capture(records=records)

    def test_capture_rejects_reordered_time(self):
        records = evidence(value=replay(timestamps=(33_333, 0)))
        with self.assertRaises(ValueError):
            capture(records=records)

    def test_capture_frame_limit(self):
        for count in (64, 65):
            records = evidence(value=replay(timestamps=(0,) * count))
            with self.subTest(count=count):
                if count == 64:
                    self.assertEqual(len(capture(records=records)["frames"]), 64)
                    continue
                with self.assertRaises(ValueError):
                    capture(records=records)

    def test_capture_face_container_and_limit(self):
        for faces in (None, {}, "faces", [None], [face(identity=index) for index in range(11)]):
            records = evidence(value=replay())
            records[0]["faces_before"] = faces
            with self.subTest(faces=faces), self.assertRaises(ValueError):
                capture(records=records)

    def test_zero_and_ten_faces_are_valid(self):
        for count in (0, 10):
            value = replay()
            value["frames"][0]["faces"] = [face(identity=index) for index in range(count)]
            with self.subTest(count=count):
                self.assertEqual(capture(records=evidence(value=value)), value)

    def test_capture_rejects_invalid_and_duplicate_ids(self):
        for identity in (-1, 2**31, True, 7.0, "7", None):
            records = evidence(value=replay())
            records[0]["faces_before"][0]["id"] = identity
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                capture(records=records)
        records = evidence(value=replay())
        records[0]["faces_before"].append(copy.deepcopy(records[0]["faces_before"][0]))
        with self.assertRaises(ValueError):
            capture(records=records)

    def test_capture_rejects_missing_or_wrong_point_count(self):
        for points in (None, [], [[0.5, 0.5]] * 105, [[0.5, 0.5]] * 107):
            records = evidence(value=replay())
            records[0]["faces_before"][0]["points"] = points
            with self.subTest(points=points), self.assertRaises(ValueError):
                capture(records=records)

    def test_capture_rejects_malformed_coordinates(self):
        for point in (None, (0.2, 0.4), [0.2], [0.2, 0.4, 0.6], [True, 0.4],
                      [float("nan"), 0.4], [float("inf"), 0.4], [-0.1, 0.4], [0.2, 1.1]):
            records = evidence(value=replay())
            records[0]["faces_before"][0]["points"][0] = point
            with self.subTest(point=point), self.assertRaises(ValueError):
                capture(records=records)


class ExternalEvidenceTests(unittest.TestCase):
    def test_float32_roundtrip_is_the_expected_published_value(self):
        value = replay(timestamps=(0, 33_333))
        value["frames"][0]["faces"][0]["points"][0][0] = 0.412345678
        records = json.loads(json.dumps(evidence(value=value)))
        self.assertNotEqual(records[0]["faces_applied"][0]["points"][0][0], 0.412345678)
        self.assertEqual(validate(records=records, value=value), 2)

    def test_unrounded_double_is_not_float32_publication_evidence(self):
        value = replay()
        records = evidence(value=value)
        records[0]["faces_applied"][0]["points"][0][0] = value["frames"][0]["faces"][0]["points"][0][0]
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)

    def test_validation_does_not_mutate_replay_or_records(self):
        value = replay()
        records = evidence(value=value)
        originals = copy.deepcopy((value, records))
        self.assertEqual(validate(records=records, value=value), 1)
        self.assertEqual((value, records), originals)

    def test_extra_diagnostic_records_do_not_count_as_conversions(self):
        value = replay()
        records = [dict(event="unrelated", external_points=False), *evidence(value=value)]
        self.assertEqual(validate(records=records, value=value), 1)

    def test_missing_unknown_or_duplicate_conversion_is_rejected(self):
        value = replay()
        records = evidence(value=value)
        unknown = copy.deepcopy(records)
        unknown[0]["event"] = "owned_face_conversion_unknown"
        for candidate in ([], records[1:], unknown, records + records):
            with self.subTest(candidate=candidate), self.assertRaises(RuntimeError):
                validate(records=candidate, value=value)

    def test_isolation_flags_require_literal_true(self):
        for key in ("external_points", "source_points_unchanged", "owned_points_isolated", "raw_clone_verified"):
            for replacement in (False, None, 1, "true", "unknown", []):
                value = replay()
                records = evidence(value=value)
                records[0][key] = replacement
                with self.subTest(key=key, replacement=replacement), self.assertRaises(RuntimeError):
                    validate(records=records, value=value)

    def test_missing_isolation_and_conversion_evidence_is_rejected(self):
        for key in ("external_points", "source_points_unchanged", "owned_points_isolated", "raw_clone_verified",
                    "original_restored", "native_analysis_bypassed", "eye_shift", "timestamp_us", "faces"):
            value = replay()
            records = evidence(value=value)
            records[0].pop(key)
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                validate(records=records, value=value)

    def test_restoration_must_follow_conversion_and_complete_gpu_work(self):
        value = replay()
        records = evidence(value=value)
        for candidate in (records[:1], records + records[1:], records[::-1]):
            with self.subTest(candidate=candidate), self.assertRaises(RuntimeError):
                validate(records=candidate, value=value)
        for key in ("gpu_complete", "original_restored"):
            for replacement in (None, False, 1, "true"):
                candidate = evidence(value=value)
                candidate[1][key] = replacement
                with self.subTest(key=key, replacement=replacement), self.assertRaises(RuntimeError):
                    validate(records=candidate, value=value)
            candidate = evidence(value=value)
            candidate[1].pop(key)
            with self.subTest(missing=key), self.assertRaises(RuntimeError):
                validate(records=candidate, value=value)

    def test_native_analysis_claim_and_premature_restoration_are_rejected(self):
        for key in ("native_analysis_bypassed", "original_restored"):
            value = replay()
            records = evidence(value=value)
            records[0][key] = True
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                validate(records=records, value=value)

    def test_timestamp_value_and_order_must_match_replay(self):
        value = replay(timestamps=(0, 33_333))
        records = evidence(value=value)
        for candidate in (records[2:] + records[:2], copy.deepcopy(records)):
            candidate[0]["timestamp_us"] = 1
            with self.subTest(candidate=candidate), self.assertRaises(RuntimeError):
                validate(records=candidate, value=value)

    def test_timestamp_requires_integer_not_equal_float_or_boolean(self):
        value = replay()
        for timestamp in (0.0, False, "0", None):
            records = evidence(value=value)
            records[0]["timestamp_us"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(RuntimeError):
                validate(records=records, value=value)

    def test_face_ids_and_order_are_preserved(self):
        value = replay()
        value["frames"][0]["faces"].append(face(identity=21))
        self.assertEqual(validate(records=evidence(value=value), value=value), 1)
        records = evidence(value=value)
        records[0]["faces_applied"].reverse()
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)
        records = evidence(value=value)
        records[0]["faces_applied"][0]["id"] = 9
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)

    def test_face_id_type_is_not_an_equal_float(self):
        value = replay()
        records = evidence(value=value)
        records[0]["faces_applied"][0]["id"] = 7.0
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)

    def test_applied_and_declared_face_counts_match_payload(self):
        value = replay()
        for applied in (None, [], [face(), face(identity=8)], {}, "faces"):
            records = evidence(value=value)
            records[0]["faces_applied"] = applied
            with self.subTest(applied=applied), self.assertRaises(RuntimeError):
                validate(records=records, value=value)
        records = evidence(value=value)
        records[0]["faces"] = 0
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)

    def test_empty_face_frame_is_supported(self):
        value = replay()
        value["frames"][0]["faces"] = []
        self.assertEqual(validate(records=evidence(value=value), value=value), 1)

    def test_missing_and_extra_coordinates_are_rejected(self):
        for count in (0, 105, 107):
            value = replay()
            records = evidence(value=value)
            records[0]["faces_applied"][0]["points"] = [[0.5, 0.5]] * count
            with self.subTest(count=count), self.assertRaises(RuntimeError):
                validate(records=records, value=value)
        value = replay()
        records = evidence(value=value)
        records[0]["faces_applied"][0].pop("points")
        with self.assertRaises(RuntimeError):
            validate(records=records, value=value)

    def test_malformed_point_evidence_is_rejected(self):
        for point in (None, (0.2, 0.4), [0.2], [0.2, 0.4, 0.6], [True, 0.4],
                      [float("nan"), 0.4], [float("inf"), 0.4], ["0.2", 0.4]):
            value = replay()
            records = evidence(value=value)
            records[0]["faces_applied"][0]["points"][0] = point
            with self.subTest(point=point), self.assertRaises(RuntimeError):
                validate(records=records, value=value)

    def test_any_changed_axis_or_eye_boundary_is_rejected(self):
        for index in (0, 51, 52, 63, 64, 105):
            for axis in (0, 1):
                value = replay()
                records = evidence(value=value)
                records[0]["faces_applied"][0]["points"][index][axis] += 0.00001
                with self.subTest(index=index, axis=axis), self.assertRaises(RuntimeError):
                    validate(records=records, value=value)

    def test_only_eye_x_accepts_requested_shift(self):
        value = replay()
        for shift in (-0.02, -0.01, 0.01, 0.02):
            records = evidence(value=value, shift=shift)
            with self.subTest(shift=shift):
                self.assertEqual(validate(records=records, value=value, shift=shift), 1)
                with self.assertRaises(RuntimeError):
                    validate(records=records, value=value)


class ShiftTests(unittest.TestCase):
    def test_only_eye_x_changes_on_all_faces_and_frames(self):
        value = replay(timestamps=(0, 33_333))
        value["frames"][0]["faces"].append(face(identity=21))
        original = copy.deepcopy(value)
        shifted = probe.shifted_replay(replay=value, shift=0.02)
        self.assertEqual(value, original)
        for before, after in zip(value["frames"], shifted["frames"], strict=True):
            self.assertEqual(after["timestamp_us"], before["timestamp_us"])
            for source, target in zip(before["faces"], after["faces"], strict=True):
                self.assertEqual(target["id"], source["id"])
                for index, (a, b) in enumerate(zip(source["points"], target["points"], strict=True)):
                    self.assertEqual(b, [a[0] + (0.02 if 52 <= index <= 63 else 0), a[1]])
        for key in ("version", "coordinate_space", "width", "height", "image_sha256"):
            self.assertEqual(shifted[key], value[key])

    def test_zero_shift_returns_a_deeply_independent_payload(self):
        value = replay()
        shifted = probe.shifted_replay(replay=value, shift=0)
        self.assertEqual(shifted, value)
        shifted["frames"][0]["faces"][0]["points"][0][0] = 0.9
        shifted["frames"][0]["faces"][0]["id"] = 21
        shifted["frames"].append(dict(timestamp_us=100_000, faces=[]))
        self.assertEqual(value, replay())

    def test_two_candidates_do_not_share_coordinates(self):
        value = replay()
        plus = probe.shifted_replay(replay=value, shift=0.01)
        minus = probe.shifted_replay(replay=value, shift=-0.01)
        minus_original = copy.deepcopy(minus)
        plus["frames"][0]["faces"][0]["points"][52][0] = 0.9
        self.assertEqual(value, replay())
        self.assertEqual(minus, minus_original)

    def test_perturbation_must_be_finite_numeric_and_bounded(self):
        for shift in (-0.0200001, 0.0200001, float("nan"), float("inf"), -float("inf"),
                      True, False, "0.01", None, 10**1000):
            value = replay()
            with self.subTest(shift=shift), self.assertRaises(ValueError):
                probe.shifted_replay(replay=value, shift=shift)
            self.assertEqual(value, replay())

    def test_coordinate_overflow_rejects_without_mutating_input(self):
        for coordinate, shift in ((0.99, 0.02), (0.01, -0.02)):
            value = replay()
            value["frames"][0]["faces"][0]["points"][52][0] = coordinate
            original = copy.deepcopy(value)
            with self.subTest(coordinate=coordinate), self.assertRaises(ValueError):
                probe.shifted_replay(replay=value, shift=shift)
            self.assertEqual(value, original)

    def test_exact_normalized_boundaries_and_empty_faces(self):
        for coordinate, shift in ((0.98, 0.02), (0.02, -0.02)):
            value = replay()
            value["frames"][0]["faces"][0]["points"][52][0] = coordinate
            with self.subTest(coordinate=coordinate):
                result = probe.shifted_replay(replay=value, shift=shift)
                self.assertEqual(result["frames"][0]["faces"][0]["points"][52][0], coordinate + shift)
        value = replay()
        value["frames"][0]["faces"] = []
        self.assertEqual(probe.shifted_replay(replay=value, shift=0.02), value)

    def test_shift_revalidates_provenance_and_unmodified_points(self):
        for key, replacement in (("version", 2), ("coordinate_space", "pixels")):
            value = replay()
            value[key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.shifted_replay(replay=value, shift=0)
        value = replay()
        value["frames"][0]["faces"][0]["points"][0][1] = float("nan")
        with self.assertRaises(ValueError):
            probe.shifted_replay(replay=value, shift=0)


class EnvironmentTests(unittest.TestCase):
    def test_poisoned_native_environment_is_removed_or_rebuilt(self):
        poisoned = {key: "poison" for key in (
            "QCUT_FRAME_WIDTH", "QCUT_FRAME_HEIGHT", "QCUT_FACE_BIND_REPLAY", "QCUT_FACE_BIND_EYE_SHIFT",
            "QCUT_FACE_REPLAY", "QCUT_FACE_POINT_SHIFT", "QCUT_CONSUMER_RECORD", "QCUT_TRACE_UPDATES",
            "QCUT_CONSUMER_TRACE", "QCUT_UNKNOWN", "DYLD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
            "DYLD_FRAMEWORK_PATH", "MTL_CAPTURE_ENABLED", "MTL_DEBUG_LAYER")}
        with patch.dict(os.environ, {**poisoned, "PATH": "/safe/bin", "LANG": "C"}, clear=True):
            result = probe.environment(runtime=Path("/runtime"), directory=Path("/records"), width=100, height=80)
            self.assertEqual(os.environ["QCUT_FACE_BIND_REPLAY"], "poison")
        self.assertEqual(result, {
            "PATH": "/safe/bin", "LANG": "C", "QCUT_FRAME_WIDTH": "100", "QCUT_FRAME_HEIGHT": "80",
            "DYLD_LIBRARY_PATH": "/runtime/Frameworks", "QCUT_TRACE_UPDATES": "1",
            "QCUT_FACE_POINT_SHIFT": "0", "QCUT_CONSUMER_RECORD": "/records/records.jsonl",
            "QCUT_FACE_BIND_REPLAY": "/records/replay.bin"})

    def test_output_specific_replay_paths_do_not_leak_between_calls(self):
        with patch.dict(os.environ, {}, clear=True):
            first = probe.environment(runtime=Path("/one"), directory=Path("/first"), width=100, height=80)
            second = probe.environment(runtime=Path("/two"), directory=Path("/second"), width=7, height=9)
        self.assertEqual(first["QCUT_FACE_BIND_REPLAY"], "/first/replay.bin")
        self.assertEqual(second["QCUT_FACE_BIND_REPLAY"], "/second/replay.bin")
        self.assertEqual(second["DYLD_LIBRARY_PATH"], "/two/Frameworks")
        self.assertEqual(second["QCUT_FRAME_WIDTH"], "7")
        self.assertEqual(second["QCUT_FRAME_HEIGHT"], "9")


class RejectionTests(unittest.TestCase):
    def invoke(self, *, directory: Path, outcome: object):
        with patch.object(probe.subprocess, "run", return_value=outcome) as process:
            result = probe.reject_case(directory=directory, host=Path("/never-run/host"), runtime=Path("/runtime"),
                                       package=Path("/package"), payload=b"bad-payload", width=100, height=80,
                                       requests="exit\n", error="truncated replay payload")
        return result, process

    def test_positive_exit_and_exact_guard_evidence_are_required(self):
        for code in (1, 2, 127):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / "reject"
                outcome = subprocess.CompletedProcess(args=[], returncode=code,
                                                      stdout="[research-error] truncated replay payload\n", stderr="")
                result, process = self.invoke(directory=directory, outcome=outcome)
                self.assertIsNone(result)
                self.assertEqual((directory / "replay.bin").read_bytes(), b"bad-payload")
                self.assertEqual((directory / "host.log").read_text(), outcome.stdout)
                process.assert_called_once()
                self.assertEqual(process.call_args.args[0], ["/never-run/host", "/runtime", "/runtime/Models", "/package"])
                self.assertEqual(process.call_args.kwargs["input"], "exit\n")
                self.assertEqual(process.call_args.kwargs["timeout"], 45)
                self.assertIs(process.call_args.kwargs["text"], True)
                self.assertIs(process.call_args.kwargs["capture_output"], True)
                self.assertEqual(process.call_args.kwargs["env"]["QCUT_FACE_BIND_REPLAY"], str(directory / "replay.bin"))

    def test_zero_or_signal_exit_is_not_a_successful_guard(self):
        for code in (0, -6, -9, -11, -15):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temporary:
                outcome = subprocess.CompletedProcess(args=[], returncode=code,
                                                      stdout="[research-error] truncated replay payload", stderr="")
                with self.assertRaises(RuntimeError):
                    self.invoke(directory=Path(temporary) / "reject", outcome=outcome)

    def test_error_in_stderr_is_accepted_and_persisted(self):
        with tempfile.TemporaryDirectory() as temporary:
            outcome = subprocess.CompletedProcess(args=[], returncode=1, stdout="READY\n",
                                                  stderr="[research-error] truncated replay payload\n")
            directory = Path(temporary) / "reject"
            self.invoke(directory=directory, outcome=outcome)
            self.assertEqual((directory / "host.log").read_text(), outcome.stdout + outcome.stderr)

    def test_nonzero_exit_without_expected_error_is_rejected(self):
        for log in ("", "host failed", "truncated replay payload", "[research-error] wrong identity"):
            with self.subTest(log=log), tempfile.TemporaryDirectory() as temporary:
                outcome = subprocess.CompletedProcess(args=[], returncode=1, stdout=log, stderr="")
                with self.assertRaises(RuntimeError):
                    self.invoke(directory=Path(temporary) / "reject", outcome=outcome)

    def test_timeout_and_process_launch_failure_propagate(self):
        for error in (subprocess.TimeoutExpired(cmd="host", timeout=45), OSError("cannot launch")):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary) / "reject"
                with patch.object(probe.subprocess, "run", side_effect=error) as process:
                    with self.assertRaises(type(error)):
                        probe.reject_case(directory=directory, host=Path("/never-run/host"), runtime=Path("/runtime"),
                                          package=Path("/package"), payload=b"bad", width=100, height=80,
                                          requests="exit\n", error="truncated replay payload")
                process.assert_called_once()
                self.assertEqual((directory / "replay.bin").read_bytes(), b"bad")
                self.assertFalse((directory / "host.log").exists())

    def test_existing_case_directory_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            marker = directory / "replay.bin"
            marker.write_bytes(b"preserve")
            with patch.object(probe.subprocess, "run") as process, self.assertRaises(FileExistsError):
                probe.reject_case(directory=directory, host=Path("/never-run/host"), runtime=Path("/runtime"),
                                  package=Path("/package"), payload=b"new", width=100, height=80,
                                  requests="exit\n", error="truncated replay payload")
            process.assert_not_called()
            self.assertEqual(marker.read_bytes(), b"preserve")


if __name__ == "__main__":
    unittest.main()
