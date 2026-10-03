"""Mocked snapshot I/O and host lifecycle regressions; no native calls or assets."""

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, call, patch

import face_host_geometry_probe as probe
from face_host_geometry_contract_test import geometry_row, inactive_row


class SnapshotTests(unittest.TestCase):
    def read_records(self, *, records):
        paths = [Path(f"/synthetic/prediction-{index}.json") for index in range(len(records))]
        payloads = {path: row if isinstance(row, bytes) else json.dumps(row).encode()
                    for path, row in zip(paths, records, strict=True)}
        directory = Mock(spec=Path)
        directory.glob.return_value = paths
        with patch.object(probe.sequence, "bounded_bytes", side_effect=lambda *, path, limit: payloads[path]) as reader:
            result = probe.snapshots(directory=directory)
        directory.glob.assert_called_once_with("prediction-*.json")
        self.assertTrue(all(call.kwargs["limit"] == 512 * 1024 for call in reader.call_args_list))
        return result

    def test_complete_rows_and_inactive_allocated_pools_are_accepted(self):
        for row in (geometry_row(), inactive_row()):
            self.assertEqual(self.read_records(records=[row]), [row])
        self.assertEqual(len(self.read_records(records=[geometry_row(index=index) for index in range(64)])), 64)

    def test_empty_faces_and_nullable_cached_matrices_are_valid(self):
        row = geometry_row()
        for name in ("cached_forward", "cached_inverse"):
            row["faces"][0][name] = None
        self.assertEqual(self.read_records(records=[row]), [row])
        row["faces"] = []
        self.assertEqual(self.read_records(records=[row]), [row])

    def test_zero_or_65_paths_are_rejected_before_reads(self):
        for count in (0, 65):
            directory = Mock(spec=Path)
            directory.glob.return_value = [Path(f"prediction-{index}.json") for index in range(count)]
            with self.subTest(count=count), patch.object(probe.sequence, "bounded_bytes") as reader:
                with self.assertRaises(ValueError):
                    probe.snapshots(directory=directory)
                reader.assert_not_called()

    def test_discovery_order_is_canonicalized_by_prediction_index(self):
        rows = [geometry_row(index=index) for index in (2, 0, 1)]
        self.assertEqual([row["index"] for row in self.read_records(records=rows)], [0, 1, 2])

    def test_duplicate_negative_and_gapped_indices_are_rejected(self):
        for indices in ((0, 0), (-1, 0), (1,), (0, 2), (0, 1, 3)):
            with self.subTest(indices=indices), self.assertRaises(ValueError):
                self.read_records(records=[geometry_row(index=index) for index in indices])

    def test_index_and_return_code_require_real_integers(self):
        for field in ("index", "rc"):
            for value in (False, True, 0.0, "0", None, -1, 1):
                row = geometry_row()
                row[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.read_records(records=[row])

    def test_observer_error_is_never_ignored(self):
        for value in ("unreadable geometry field", "", None, False):
            row = geometry_row()
            row["error"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read_records(records=[row])
        with self.assertRaises(ValueError):
            self.read_records(records=[dict(index=0, error="partial capture")])

    def test_malformed_json_duplicate_fields_and_nonfinite_values_are_rejected(self):
        for value in (None, [], 0, "row", b"{", b'{"index":0,"index":0}',
                      b'{"index":0,"value":NaN}', b'{"index":0,"value":Infinity}', b'{"index":0,"value":1e999}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read_records(records=[value])

    def test_partial_prediction_and_face_records_are_rejected(self):
        row = geometry_row()
        for field in row:
            changed = {key: value for key, value in row.items() if key != field}
            with self.subTest(missing=field), self.assertRaises(ValueError):
                self.read_records(records=[changed])
        for field in row["faces"][0]:
            changed = deepcopy(row)
            changed["faces"][0].pop(field)
            with self.subTest(missing_face_field=field), self.assertRaises(ValueError):
                self.read_records(records=[changed])

    def test_api_pool_and_predictor_objects_have_strict_shapes(self):
        for field, values in (("api", (None, [], {}, "unknown", "FsNew_DoPredict240")),
                              ("faces", (None, {}, [None], [False], [{}], [geometry_row()["faces"][0]] * 11)),
                              ("predictors", (None, {}, [], [None, None], [False, False], [{}, {}]))):
            for value in values:
                row = geometry_row()
                row[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.read_records(records=[row])

    def test_handles_predictor_pointers_and_alignment_pointers_are_typed(self):
        for field in ("handle", "predictor", "provider", "network", "alignment"):
            for value in (False, True, None, 0, 4095, 8192.0, "8192", [], 2**64):
                row = geometry_row()
                owner = row if field == "handle" else row["faces"][0] if field == "alignment" else row["predictors"][0]
                owner[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.read_records(records=[row])

    def test_predictor_sizes_are_ordered_exact_integer_profiles(self):
        for value in (None, [], [120.0, 120], [True, 120], [120, False], [0, 120], [121, 120]):
            row = geometry_row()
            row["predictors"][0]["size"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read_records(records=[row])
        row = geometry_row()
        row["predictors"].reverse()
        with self.assertRaises(ValueError):
            self.read_records(records=[row])

    def test_request_and_neural_sequence_integer_fields_reject_booleans(self):
        for position in range(5):
            row = geometry_row()
            row["request"][position] = False
            with self.subTest(position=position), self.assertRaises(ValueError):
                self.read_records(records=[row])
        for value in (None, [], [0, 640, 480, 2560], [0, True, 480, 2560, 0], [0, 0, 480, 2560, 0],
                      [0, 4097, 480, 16388, 0], [0, 640, 480, 1, 0]):
            row = geometry_row()
            row["request"] = value
            with self.subTest(request=value), self.assertRaises(ValueError):
                self.read_records(records=[row])
        for value in (False, True, None, -1, 16.0, "16"):
            row = geometry_row()
            row["bytenn_sequence"] = value
            with self.subTest(sequence=value), self.assertRaises(ValueError):
                self.read_records(records=[row])

    def test_face_slots_dimensions_and_scale_are_bounded_and_typed(self):
        for field, values in (("slot", (False, True, -1, 10, 0.0, None)),
                              ("active", (None, 0, 1, "true")),
                              ("id", (False, True, None, 1.0, -1, 2**31)),
                              ("tracking_id", (False, True, None, 1.0, -1, 2**31)),
                              ("base_size", (None, [], [True, 120], [120.0, 120], [0, 120], [32769, 120])),
                              ("tracking_size", (None, [160, False], [160, -1])),
                              ("frame_size", (None, [True, 640], [480, -1], [480, 4097])),
                              ("tracking_scale", (None, False, "1.0", 32769.0))):
            for value in values:
                row = geometry_row()
                row["faces"][0][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.read_records(records=[row])
        row = geometry_row()
        row["faces"].append(deepcopy(row["faces"][0]))
        with self.assertRaises(ValueError):
            self.read_records(records=[row])

    def test_float_tables_are_complete_finite_bounded_numeric_arrays(self):
        for field in ("base", "tracking"):
            for value in (None, [], [0.0] * 211, [0.0] * 213,
                          [False, *([0.0] * 211)], ["0", *([0.0] * 211)], [None, *([0.0] * 211)],
                          [257.0, *([0.5] * 211)], [float("nan"), *([0.5] * 211)],
                          [float("inf"), *([0.0] * 211)]):
                row = geometry_row()
                row["tables"][field] = value
                with self.subTest(field=field, length=len(value) if isinstance(value, list) else None,
                                  first=value[0] if isinstance(value, list) and value else None), self.assertRaises(ValueError):
                    self.read_records(records=[row])
        for value in (None, [], {}, {"base": [0.0] * 212, "order": list(range(106))}):
            row = geometry_row()
            row["tables"] = value
            with self.subTest(tables=value), self.assertRaises(ValueError):
                self.read_records(records=[row])

    def test_order_table_is_an_exact_integer_permutation(self):
        for value in (None, [], list(range(105)), [0] * 106, [False, *range(1, 106)],
                      [0.0, *range(1, 106)], [-1, *range(1, 106)], [106, *range(1, 106)]):
            row = geometry_row()
            row["tables"]["order"] = value
            with self.subTest(order_type=type(value).__name__, first=value[0] if value else None), self.assertRaises(ValueError):
                self.read_records(records=[row])

    def test_point_matrices_reject_wrong_dimensions_and_unsafe_values(self):
        for name in ("stage1", "mapped", "tracked"):
            for value in ([], [[]], [[0.0] * 106], [[0.0] * 106] * 3, [[0.0] * 106, [0.0] * 105],
                          [[0.0] * 281] * 2, [[True], [0.0]], [["0"], [0.0]], [[32769.0], [0.0]]):
                row = geometry_row()
                row["faces"][0][name] = value
                with self.subTest(name=name, rows=len(value)), self.assertRaises(ValueError):
                    self.read_records(records=[row])

    def test_affine_matrices_require_two_rows_three_columns_and_safe_values(self):
        for name in ("forward", "inverse", "cached_forward", "cached_inverse", "detection_forward", "detection_inverse"):
            for value in ([], [[1.0, 0.0, 0.0]], [[1.0, 0.0], [0.0, 1.0]],
                          [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]],
                          [[False, 0.0, 0.0], [0.0, 1.0, 0.0]],
                          [[1.0, None, 0.0], [0.0, 1.0, 0.0]], [[32769.0, 0.0, 0.0], [0.0, 1.0, 0.0]]):
                row = geometry_row()
                row["faces"][0][name] = value
                with self.subTest(name=name, rows=len(value)), self.assertRaises(ValueError):
                    self.read_records(records=[row])


class AlgorithmFrameTests(unittest.TestCase):
    def frame_record(self, *, index=0, width=2):
        row = geometry_row(index=index)
        row.update(request=[0, width, 2, width * 4, 0], frame_file=f"frame-{index}.rgba", frame_bytes=width * 2 * 4)
        return row

    def test_old_records_without_frames_return_empty_without_reads(self):
        for records in ([], [geometry_row(), geometry_row(index=1)]):
            locked = Mock()
            with self.subTest(count=len(records)):
                self.assertEqual(probe.algorithm_frames(records=records, directory=Path("/frames"), locked=locked), [])
                locked.read.assert_not_called()

    def test_partial_frame_capture_is_rejected_before_reads(self):
        named, sized = self.frame_record(), self.frame_record()
        named.pop("frame_bytes")
        sized.pop("frame_file")
        for records in ([self.frame_record(), geometry_row(index=1)], [named], [sized]):
            locked = Mock()
            with self.subTest(fields=list(records[0])), self.assertRaises(ValueError):
                probe.algorithm_frames(records=records, directory=Path("/frames"), locked=locked)
            locked.read.assert_not_called()

    def test_traversal_names_and_untyped_or_wrong_byte_sizes_are_rejected_before_reads(self):
        for field, values in (("frame_file", (None, False, "../frame-0.rgba", "/frame-0.rgba", "frame-1.rgba")),
                              ("frame_bytes", (False, True, 16.0, "16", None, [], {}, 0, 15, 17))):
            for value in values:
                locked = Mock()
                row = dict(self.frame_record(), **{field: value})
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    probe.algorithm_frames(records=[row], directory=Path("/frames"), locked=locked)
                locked.read.assert_not_called()

    def test_truncated_or_oversized_read_is_rejected(self):
        for length in (0, 15, 17):
            locked = Mock(read=Mock(return_value=b"\0" * length))
            with self.subTest(length=length), self.assertRaisesRegex(ValueError, "byte count"):
                probe.algorithm_frames(records=[self.frame_record()], directory=Path("/frames"), locked=locked)
            locked.read.assert_called_once_with(path=Path("/frames/frame-0.rgba"), maximum=16)

    def test_successful_frames_have_exact_names_byte_limits_and_content_hashes(self):
        data = [bytes(range(16)), bytes(range(24))]
        locked = Mock(read=Mock(side_effect=data))
        records = [self.frame_record(), self.frame_record(index=1, width=3)]
        actual = probe.algorithm_frames(records=records, directory=Path("/frames"), locked=locked)
        self.assertEqual(actual, [dict(prediction=index, file=f"frame-{index}.rgba", bytes=len(value),
                                       sha256=hashlib.sha256(value).hexdigest()) for index, value in enumerate(data)])
        self.assertEqual(locked.read.call_args_list, [call(path=Path(f"/frames/frame-{index}.rgba"), maximum=len(value))
                                                     for index, value in enumerate(data)])


class RunFailureTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.base = Path(directory.name)
        self.capture, self.runtime, self.package = (self.base / name for name in ("capture", "runtime", "package"))
        for path in (self.capture, self.runtime, self.package):
            path.mkdir()
        frames = self.capture / "control/original"
        frames.mkdir(parents=True)
        self.pixels = bytes((1, 2, 3, 255))
        for index in range(4):
            (frames / f"frame-{index}.rgba").write_bytes(self.pixels)
        self.control = dict(passed=True, owned_result_rendered=True, native_analysis_bypassed=False,
                            width=1, height=1, image_sha256="0" * 64, input_rgba_sha256="1" * 64,
                            parameters={}, source_sha256={})
        self.previous = dict(passed=True, native_analysis_bypassed=False, host_sha256="2" * 64,
                             observer_sha256="3" * 64, source_sha256={}, comparisons=[dict(equal=True)] * 4)
        self.locked = Mock(files={})
        self.locked.json.side_effect = lambda *, path: deepcopy(self.control if path.parent.name == "control" else self.previous)
        self.locked.read.return_value = b"synthetic locked fixture"
        self.host = Mock(protocol_rows=["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(6)),
                                        *(f"QCUT\tRESULT\tframe-{index}\t0" for index in range(4))], reader_error=None)
        self.host.render.side_effect = lambda **kwargs: kwargs["output_path"].write_bytes(self.pixels)
        self.compiler = Mock(side_effect=self.compile_observer)
        self.factory, self.library = Mock(return_value=self.host), Mock()
        row = geometry_row()
        row["request"], row["faces"][0]["frame_size"] = [0, 1, 1, 4, 0], [1, 1]
        self.records = Mock(return_value=[row])
        self.inventory = Mock(return_value=dict(successful_inferences=2, networks={}))
        self.associations = Mock(return_value=[dict(prediction=0, neural_window=[0, 16], inferences=[])])
        self.events = Mock(return_value=dict(owned_result_rendered=True, native_analysis_bypassed=False))
        self.fresh = Mock()
        patches = (patch.object(probe.sequence, "fresh_output", self.fresh), patch.object(probe, "LockedFiles", return_value=self.locked),
                   patch.object(probe.consumer, "verify_library", self.library), patch.object(probe.subprocess, "run", self.compiler),
                   patch.object(probe.replay, "environment", side_effect=lambda **_kwargs: {"QCUT_FACE_BIND_REPLAY": "/synthetic/replay.bin"}),
                   patch.object(probe.sequence, "BoundedHost", self.factory), patch.object(probe, "snapshots", self.records),
                   patch.object(probe.models, "inventory", self.inventory), patch.object(probe.sequence, "validate_owned_events", self.events),
                   patch.object(probe, "associate_inferences", self.associations))
        for replacement in patches:
            replacement.start()
            self.addCleanup(replacement.stop)
        self.attempt = 0

    def compile_observer(self, command, **_kwargs):
        Path(command[-1]).write_bytes(b"synthetic observer")
        (Path(command[-1]).parent / "observed/records.jsonl").write_bytes(b"synthetic events\n")

    def run_probe(self):
        self.attempt += 1
        self.out = self.base / f"out-{self.attempt}"
        self.out.mkdir()
        self.fresh.return_value = self.out
        return probe.run(args=argparse.Namespace(capture=self.capture, runtime=self.runtime, package=self.package, out=self.out))

    def assert_failed(self, *, error, message):
        with self.assertRaisesRegex(error, message):
            self.run_probe()
        report = json.loads((self.out / "report.json").read_text())
        self.assertIs(report["passed"], False)
        self.assertIs(report["geometry_observer_only"], True)
        self.assertIs(report["per_face_inference_association_verified"], False)
        self.assertEqual(len(report["failures"]), 1)
        self.assertIn(message, report["failures"][0])
        return report

    def test_mocked_success_preserves_observer_scope_and_closes_host(self):
        report = self.run_probe()
        self.assertIs(report["passed"], True)
        self.assertIs(report["geometry_observer_only"], True)
        self.assertIs(report["per_face_inference_association_verified"], False)
        self.assertEqual(len(report["comparisons"]), 4)
        self.assertEqual(self.host.render.call_count, 10)
        self.host.finish.assert_called_once_with()
        self.host.close.assert_called_once_with()
        self.locked.verify.assert_called_once_with()
        self.assertEqual(self.library.call_count, 2)
        environment = self.factory.call_args.kwargs["environment"]
        self.assertNotIn("QCUT_FACE_BIND_REPLAY", environment)
        self.assertIn("QCUT_FACE_GEOMETRY_DIR", environment)

    def test_unpassed_or_bypassed_baseline_fails_before_compile(self):
        for owner, field, value in ((self.previous, "passed", 1), (self.control, "passed", False),
                                    (self.control, "owned_result_rendered", 1), (self.control, "native_analysis_bypassed", 0)):
            original = owner[field]
            owner[field] = value
            with self.subTest(field=field, value=value):
                self.assert_failed(error=ValueError, message="owned baseline")
                self.compiler.assert_not_called()
                self.factory.assert_not_called()
            owner[field] = original

    def test_boolean_noninteger_or_unbounded_frame_dimensions_fail_before_compile(self):
        for field in ("width", "height"):
            for value in (False, True, 1.0, 0, -1, 4097):
                self.control[field] = value
                with self.subTest(field=field, value=value):
                    self.assert_failed(error=ValueError, message="frame dimensions")
                    self.compiler.assert_not_called()
                self.control[field] = 1

    def test_locked_input_failure_is_reported_before_host_creation(self):
        self.locked.read.side_effect = ValueError("fixture identity changed")
        self.assert_failed(error=ValueError, message="fixture identity changed")
        self.factory.assert_not_called()

    def test_compile_failure_and_host_creation_failure_are_reported(self):
        self.compiler.side_effect = subprocess.CalledProcessError(1, ["synthetic-compiler"])
        self.assert_failed(error=subprocess.CalledProcessError, message="non-zero exit status")
        self.factory.assert_not_called()
        self.compiler.side_effect = self.compile_observer
        self.factory.side_effect = RuntimeError("host creation failed")
        self.assert_failed(error=RuntimeError, message="host creation failed")

    def test_receive_render_and_finish_failures_close_host(self):
        for operation in ("receive", "render", "finish"):
            method = getattr(self.host, operation)
            original = method.side_effect
            method.side_effect = RuntimeError(f"{operation} failed")
            self.host.close.reset_mock()
            with self.subTest(operation=operation):
                self.assert_failed(error=RuntimeError, message=f"{operation} failed")
                self.host.close.assert_called_once_with()
                self.records.assert_not_called()
            method.side_effect = original

    def test_invalid_parameters_cannot_leave_a_live_host(self):
        with patch.object(probe.consumer, "parameters_json", side_effect=ValueError("invalid parameters")):
            self.assert_failed(error=ValueError, message="invalid parameters")
        self.host.receive.assert_not_called()
        if self.factory.called:
            self.host.close.assert_called_once_with()

    def test_pixel_changes_fail_neutrality_and_close_host(self):
        self.pixels = bytes((9, 2, 3, 255))
        report = self.assert_failed(error=RuntimeError, message="changed beauty pixels")
        self.assertEqual(len(report["comparisons"]), 1)
        self.assertIs(report["comparisons"][0]["equal"], False)
        self.host.close.assert_called_once_with()
        self.host.finish.assert_not_called()

    def test_protocol_mismatch_or_reader_error_rejects_closed_host(self):
        original = self.host.protocol_rows
        for rows, error in ((original[:-1], None), (original, RuntimeError("reader failed"))):
            self.host.protocol_rows, self.host.reader_error = rows, error
            self.host.close.reset_mock()
            with self.subTest(reader_error=error):
                self.assert_failed(error=RuntimeError, message="protocol or bounded log")
                self.host.close.assert_called_once_with()
                self.records.assert_not_called()

    def test_event_snapshot_and_inventory_failures_are_recorded_after_cleanup(self):
        for operation in (self.events, self.records, self.inventory, self.associations):
            operation.side_effect = ValueError("malformed captured state")
            self.host.close.reset_mock()
            with self.subTest(operation=operation):
                self.assert_failed(error=ValueError, message="malformed captured state")
                self.host.close.assert_called_once_with()
                self.locked.verify.assert_not_called()
            operation.side_effect = None

    def test_empty_or_inactive_face_pools_are_not_successful_geometry(self):
        row = deepcopy(self.records.return_value[0])
        row["faces"][0]["active"] = False
        for faces in ([], row["faces"]):
            self.records.return_value = [dict(row, faces=faces)]
            self.host.close.reset_mock()
            with self.subTest(pool="inactive" if faces else "empty"):
                self.assert_failed(error=RuntimeError, message="no actual alignment geometry")
                self.host.close.assert_called_once_with()

    def test_late_provenance_and_library_failures_keep_passed_false(self):
        self.locked.verify.side_effect = ValueError("fixture mutated during execution")
        self.assert_failed(error=ValueError, message="fixture mutated during execution")
        self.locked.verify.side_effect = None
        self.library.side_effect = [None, ValueError("late library mismatch")]
        self.assert_failed(error=ValueError, message="late library mismatch")


if __name__ == "__main__":
    unittest.main()
