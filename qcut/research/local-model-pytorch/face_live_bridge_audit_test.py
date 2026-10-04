"""Synthetic receipt mutation tests; never a native live acceptance claim."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest

import face_live_bridge_audit as audit
import face_live_worker_test as packets
import face_live_candidate_test as fixtures
from face_live_worker import LiveWorker


def receipts(*, cold_frame=False):
    models = fixtures.FakeHeads()
    models.version = "dependency-core-v1:" + "a" * 64
    worker = LiveWorker(models=models, token=packets.TOKEN, source_key="synthetic-worker-source")
    replies, events, records = [], [], []
    times = [0, 0] if cold_frame else [0, 0, 33333, 33333]
    for index in range(len(times)):
        mode = "seed-160" if index == 0 else "update"
        reply, _, _ = packets.feed(worker=worker, prediction=index, mode=mode, value=100 + index)
        replies.append(reply)
        events.append(dict(op="begin", prediction=index, data=dict(owner=packets.OWNER)))
        _, _, _, call = packets.dependencies(prediction=index, mode=mode, value=100 + index)
        if call:
            events.extend([dict(op="call", prediction=index, data=call), dict(op="infer", prediction=index,
                data=dict(size=160, network=packets.NETWORKS[160], detection_inverse=[[1, 0, 0], [0, 1, 0]]))])
        events.append(dict(op="infer", prediction=index,
                           data=dict(size=120, network=packets.NETWORKS[120], detection_inverse=None)))
        records.append(dict(event="live_candidate_received", prediction=index, timestamp_us=times[index]))
        if cold_frame or index >= 2:
            if not cold_frame or index > 0:
                records.append(dict(event="algorithm_update"))
            records.extend([
                dict(event="face_clone_audit", vector_counts=[1, 0, 0, 0, 0, 0], distinct_buffer=True,
                     primary_metadata_equal=True, primary_points_isolated=True, initial_refcount=0,
                     owned_refcount=1, source_refcount=1, native_analysis_bypassed=False),
                dict(event="live_owned_conversion", prediction=index, timestamp_us=times[index], faces=1,
                     source_points_unchanged=True, candidate_source="fresh-worker-inference", native_analysis_bypassed=False),
                dict(event="live_owned_restored", prediction=index, gpu_complete=True, original_restored=True)])
    observer = dict(passed=True, failures=[], observer_failures=[], predictions=len(times), events=events,
                    callbacks=len(events), target_memory_written=False, software_breakpoints_used=False,
                    target_functions_evaluated=False)
    return dict(worker=replies, observer=observer, records=records, timestamps=times,
                token=packets.TOKEN, source_key="synthetic-worker-source")


class CallbackAuditTests(unittest.TestCase):
    def setUp(self):
        self.data = receipts()

    def test_complete_receipts_are_not_mislabelled_native_head_parity(self):
        result = audit.callbacks(**self.data)
        self.assertEqual(result["predictions"], 4)
        self.assertEqual(result["owned_head_receipts"], 25)
        self.assertEqual(result["owned_point_groups"], 4)
        self.assertEqual(result["conversions"], 2)
        self.assertEqual(result["restorations"], 2)
        self.assertFalse(result["native_head_value_parity_verified"])
        self.assertFalse(result["native_point_value_parity_verified"])
        self.assertEqual(result["bootstrap_unrendered_predictions"], [0, 1])

    def test_cold_frame_requires_every_prediction_to_reach_the_renderer(self):
        data = receipts(cold_frame=True)
        result = audit.callbacks(**data, cold_frame=True)
        self.assertEqual(result["predictions"], 2)
        self.assertEqual(result["conversions"], 2)
        self.assertEqual(result["restorations"], 2)
        self.assertEqual(result["bootstrap_unrendered_predictions"], [])
        self.assertEqual(result["clone_audit"]["native_update_calls"], 1)
        self.assertEqual(result["clone_audit"]["audit_basis"], "live-owned-conversion")
        with self.assertRaises(ValueError):
            audit.callbacks(**data)
        for kind in ("live_owned_conversion", "live_owned_restored"):
            changed = copy.deepcopy(data)
            changed["records"] = [row for row in changed["records"]
                                  if not (row["event"] == kind and row["prediction"] == 0)]
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                audit.callbacks(**changed, cold_frame=True)

    def test_cold_frame_requires_two_real_clone_audits(self):
        data = receipts(cold_frame=True)
        cloned = [row for row in data["records"] if row["event"] == "face_clone_audit"]
        for replacement in ([], cloned[:1], cloned + cloned[:1]):
            changed = copy.deepcopy(data)
            changed["records"] = [row for row in changed["records"] if row["event"] != "face_clone_audit"]
            changed["records"].extend(replacement)
            with self.subTest(count=len(replacement)), self.assertRaises(RuntimeError):
                audit.callbacks(**changed, cold_frame=True)

    def test_cold_frame_rejects_warmed_sequences_and_nonzero_time(self):
        with self.assertRaises(ValueError):
            audit.callbacks(**self.data, cold_frame=True)
        data = receipts(cold_frame=True)
        data["timestamps"] = [1, 1]
        with self.assertRaises(ValueError):
            audit.callbacks(**data, cold_frame=True)

    def test_missing_or_duplicated_worker_prediction_rejected(self):
        for rows in (self.data["worker"][:-1], self.data["worker"] + self.data["worker"][:1]):
            with self.subTest(count=len(rows)), self.assertRaises(ValueError):
                audit.callbacks(**dict(self.data, worker=rows))

    def test_foreign_session_pid_or_timestamp_rejected(self):
        for key, value in (("token", "foreign"), ("pid", 999), ("prediction", 3), ("prediction", True),
                           ("timestamp_us", 4), ("timestamp_us", False), ("ok", 1)):
            data = copy.deepcopy(self.data)
            data["worker"][1][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_head_inventory_shape_hash_and_numeric_types(self):
        for alteration in ("missing", "shape", "hash", "bool-shape"):
            data = copy.deepcopy(self.data)
            heads = data["worker"][0]["result"]["heads"]["160"]
            if alteration == "missing":
                heads.pop("fc_pitch")
            elif alteration == "shape":
                heads["prob"]["shape"][-1] = 3
            elif alteration == "bool-shape":
                heads["prob"]["shape"][0] = True
            else:
                heads["prob"]["sha256"] = "bogus"
            with self.subTest(alteration=alteration), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_native_point_or_model_identity_claims_fail_closed(self):
        for key, value in (("native_final_point_input_used", True), ("captured_tensor_input_used", True),
                           ("native_analysis_bypassed", True), ("candidate_parity_verified", True),
                           ("backend_version", "dependency-core-v1:" + "b" * 64),
                           ("algorithm_rgba_sha256", "bad"), ("frame_number", True)):
            data = copy.deepcopy(self.data)
            data["worker"][1]["result"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_point_nan_boolean_out_of_bounds_and_missing_pairs_rejected(self):
        for invalid in (float("nan"), True, 1.001, -0.01, "0.5"):
            data = copy.deepcopy(self.data)
            data["worker"][0]["result"]["faces"][0]["points"][0][0] = invalid
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                audit.callbacks(**data)
        self.data["worker"][0]["result"]["faces"][0]["points"].pop()
        with self.assertRaises(ValueError):
            audit.callbacks(**self.data)

    def test_causal_seed_proof_rejects_inverse_end_state(self):
        for key, value in (("seed_record_index", 2), ("inverse_source", "post-predict"),
                           ("excluded_160_inferences", [0]), ("caller_source", "cached")):
            data = copy.deepcopy(self.data)
            data["worker"][0]["initialization_proof"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_post_tracking_reseed_proof_is_rejected(self):
        self.data["worker"][1]["initialization_proof"] = self.data["worker"][0]["initialization_proof"]
        with self.assertRaises(ValueError):
            audit.callbacks(**self.data)

    def test_observer_missing_entry_reordering_and_owner_change(self):
        for change in ("call", "order", "owner", "write"):
            data = copy.deepcopy(self.data)
            events = data["observer"]["events"]
            if change == "call":
                events.pop(1)
            elif change == "order":
                events[2], events[3] = events[3], events[2]
            elif change == "owner":
                events[4]["data"]["owner"] += 1
            else:
                data["observer"]["target_memory_written"] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_no_conversion_no_restore_or_noncompleted_gpu_rejected(self):
        for change in ("convert", "restore", "gpu", "native-points", "receipt"):
            data = copy.deepcopy(self.data)
            records = data["records"]
            if change in ("convert", "restore", "receipt"):
                kind = {"convert": "live_owned_conversion", "restore": "live_owned_restored",
                        "receipt": "live_candidate_received"}[change]
                records.pop(next(index for index, row in enumerate(records) if row["event"] == kind))
            elif change == "gpu":
                next(row for row in records if row["event"] == "live_owned_restored")["gpu_complete"] = False
            else:
                next(row for row in records if row["event"] == "live_owned_conversion")["candidate_source"] = "replay"
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit.callbacks(**data)

    def test_missing_or_invalid_stage_timings_and_native_dependencies(self):
        for change in ("absent", "negative", "nan", "ownership"):
            data = copy.deepcopy(self.data)
            row = data["worker"][0]
            timings = row["result"]["stage_timings_ms"]
            if change == "absent":
                timings.pop("inference-160")
            elif change == "ownership":
                row["stage_ownership"]["detection"] = "owned"
            else:
                timings["inference-160"] = -1 if change == "negative" else float("nan")
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit.callbacks(**data)


class FileAuditTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_protocol_requires_every_fresh_request_exactly_once(self):
        expected = b"QCUT\tREADY\t1\nQCUT\tRESULT\tframe-00\t0\n"
        self.assertEqual(audit.protocol(data=expected, requests=[dict(id="frame-00")])["requests"], 1)
        for data in (b"", expected + expected, expected.replace(b"\t0\n", b"\t1\n"), expected + b"[research-error]"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                audit.protocol(data=data, requests=[dict(id="frame-00")])

    def test_jsonl_eof_duplicates_and_scalar_rejected(self):
        path = self.root / "worker.jsonl"
        for data in (b"", b"{}", b'{"ok":true,"ok":false}\n', b"[]\n", b'{"x":NaN}\n'):
            path.write_bytes(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                audit.json_lines(path=path)
        path.write_bytes(b'{"ok":true}\n')
        self.assertEqual(audit.json_lines(path=path), [dict(ok=True)])

    def test_protocol_preserves_bounded_native_rejection_without_accepting_it(self):
        prefix = b"QCUT\tREADY\t1\nQCUT\tRESULT\tframe-00\t0\n"
        request = [dict(id="frame-00"), dict(id="frame-01")]
        failure = b"QCUT\tRESULT\tframe-01\t1\tlive prediction missing or not consumed by renderer\n"
        with self.assertRaisesRegex(ValueError, "frame-01.*not consumed by renderer"):
            audit.protocol(data=prefix + failure, requests=request)
        with self.assertRaises(ValueError) as result:
            audit.protocol(data=prefix + b"QCUT\tRESULT\tframe-01\t1\t" + b"x" * 10000 + b"\n",
                           requests=request)
        self.assertLess(len(str(result.exception)), 600)
        escaped = prefix + b"QCUT\tRESULT\tframe-01\t1\terror\x1b[31m\tmessage\n"
        with self.assertRaises(ValueError) as result:
            audit.protocol(data=escaped, requests=request)
        self.assertNotIn("\x1b", str(result.exception))
        self.assertIn("\\u001b", str(result.exception))

    def test_protocol_does_not_attribute_foreign_or_out_of_order_error(self):
        rows = [dict(id="frame-00"), dict(id="frame-01")]
        for prefix in (b"", b"QCUT\tREADY\t1\n", b"QCUT\tREADY\t1\nQCUT\tRESULT\tforeign\t0\n"):
            with self.subTest(prefix=prefix), self.assertRaisesRegex(ValueError, "exactly once"):
                audit.protocol(data=prefix + b"QCUT\tRESULT\tframe-01\t1\tnative failure\n", requests=rows)

    def test_exact_render_gate_no_tolerance_weakening(self):
        import hashlib

        source = bytes([0, 0, 0, 255])
        changed = bytes([1, 0, 0, 255])
        paths = [self.root / name for name in ("input.rgba", "native.rgba", "live.rgba")]
        for path, value in zip(paths, (source, changed, changed), strict=True):
            path.write_bytes(value)
        frames = [dict(input=str(paths[0]), input_sha256=hashlib.sha256(source).hexdigest(), expect_change=True)]
        request = dict(id="frame-00", frame=0, timestamp=0, timestamp_us=0, warmup=False)
        kwargs = dict(baseline=[dict(request, output=str(paths[1]))], live=[dict(request, output=str(paths[2]))],
                      frames=frames, width=1, height=1)
        self.assertTrue(audit.render_outputs(**kwargs)[0]["equal"])
        paths[2].write_bytes(bytes([2, 0, 0, 255]))
        with self.assertRaisesRegex(ValueError, "zero-tolerance"):
            audit.render_outputs(**kwargs)
        measured = audit.render_outputs(**kwargs, require_equal=False)[0]
        self.assertFalse(measured["equal"])
        self.assertEqual(measured["changed_pixels"], 1)
        self.assertEqual(measured["max_delta"], 1)
        for policy in (None, 0, 1, "false", []):
            with self.subTest(policy=policy), self.assertRaisesRegex(ValueError, "explicit render equality"):
                audit.render_outputs(**kwargs, require_equal=policy)
        paths[1].write_bytes(source)
        paths[2].write_bytes(source)
        with self.assertRaisesRegex(ValueError, "effect control"):
            audit.render_outputs(**kwargs)
        with self.assertRaisesRegex(ValueError, "effect control"):
            audit.render_outputs(**kwargs, require_equal=False)

    def test_negative_effect_control_requires_zero_rgba_change(self):
        import hashlib

        source = bytes([10, 20, 30, 255])
        paths = [self.root / name for name in ("input.rgba", "native.rgba", "live.rgba")]
        for path in paths:
            path.write_bytes(source)
        frames = [dict(input=str(paths[0]), input_sha256=hashlib.sha256(source).hexdigest(), expect_change=False)]
        request = dict(id="frame-00", frame=0, timestamp=0, timestamp_us=0, warmup=False)
        kwargs = dict(baseline=[dict(request, output=str(paths[1]))], live=[dict(request, output=str(paths[2]))],
                      frames=frames, width=1, height=1)
        self.assertTrue(audit.render_outputs(**kwargs)[0]["equal"])
        for channel in range(4):
            changed = bytearray(source)
            changed[channel] ^= 1
            for path in paths[1:]:
                path.write_bytes(changed)
            with self.subTest(channel=channel), self.assertRaisesRegex(ValueError, "effect control"):
                audit.render_outputs(**kwargs)

    def test_effect_control_requires_explicit_boolean(self):
        import hashlib

        source = bytes([10, 20, 30, 255])
        path = self.root / "control.rgba"
        path.write_bytes(source)
        frame = dict(input=str(path), input_sha256=hashlib.sha256(source).hexdigest())
        request = dict(id="frame-00", frame=0, timestamp=0, timestamp_us=0, warmup=False, output=str(path))
        for value in (None, 0, 1, "false", "true", []):
            frame["expect_change"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "effect control"):
                audit.render_outputs(baseline=[request], live=[request], frames=[frame], width=1, height=1)
        frame.pop("expect_change")
        with self.assertRaisesRegex(ValueError, "effect control"):
            audit.render_outputs(baseline=[request], live=[request], frames=[frame], width=1, height=1)


if __name__ == "__main__":
    unittest.main()
