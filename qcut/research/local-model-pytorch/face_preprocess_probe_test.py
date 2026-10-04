"""Synthetic protocol/tensor contracts; never launch a host or write fixtures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import MagicMock, Mock, patch

import numpy as np

import face_preprocess_probe as probe


def frames():
    return [dict(timestamp=value, input=Path(f"/synthetic/input-{index}.rgba"),
                 parameters={"label": "tab\there\nnext", "amount": index})
            for index, value in enumerate((0, 1 / 30, 0.0000005, 0.25, 0.25, 0.1, 0))]


def protocol_rows():
    return ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{i}\t0" for i in range(6)),
            *(f"QCUT\tRESULT\tframe-{i:02d}\t0" for i in range(7))]


def owned_rows(*, profile):
    timestamps = [0] * 10 + [int(row["timestamp"] * 1_000_000 + 0.5) for row in profile for _ in range(2)]
    rows = []
    for timestamp in timestamps:
        rows.extend([dict(event="owned_face_conversion", raw_clone_verified=True, original_restored=False,
                          native_analysis_bypassed=False, eye_shift=0, faces=1, external_points=False,
                          source_points_unchanged=True, owned_points_isolated=True, timestamp_us=timestamp),
                     dict(event="owned_face_restored", gpu_complete=True, original_restored=True)])
    return rows


def trace_profile():
    records, associations, predictions, events = [], [], [], []
    for index in range(26):
        request = [0, 1448, 1086, 5792, index]
        predictor = dict(predictor=32768, provider=36864, network=40960)
        records.append(dict(handle=8192, request=request, predictors=[{}, predictor],
                            faces=[dict(active=False, id=9, alignment=12345),
                                   dict(active=True, id=index + 1, alignment=16384)]))
        associations.append(dict(prediction=index, neural_window=[index * 8, (index + 1) * 8],
                                 inferences=[dict(size=256, network="999", inference=index, record_index=index * 8),
                                             dict(size=160, network="40960", inference=index, record_index=index * 8 + 1)]))
        predictions.append(dict(index=index, owner=8192, request=list(request)))
        if index in (0, 20):
            events.append(dict(prediction=index, owner=8192, call=dict(alignment=16384), **predictor))
    trace = dict(passed=True, software_breakpoints_used=False, target_memory_written=False,
                 target_functions_evaluated=False, failures=[], observer_failures=[],
                 maximum_active_breakpoints=4, predictions=predictions, events=events, pending=None)
    return trace, records, associations


class LockedBytes:
    def __init__(self, *, files):
        self.files = files
        self.calls = []

    def read(self, *, path, maximum, expected=None):
        self.calls.append(dict(path=path, maximum=maximum, expected=expected))
        data = self.files[path]
        if len(data) > maximum:
            raise ValueError("synthetic read exceeds bound")
        if expected is not None and hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("synthetic digest mismatch")
        return data


class RequestsTests(unittest.TestCase):
    def test_exact_13_requests_six_warmups_seven_frames_and_exit(self):
        profile, directory = frames(), Path("/synthetic/out with spaces")
        before = deepcopy(profile)
        text = probe.requests(frames=profile, directory=directory)
        rows = text.splitlines()
        self.assertEqual(len(rows), 14)
        self.assertEqual(rows[-1], "exit")
        self.assertTrue(text.endswith("exit\n"))
        for ordinal, row in enumerate(rows[:-1]):
            warmup = ordinal < 6
            index = 0 if warmup else ordinal - 6
            name = f"warmup-{ordinal}" if warmup else f"frame-{index:02d}"
            cells = row.split("\t")
            self.assertEqual(len(cells), 6)
            self.assertEqual(cells[:5], ["render", name, str(profile[index]["timestamp"]),
                                         str(profile[index]["input"]), str(directory / f"{name}.rgba")])
            self.assertEqual(json.loads(cells[5]), profile[index]["parameters"])
        self.assertEqual(profile, before)

    def test_not_exactly_seven_frames_rejected(self):
        for count in (0, 1, 6, 8, 13):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "seven-frame"):
                probe.requests(frames=[frames()[0]] * count, directory=Path("/synthetic"))

    def test_output_protocol_delimiters_rejected(self):
        for delimiter in ("\t", "\n", "\r", "\0"):
            with self.subTest(delimiter=repr(delimiter)), self.assertRaisesRegex(ValueError, "delimiter"):
                probe.requests(frames=frames(), directory=Path("/synthetic/" + delimiter))

    def test_input_protocol_delimiters_rejected(self):
        for delimiter in ("\t", "\n", "\r", "\0"):
            profile = frames()
            profile[6]["input"] = Path("/synthetic/input" + delimiter + "injected")
            with self.subTest(delimiter=repr(delimiter)), self.assertRaisesRegex(ValueError, "delimiter"):
                probe.requests(frames=profile, directory=Path("/synthetic"))

    def test_nonfinite_parameters_rejected(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            profile = frames()
            profile[0]["parameters"] = {"nested": [dict(value=value)]}
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.requests(frames=profile, directory=Path("/synthetic"))


class ProtocolTests(unittest.TestCase):
    def validate(self, *, rows=None, events=None):
        directory = Path("/synthetic/observed")
        stdout = "diagnostic before\n" + "\n".join(protocol_rows() if rows is None else rows) + "\n"
        records = b"\n".join(json.dumps(row).encode() for row in
                             (owned_rows(profile=frames()) if events is None else events)) + b"\n"
        locked = LockedBytes(files={directory / "host.stdout": stdout.encode(),
                                    directory / "records.jsonl": records})
        result = probe.validate_protocol(directory=directory, frames=frames(), locked=locked)
        self.assertEqual([row["maximum"] for row in locked.calls], [probe.sequence.LOG_LIMIT] * 2)
        self.assertEqual(result["records_sha256"], hashlib.sha256(records).hexdigest())
        return result

    def test_exact_order_counts_and_rounded_repeated_reverse_timestamps(self):
        result = self.validate()
        self.assertEqual(result["protocol_rows"], protocol_rows())
        self.assertEqual(result["owned_face_conversions"], 24)
        self.assertEqual(result["owned_face_restorations"], 24)

    def test_missing_extra_duplicate_failed_and_reordered_results(self):
        expected = protocol_rows()
        bad_rows = [expected[:-1], expected + [expected[-1]], expected[1:],
                    [expected[0], expected[2], expected[1], *expected[3:]],
                    [*expected[:-1], "QCUT\tRESULT\tframe-06\t1"], expected + ["QCUT\tUNKNOWN\t0"]]
        for rows in bad_rows:
            with self.subTest(rows=rows[-2:]), self.assertRaisesRegex(ValueError, "protocol/order"):
                self.validate(rows=rows)

    def test_exact_timestamps_not_just_conversion_counts(self):
        for index in (0, 18, 24, 46):
            events = owned_rows(profile=frames())
            events[index]["timestamp_us"] += 1
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "timestamps"):
                self.validate(events=events)

    def test_exact_counts_and_restore_order_required(self):
        events = owned_rows(profile=frames())
        for bad in (events[:-2], events + events[:2], [events[1], events[0], *events[2:]],
                    [events[0], events[2], events[1], events[3], *events[4:]]):
            with self.subTest(count=len(bad)), self.assertRaises(RuntimeError):
                self.validate(events=bad)

    def test_native_analysis_isolation_and_gpu_completion_required(self):
        for field, value, index in (("native_analysis_bypassed", True, 0), ("external_points", True, 0),
                                    ("source_points_unchanged", False, 0), ("owned_points_isolated", False, 0),
                                    ("timestamp_us", False, 0), ("gpu_complete", False, 1)):
            events = owned_rows(profile=frames())
            events[index][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.validate(events=events)


class TraceTests(unittest.TestCase):
    def validate(self, *, trace, records, associations):
        return probe.validate_trace(trace=trace, records=records, associations=associations)

    def test_exact_26_predictions_and_two_actual_crop_associations(self):
        trace, records, associations = trace_profile()
        before = deepcopy((trace, records, associations))
        result = self.validate(trace=trace, records=records, associations=associations)
        self.assertEqual([row["prediction"] for row in result], [0, 20])
        for row in result:
            index = row["prediction"]
            self.assertEqual(row["face_id"], index + 1)
            self.assertEqual(row["neural_window"], [index * 8, (index + 1) * 8])
            self.assertEqual((row["inference"], row["record_index"]), (index, index * 8 + 1))
            self.assertIs(row["event"], trace["events"][0 if index == 0 else 1])
        self.assertEqual((trace, records, associations), before)

    def test_readonly_claims_failure_lists_and_hardware_budget_are_strict(self):
        mutations = [(field, value) for field in ("passed", "software_breakpoints_used",
                     "target_memory_written", "target_functions_evaluated") for value in (None, 0, 1)]
        mutations += [(field, ["failure"]) for field in ("failures", "observer_failures")]
        mutations += [("maximum_active_breakpoints", value) for value in (0, 5, True, 4.0, "4")]
        for field, value in mutations:
            trace, records, associations = trace_profile()
            trace[field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, "read-only"):
                self.validate(trace=trace, records=records, associations=associations)

    def test_pending_or_missing_completion_evidence_rejected(self):
        for pending in ({"prediction": 20}, {}, False, "missing"):
            trace, records, associations = trace_profile()
            if pending == "missing":
                trace.pop("pending")
            else:
                trace["pending"] = pending
            with self.subTest(pending=pending), self.assertRaises(ValueError):
                self.validate(trace=trace, records=records, associations=associations)

    def test_missing_required_claim_or_prediction_fields_rejected(self):
        for field in ("passed", "software_breakpoints_used", "target_memory_written", "target_functions_evaluated",
                      "failures", "observer_failures", "maximum_active_breakpoints", "predictions", "events"):
            trace, records, associations = trace_profile()
            trace.pop(field)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(trace=trace, records=records, associations=associations)
        for field in ("index", "owner", "request"):
            trace, records, associations = trace_profile()
            trace["predictions"][25].pop(field)
            with self.subTest(prediction_field=field), self.assertRaises(ValueError):
                self.validate(trace=trace, records=records, associations=associations)

    def test_exact_prediction_event_and_record_counts(self):
        for field, count in (("predictions", 25), ("predictions", 27), ("events", 1), ("events", 3)):
            trace, records, associations = trace_profile()
            trace[field] = (trace[field] * 2)[:count]
            with self.subTest(field=field, count=count), self.assertRaisesRegex(ValueError, "profile"):
                self.validate(trace=trace, records=records, associations=associations)
        for count in (25, 27):
            trace, records, associations = trace_profile()
            with self.subTest(records=count), self.assertRaises(ValueError):
                self.validate(trace=trace, records=(records * 2)[:count], associations=associations)

    def test_every_prediction_index_owner_and_request_checked(self):
        for index in (0, 13, 25):
            for field, value in (("index", 99), ("owner", 8193), ("request", [0] * 5)):
                trace, records, associations = trace_profile()
                trace["predictions"][index][field] = value
                with self.subTest(index=index, field=field), self.assertRaisesRegex(ValueError, "ownership"):
                    self.validate(trace=trace, records=records, associations=associations)

    def test_crop_prediction_order_type_and_owner(self):
        for value in (1, 19, False, 0.0):
            trace, records, associations = trace_profile()
            trace["events"][0]["prediction"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "actual 160"):
                self.validate(trace=trace, records=records, associations=associations)
        trace, records, associations = trace_profile()
        trace["events"].reverse()
        with self.assertRaises(ValueError):
            self.validate(trace=trace, records=records, associations=associations)

    def test_face_predictor_provider_network_and_neural_associations_reject(self):
        for index in (0, 20):
            for field in ("owner", "predictor", "provider", "network", "alignment", "faces", "inferences", "window_network"):
                trace, records, associations = trace_profile()
                event = trace["events"][0 if index == 0 else 1]
                if field == "alignment":
                    event["call"][field] += 1
                elif field == "faces":
                    records[index]["faces"][1]["active"] = False
                elif field == "inferences":
                    associations[index]["inferences"] = associations[index]["inferences"][:1]
                elif field == "window_network":
                    associations[index]["inferences"][1]["network"] = "40961"
                else:
                    event[field] += 1
                with self.subTest(index=index, field=field), self.assertRaisesRegex(ValueError, "association"):
                    self.validate(trace=trace, records=records, associations=associations)

    def test_ambiguous_active_faces_or_160_inferences_refused(self):
        for field in ("faces", "inferences"):
            trace, records, associations = trace_profile()
            rows = records[20][field] if field == "faces" else associations[20][field]
            rows.append(deepcopy(rows[1]))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "association"):
                self.validate(trace=trace, records=records, associations=associations)


class InputsTests(unittest.TestCase):
    def setUp(self):
        self.directory, self.files, self.cases = Path("/synthetic/trace"), {}, []
        self.inventory = {"networks": {"40960": {"inputs": []}}}
        for index in (0, 20):
            event = dict(network=40960)
            prepared = (np.arange(76800, dtype=np.uint32) + index).astype(np.uint8).tobytes()
            for key in ("source", "crop", "resized", "prepared"):
                pixels = prepared if key in ("resized", "prepared") else b"\x00\x80\xff"
                name = f"prediction-{index:02d}-{key}.bgr"
                event[key] = dict(file=name, rows=160 if len(pixels) == 76800 else 1,
                                  cols=160 if len(pixels) == 76800 else 1, sha256=probe.digest(data=pixels))
                self.files[self.directory / name] = pixels
            actual = (np.frombuffer(prepared, dtype=np.uint8).astype(np.int16) - 128).astype(np.int8).tobytes()
            path = Path(f"/synthetic/tensor-{index}.bin")
            self.files[path] = actual
            self.inventory["networks"]["40960"]["inputs"].append(dict(inference=index, name="data", raw=[1, 6],
                dims_nwhc=[1, 160, 160, 3], path=str(path), sha256=probe.digest(data=actual)))
            self.cases.append(dict(prediction=index, face_id=index + 1, inference=index,
                                   neural_window=[index * 8, (index + 1) * 8], record_index=index * 8 + 1, event=event))
        self.locked = LockedBytes(files=self.files)

    def compare(self):
        return probe.compare_inputs(cases=self.cases, inventory=self.inventory, trace_dir=self.directory, locked=self.locked)

    def test_unsigned_offset_equals_actual_signed_int8_including_extremes(self):
        rows = self.compare()
        self.assertEqual([row["different_values"] for row in rows], [0, 0])
        self.assertEqual([row["maximum_difference"] for row in rows], [0, 0])
        self.assertEqual([row["prediction"] for row in rows], [0, 20])
        self.assertEqual(len(self.locked.calls), 10)
        self.assertEqual([row["maximum"] for row in self.locked.calls], [16 * 1024**2] * 4 + [76800] + [16 * 1024**2] * 4 + [76800])
        self.assertTrue(all(row["expected"] for row in self.locked.calls))
        for row, case in zip(rows, self.cases, strict=True):
            self.assertEqual(row["prepared_sha256"], case["event"]["prepared"]["sha256"])
            self.assertEqual(row["face_id"], case["face_id"])

    def test_matching_inference_and_data_name_are_unique(self):
        rows = self.inventory["networks"]["40960"]["inputs"]
        for mutation in ("wrong_inference", "wrong_name", "duplicate", "raw", "dims"):
            saved = deepcopy(rows)
            if mutation == "duplicate":
                rows.append(deepcopy(rows[0]))
            else:
                key, value = {"wrong_inference": ("inference", 999), "wrong_name": ("name", "output"),
                              "raw": ("raw", [1, 0]), "dims": ("dims_nwhc", [1, 160, 160, 4])}[mutation]
                rows[0][key] = value
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "signed int8"):
                self.compare()
            rows[:] = saved

    def test_filename_dimension_and_hash_correlations(self):
        for key in ("source", "crop", "resized", "prepared"):
            for field, value in (("file", "../escaped.bgr"), ("rows", 2), ("sha256", "0" * 64)):
                row = self.cases[0]["event"][key]
                before = deepcopy(row)
                row[field] = value
                with self.subTest(key=key, field=field), self.assertRaises(ValueError):
                    self.compare()
                row.update(before)

    def test_actual_tensor_byte_count_and_hash_checked(self):
        row = self.inventory["networks"]["40960"]["inputs"][0]
        path, original = Path(row["path"]), self.files[Path(row["path"])]
        for data, refresh_hash in ((original[:-1], True), (original + b"\0", True), (b"x" * 76800, False)):
            self.files[path] = data
            row["sha256"] = probe.digest(data=data if refresh_hash else original)
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                self.compare()

    def test_normalization_mismatch_not_unsigned_reinterpretation(self):
        row = self.inventory["networks"]["40960"]["inputs"][0]
        path = Path(row["path"])
        for data in (self.files[self.directory / "prediction-00-prepared.bgr"], b"\x7f" + self.files[path][1:]):
            self.files[path], row["sha256"] = data, probe.digest(data=data)
            with self.subTest(first=data[0]), self.assertRaisesRegex(ValueError, "normalization unresolved"):
                self.compare()


class BoundedProcessTests(unittest.TestCase):
    def setUp(self):
        self.log = Mock(spec=Path)
        self.log.open.return_value = MagicMock()
        self.stream = self.log.open.return_value.__enter__.return_value
        self.log.stat.return_value.st_size = probe.sequence.LOG_LIMIT
        self.process = Mock(pid=43210)
        self.popen = self.enterContext(patch.object(probe.subprocess, "Popen", return_value=self.process))
        self.tree = Mock()
        self.tree.wait.return_value = 0
        self.tracker = self.enterContext(patch.object(probe, "ProcessTree", return_value=self.tree))

    def run_process(self, *, stdin=None):
        probe.bounded_process(command=["fake-host", "argument with spaces"], environment={"SAFE": "1"}, log=self.log, stdin=stdin)

    def test_success_exact_log_bound_exclusive_file_and_no_shell(self):
        self.run_process()
        self.log.open.assert_called_once_with("xb")
        self.popen.assert_called_once_with(["fake-host", "argument with spaces"], env={"SAFE": "1"},
            stdin=subprocess.DEVNULL, stdout=self.stream, stderr=subprocess.STDOUT, start_new_session=True)
        self.tracker.assert_called_once_with(process=self.process)
        self.tree.wait.assert_called_once_with(timeout=probe.DEADLINE)
        self.tree.terminate.assert_called_once()

    def test_explicit_stdin_preserved(self):
        stdin = Mock()
        self.run_process(stdin=stdin)
        self.assertIs(self.popen.call_args.kwargs["stdin"], stdin)

    def test_nonzero_and_oversized_logs_rejected_after_reaping(self):
        self.tree.wait.return_value = 17
        with self.assertRaisesRegex(RuntimeError, "failed: 17"):
            self.run_process()
        self.tree.wait.return_value = 0
        self.log.stat.return_value.st_size += 1
        with self.assertRaisesRegex(ValueError, "log exceeds bound"):
            self.run_process()
        self.assertEqual(self.tree.terminate.call_count, 2)

    def test_timeout_and_interrupt_cleanup_tracked_descendants(self):
        for error in (subprocess.TimeoutExpired("fake-host", probe.DEADLINE), KeyboardInterrupt()):
            self.tree.wait.side_effect = error
            self.tree.wait.reset_mock()
            self.tree.terminate.reset_mock()
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)) as caught:
                self.run_process()
            self.assertIs(caught.exception, error)
            self.tree.terminate.assert_called_once()
            self.tree.wait.assert_called_once_with(timeout=probe.DEADLINE)

    def test_popen_failure_does_not_signal_unrelated_process(self):
        self.popen.side_effect = OSError("fake launch failed")
        with self.assertRaisesRegex(OSError, "fake launch failed"):
            self.run_process()
        self.tracker.assert_not_called()

    def test_exclusive_log_open_failure_does_not_launch(self):
        self.log.open.side_effect = FileExistsError("existing log")
        with self.assertRaises(FileExistsError):
            self.run_process()
        self.popen.assert_not_called()
        self.tracker.assert_not_called()

    def test_cleanup_failure_is_not_reported_as_success(self):
        self.tree.terminate.side_effect = RuntimeError("owned process survived")
        with self.assertRaisesRegex(RuntimeError, "survived"):
            self.run_process()


class EnvironmentTests(unittest.TestCase):
    def test_system_allowlist_drops_credentials_and_injections(self):
        allowed = {key: f"safe-{key}" for key in probe.SYSTEM_ENV_KEYS}
        hostile = {"OPENAI_API_KEY": "secret", "AWS_SECRET_ACCESS_KEY": "secret", "PYTHONPATH": "/hostile",
                   "DYLD_INSERT_LIBRARIES": "/hostile.dylib", "LD_PRELOAD": "/hostile.so",
                   "QCUT_FACE_BIND_REPLAY": "/injected", "QCUT_FRAME_WIDTH": "wrong"}
        with patch.dict(probe.os.environ, {**allowed, **hostile}, clear=True):
            self.assertEqual(probe.system_environment(), allowed)

    def test_host_allowlist_excludes_replay_and_candidate_observers(self):
        for key in ("OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "PYTHONPATH", "LD_PRELOAD",
                    "DYLD_INSERT_LIBRARIES", "QCUT_FACE_BIND_REPLAY", "QCUT_FACE_REPLAY"):
            with self.subTest(key=key):
                self.assertNotIn(key, probe.SYSTEM_ENV_KEYS | probe.HOST_ENV_KEYS)


if __name__ == "__main__":
    unittest.main()
