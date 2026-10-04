"""Synthetic temporal-report audit tests; no native runtime or vendor tensors."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from face_host_geometry_contract_test import geometry_row
import face_temporal_capture_audit as audit

SHA_A, SHA_B, SHA_C, SHA_D = (character * 64 for character in "abcd")


def point_metric(*, exact=True):
    return dict(exact=exact, within=exact, max_abs=0 if exact else 0.5,
                mean_l2=0 if exact else 0.5, max_l2=0 if exact else 0.5,
                worst_point_index=0, tolerance=0)


def pixel_metric(*, exact=True, sha=SHA_C):
    return dict(equal=exact, changed_pixels=0 if exact else 8, max_delta=0 if exact else 12,
                bbox=None if exact else [10, 20, 30, 40], sha256=sha)


def fixture(*, diagnostic=False):
    frames = [dict(image=f"/synthetic/frame-{index}.png", timestamp=index / 30, parameters={"eye": 1},
                   expect_change=index not in (3, 5), label=f"frame-{index}", image_sha256=SHA_B, input_rgba_sha256=SHA_A)
              for index in range(7)]
    profile = audit.request_profile(frames=frames)
    requests = [dict(request_id=name, timestamp=stamp, passed=True, owned_face_conversions=0 if index == 0 else 2,
                     owned_face_restorations=0 if index == 0 else 2) for index, (name, stamp) in enumerate(profile)]
    protocol = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\t{name}\t0" for name, _ in profile)]
    run = dict(reader_error=None, owned_face_conversions=24, owned_face_restorations=24, records_sha256=SHA_B,
               protocol_rows=protocol, requests=requests)
    snapshots, windows, samples, cases, descriptors, payload_frames = [], [], [], [], [], []
    networks = {"32768": dict(inputs=[])}
    inference, marker = 0, 0
    times = [stamp for _, stamp in profile for _ in range(2)][2:]
    for index in range(26):
        snapshot = geometry_row(index=index)
        face = snapshot["faces"][0]
        face.update(active=index not in (18, 19), id=0 if index < 20 else 1)
        points = [[0.0, 1.0] for _ in range(106)]
        snapshot["returned_result"] = dict(count=int(face["active"]), faces=[dict(index=0, points_xy=[v for point in points for v in point])] if face["active"] else [])
        items, lower = [], marker
        if index != 19:
            items.append(dict(size=120, inference=inference, network="32768", record_index=marker))
            marker += 1
            networks["32768"]["inputs"].append(dict(name="data", inference=inference, sha256=SHA_A))
            samples.append(dict(prediction=index, inference=inference, slot=0, active=face["active"], sampling_exact=True,
                                input_sha256=SHA_A, algorithm_frame_sha256=SHA_B))
            inference += 1
        else:
            samples.append(dict(prediction=index, idle=True))
        if index in (0, 20):
            items.append(dict(size=160, inference=0 if index == 0 else 1, network="57344", record_index=marker))
            marker += 1
        snapshot["bytenn_sequence"] = marker
        snapshots.append(snapshot)
        windows.append(dict(prediction=index, neural_window=[lower, marker], inferences=items))
        descriptors.append(dict(prediction=index, file=f"frame-{index}.rgba", bytes=640 * 480 * 4, sha256=SHA_B))
        checks = {name: point_metric() for name in ("stage1", "tracked")} if face["active"] else {}
        if index >= 2 and face["active"]:
            checks["normalized"] = point_metric(exact=not (diagnostic and index == 14))
        layer = dict(returned_faces=int(face["active"]), consumer_observed=index >= 2,
                     post_tracking_changed=diagnostic and index == 14,
                     tracked_to_returned=[point_metric(exact=not (diagnostic and index == 14))] if face["active"] else [],
                     returned_to_consumer=[point_metric()] if face["active"] and index >= 2 else [],
                     returned_to_consumer_exact=True if index >= 2 else None)
        case = dict(prediction=index, active_faces=int(face["active"]), published_faces=int(face["active"]),
                    idle=index == 19, checks=checks, native_output_layers=layer)
        if index >= 2:
            case["timestamp_us"] = round(times[index - 2] * 1_000_000)
            payload_frames.append(dict(timestamp_us=case["timestamp_us"], faces=[dict(id=face["id"], points=[[0.0, 0.5]] * 106)] if face["active"] else []))
        cases.append(case)
    baseline, comparisons = [], []
    for index in range(7):
        sha = SHA_A if index in (3, 5) else SHA_C
        baseline.append(dict(index=index, baseline_sha256=sha, **pixel_metric(sha=sha)))
        candidate_sha = SHA_D if diagnostic and index == 1 else sha
        comparisons.append(dict(index=index, baseline_sha256=sha, **pixel_metric(exact=not (diagnostic and index == 1), sha=candidate_sha),
                                versus_input=pixel_metric(exact=index in (3, 5), sha=candidate_sha)))
    shared = dict(native_analysis_bypassed=False, source_sha256={"local-model-pytorch/example.py": SHA_B}, failures=[])
    capture = dict(deepcopy(shared), passed=True, geometry_observer_only=True, observer_pixel_parity_verified=True,
                   per_prediction_inference_association_verified=True, predictions=26, width=640, height=480,
                   warmup_requests_per_host=6, seeks_per_request=2, frames=frames, geometry_snapshots=snapshots,
                   prediction_inferences=windows, algorithm_frames=descriptors, captures=dict(networks=networks),
                   comparisons=baseline, runs=[dict(deepcopy(run), name=name) for name in ("baseline", "observed")])
    replay = dict(deepcopy(shared), passed=not diagnostic, completed=True, geometry_exact=not diagnostic, diagnostic_only=diagnostic,
                  independent_120_sampling_input_used=True, returned_result_observed=True, returned_to_consumer_exact=True,
                  per_active_face_id_association_verified=True, manifest_frames=7, head_comparisons=135, capture_sha256=SHA_A,
                  replay_sha256=SHA_D, cases=cases, sampling_cases=samples, post_tracking_gap_predictions=[14] if diagnostic else [])
    render = dict(deepcopy(shared), passed=not diagnostic, completed=True, diagnostic_only=diagnostic,
                  external_replay_verified=True, pixel_parity_verified=not diagnostic, capture_sha256=SHA_A,
                  replay_sha256=SHA_D, manifest_sha256=SHA_C, width=640, height=480, frames=deepcopy(frames),
                  warmup_requests_per_host=6, seeks_per_request=2, comparisons=comparisons, runs=[dict(deepcopy(run), name="candidate")])
    for report in (capture, render):
        for host in report["runs"]:
            for index, comparison in enumerate(report["comparisons"]):
                host["requests"][6 + index]["sha256"] = comparison["sha256"]
    payload = dict(version=1, coordinate_space=audit.consumer.COORDINATE_SPACE, width=640, height=480,
                   image_sha256=SHA_C, frames=payload_frames)
    return dict(capture=capture, sequence_replay=replay, sequence_render=render, capture_sha256=SHA_A,
                replay_sha256=SHA_D, manifest_sha256=SHA_C, replay_payload=payload)


class AuditTests(unittest.TestCase):
    def test_pre_and_post_tracking_detections_are_counted_without_becoming_extra_seeds(self):
        inputs = fixture()
        marker = 0
        for index, association in enumerate(inputs["capture"]["prediction_inferences"]):
            items = association["inferences"]
            if index in (0, 20):
                tracking, detection = items
                detection["inference"] = 0 if index == 0 else 2
                items = [detection, tracking, dict(detection, inference=detection["inference"] + 1)]
            if index == 24:
                items = [*items, dict(size=160, inference=4, network="57344")]
            lower = marker
            for item in items:
                item["record_index"] = marker
                marker += 1
            association.update(inferences=items, neural_window=[lower, marker])
            inputs["capture"]["geometry_snapshots"][index]["bytenn_sequence"] = marker
        inputs["sequence_replay"]["head_comparisons"] = 150
        result = audit.audit_reports(**inputs)
        self.assertTrue(result["pipeline_parity"])
        self.assertEqual(result["head_comparisons"], 150)

    def test_three_inference_window_rejects_ambiguity_and_duplicate_markers(self):
        for failure in ("two-before", "two-after", "duplicate-marker", "duplicate-inference", "wrong-owner", "four", "no-face"):
            inputs = fixture()
            capture = inputs["capture"]
            snapshot = capture["geometry_snapshots"][0]
            association = capture["prediction_inferences"][0]
            tracking, detection = association["inferences"]
            items = [dict(detection, record_index=0), dict(tracking, record_index=1),
                     dict(detection, inference=2, record_index=2)]
            if failure == "two-before":
                items[1]["record_index"], items[2]["record_index"] = 2, 1
            elif failure == "two-after":
                items[0]["record_index"], items[1]["record_index"] = 1, 0
            elif failure == "duplicate-marker":
                items[2]["record_index"] = 1
            elif failure == "duplicate-inference":
                items[2]["inference"] = items[0]["inference"]
            elif failure == "wrong-owner":
                items[2]["network"] = "65536"
            elif failure == "four":
                items.append(dict(detection, inference=3, record_index=3))
            else:
                snapshot["faces"][0]["active"] = False
            association.update(inferences=items, neural_window=[0, len(items)])
            snapshot["bytenn_sequence"] = len(items)
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                audit.sampling_window(capture=capture, snapshot=snapshot, association=association,
                                      sampling=inputs["sequence_replay"]["sampling_cases"][0], used=set())

    def test_all_exact_is_completed_and_pipeline_parity_without_independence_claim(self):
        inputs = fixture()
        original = deepcopy(inputs)
        result = audit.audit_reports(**inputs)
        self.assertTrue(result["completed"])
        self.assertTrue(result["pipeline_parity"])
        self.assertTrue(result["passed"])
        self.assertFalse(result["product_parity_verified"])
        self.assertFalse(result["raw_evidence_revalidated"])
        self.assertFalse(result["source_hashes_verified"])
        self.assertEqual(result["no_face_predictions"], [18, 19])
        self.assertEqual(result["stages"]["sampling"]["compared"], 25)
        self.assertEqual(result["stages"]["stage1"]["compared"], 24)
        self.assertEqual(result["stages"]["returned_to_consumer"]["compared"], 22)
        self.assertEqual(result["head_comparisons"], 135)
        self.assertEqual(inputs, original)

    def test_diagnostic_remains_failed_and_isolates_post_tracking_and_pixels(self):
        result = audit.audit_reports(**fixture(diagnostic=True))
        self.assertTrue(result["completed"])
        self.assertFalse(result["pipeline_parity"])
        self.assertTrue(result["stages"]["sampling"]["exact"])
        self.assertTrue(result["stages"]["stage1"]["exact"])
        self.assertTrue(result["stages"]["tracked"]["exact"])
        self.assertTrue(result["stages"]["returned_to_consumer"]["exact"])
        self.assertEqual(result["stages"]["tracked_to_returned"]["failed_indices"], [14])
        self.assertEqual(result["stages"]["normalized"]["failed_indices"], [14])
        self.assertEqual(result["stages"]["final_pixels"]["failed_indices"], [1])

    def test_failed_diagnostic_is_not_promoted_when_all_metrics_are_exact(self):
        inputs = fixture()
        inputs["sequence_replay"].update(passed=False, diagnostic_only=True)
        result = audit.audit_reports(**inputs)
        self.assertTrue(result["completed"])
        self.assertFalse(result["pipeline_parity"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["report_flags"]["sequence_replay"]["passed"])

    def test_failed_renderer_stays_failed_even_with_exact_pixel_metrics(self):
        inputs = fixture()
        inputs["sequence_render"].update(passed=False, diagnostic_only=True)
        result = audit.audit_reports(**inputs)
        self.assertTrue(result["completed"])
        self.assertTrue(result["stages"]["final_pixels"]["exact"])
        self.assertFalse(result["pipeline_parity"])

    def test_optional_published_layers_observe_without_claiming_smoothing(self):
        inputs = fixture(diagnostic=True)
        for snapshot, case in zip(inputs["capture"]["geometry_snapshots"], inputs["sequence_replay"]["cases"], strict=True):
            face = snapshot["faces"][0]
            face["published"] = dict(record=131072, storage_points=106, capacity_points=106, count=106,
                                     points_xy=[0.0, 1.0] * 106)
            layer = case["native_output_layers"]
            layer.update(published_observed=True, published_to_returned_exact=True,
                         tracked_to_published=deepcopy(layer["tracked_to_returned"]),
                         published_to_returned=[point_metric()] if face["active"] else [])
        result = audit.audit_reports(**inputs)
        self.assertEqual(result["published_observed_predictions"], list(range(26)))
        self.assertEqual(result["stages"]["published_to_returned"]["compared"], 24)
        self.assertTrue(result["stages"]["published_to_returned"]["exact"])
        self.assertEqual(result["stages"]["tracked_to_published"]["failed_indices"], [14])
        self.assertFalse(result["pipeline_parity"])
        inputs["sequence_replay"]["cases"][2]["native_output_layers"].pop("published_to_returned")
        with self.assertRaisesRegex(ValueError, "partial published"):
            audit.audit_reports(**inputs)

    def test_every_stage_can_fail_without_fitting_or_promoting_pipeline(self):
        for stage in ("sampling", "stage1", "tracked", "returned_to_consumer"):
            inputs = fixture()
            replay = inputs["sequence_replay"]
            replay.update(passed=False, diagnostic_only=True)
            if stage == "sampling":
                replay["sampling_cases"][2]["sampling_exact"] = False
            elif stage in ("stage1", "tracked"):
                replay["cases"][2]["checks"][stage] = point_metric(exact=False)
                replay["geometry_exact"] = False
            else:
                replay["cases"][2]["native_output_layers"].update(returned_to_consumer=[point_metric(exact=False)], returned_to_consumer_exact=False)
                replay["returned_to_consumer_exact"] = False
            with self.subTest(stage=stage):
                result = audit.audit_reports(**inputs)
                self.assertTrue(result["completed"])
                self.assertFalse(result["pipeline_parity"])
                self.assertEqual(result["stages"][stage]["failed_indices"], [2])

    def test_cold_output_difference_is_recorded_but_not_consumed(self):
        inputs = fixture()
        inputs["sequence_replay"]["cases"][0]["native_output_layers"].update(post_tracking_changed=True, tracked_to_returned=[point_metric(exact=False)])
        inputs["sequence_replay"]["post_tracking_gap_predictions"] = [0]
        result = audit.audit_reports(**inputs)
        self.assertTrue(result["pipeline_parity"])
        self.assertEqual(result["stages"]["tracked_to_returned"]["failed_indices"], [0])
        self.assertEqual(result["stages"]["tracked_to_returned"]["required_failed_indices"], [])

    def test_stale_cross_run_hashes_fail(self):
        for report, key in (("sequence_replay", "capture_sha256"), ("sequence_render", "capture_sha256"),
                            ("sequence_replay", "replay_sha256"), ("sequence_render", "replay_sha256"), ("sequence_render", "manifest_sha256")):
            inputs = fixture()
            inputs[report][key] = SHA_B
            with self.subTest(report=report, key=key), self.assertRaisesRegex(ValueError, "SHA link"):
                audit.audit_reports(**inputs)

    def test_missing_layers_and_empty_stage_reports_fail(self):
        for target in ("stage1", "tracked", "normalized", "native_output_layers", "returned_to_consumer", "returned_result"):
            inputs = fixture()
            case = inputs["sequence_replay"]["cases"][2]
            if target in ("stage1", "tracked", "normalized"):
                case["checks"].pop(target)
            elif target == "returned_to_consumer":
                case["native_output_layers"][target] = []
            elif target == "returned_result":
                inputs["capture"]["geometry_snapshots"][2].pop(target)
            else:
                case.pop(target)
            with self.subTest(target=target), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_absent_flags_never_default_to_success(self):
        for report, key in (("capture", "passed"), ("capture", "observer_pixel_parity_verified"), ("sequence_replay", "completed"),
                            ("sequence_replay", "diagnostic_only"), ("sequence_replay", "independent_120_sampling_input_used"),
                            ("sequence_replay", "returned_result_observed"), ("sequence_render", "external_replay_verified"), ("sequence_render", "pixel_parity_verified")):
            inputs = fixture()
            inputs[report].pop(key)
            with self.subTest(report=report, key=key), self.assertRaisesRegex(ValueError, "typed flag"):
                audit.audit_reports(**inputs)

    def test_false_completed_and_false_external_flags_are_honest(self):
        for report, key in (("sequence_replay", "completed"), ("sequence_render", "completed"), ("sequence_render", "external_replay_verified")):
            inputs = fixture()
            inputs[report][key] = False
            with self.subTest(report=report, key=key):
                result = audit.audit_reports(**inputs)
                self.assertFalse(result["pipeline_parity"])
                self.assertEqual(result["completed"], key != "completed")

    def test_bool_float_and_wrong_counts_are_rejected(self):
        for report, key, original in (("capture", "predictions", 26), ("capture", "warmup_requests_per_host", 6),
                                     ("sequence_render", "seeks_per_request", 2), ("sequence_replay", "manifest_frames", 7),
                                     ("sequence_replay", "head_comparisons", 135)):
            for value in (True, float(original), original - 1):
                inputs = fixture()
                inputs[report][key] = value
                with self.subTest(report=report, key=key, value=value), self.assertRaises(ValueError):
                    audit.audit_reports(**inputs)
        for value in (True, 24.0, 23):
            inputs = fixture()
            inputs["sequence_render"]["runs"][0]["owned_face_conversions"] = value
            with self.subTest(conversions=value), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_no_face_counts_and_stale_replay_are_rejected(self):
        for target in ("published_faces", "returned_faces", "payload", "idle", "bool_idle"):
            inputs = fixture()
            case = inputs["sequence_replay"]["cases"][19]
            if target == "published_faces":
                case[target] = 1
            elif target == "returned_faces":
                case["native_output_layers"][target] = 1
            elif target == "payload":
                inputs["replay_payload"]["frames"][17]["faces"] = deepcopy(inputs["replay_payload"]["frames"][0]["faces"])
            else:
                inputs["sequence_replay"]["sampling_cases"][19]["idle"] = 1 if target == "bool_idle" else False
            with self.subTest(target=target), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)
        for key in ("active_faces", "published_faces"):
            for value in (False, 0.0):
                inputs = fixture()
                inputs["sequence_replay"]["cases"][19][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    audit.audit_reports(**inputs)

    def test_ids_and_timing_are_typed_and_associated(self):
        for target, value in (("id", True), ("id", 0.0), ("id", 2), ("timestamp_us", False), ("timestamp_us", 0.0), ("timestamp_us", 1)):
            inputs = fixture()
            frame = inputs["replay_payload"]["frames"][0]
            if target == "id":
                frame["faces"][0][target] = value
            else:
                frame[target] = value
            with self.subTest(target=target, value=value), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_invalid_metrics_and_relaxed_tolerance_fail(self):
        for key, value in (("within", 1), ("exact", 1), ("max_abs", False), ("max_abs", float("nan")),
                           ("max_abs", 1), ("tolerance", 0.001), ("worst_point_index", 0.0)):
            inputs = fixture()
            inputs["sequence_replay"]["cases"][2]["checks"]["stage1"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_pixel_hashes_and_request_links_are_consistent(self):
        for target in ("hash", "request", "bool_delta", "bbox", "empty_control"):
            inputs = fixture(diagnostic=True)
            row = inputs["sequence_render"]["comparisons"][1]
            if target == "hash":
                row["sha256"] = row["baseline_sha256"]
            elif target == "request":
                inputs["sequence_render"]["runs"][0]["requests"][7]["sha256"] = SHA_C
            elif target == "bool_delta":
                row["max_delta"] = True
            elif target == "bbox":
                row["bbox"][0] = 10.0
            else:
                row["versus_input"] = {}
            with self.subTest(target=target), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_typed_frame_timing_and_algorithm_byte_counts(self):
        for target, value in (("timestamp", False), ("timestamp", float("inf")), ("bytes", True), ("bytes", 1228800.0)):
            inputs = fixture()
            if target == "timestamp":
                inputs["sequence_render"]["frames"][0][target] = value
            else:
                inputs["capture"]["algorithm_frames"][0][target] = value
            with self.subTest(target=target, value=value), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_source_paths_are_local_and_sha_values_are_strict(self):
        for name, expected in (("../vendor", SHA_B), ("/absolute/source", SHA_B), ("source\\file", SHA_B),
                               ("https:source", SHA_B), ("source.py", "B" * 64), ("source.py", True)):
            inputs = fixture()
            inputs["capture"]["source_sha256"] = {name: expected}
            with self.subTest(name=name), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)

    def test_sampling_hash_owner_and_cross_report_sources_cannot_drift(self):
        for target in ("input", "algorithm", "network", "inference", "window", "source"):
            inputs = fixture()
            if target in ("input", "algorithm"):
                key = "input_sha256" if target == "input" else "algorithm_frame_sha256"
                inputs["sequence_replay"]["sampling_cases"][2][key] = SHA_C
            elif target in ("network", "inference"):
                inputs["capture"]["prediction_inferences"][2]["inferences"][0][target] = "wrong" if target == "network" else True
            elif target == "window":
                inputs["capture"]["prediction_inferences"][2]["neural_window"][0] = True
            else:
                inputs["sequence_render"]["source_sha256"]["local-model-pytorch/example.py"] = SHA_C
            with self.subTest(target=target), self.assertRaises(ValueError):
                audit.audit_reports(**inputs)


class FileAuditTests(unittest.TestCase):
    def write_fixture(self, *, root, diagnostic=True):
        inputs = fixture(diagnostic=diagnostic)
        manifest = root / "manifest.json"
        value = dict(version=1, frames=[{key: frame[key] for key in ("image", "timestamp", "parameters", "expect_change", "label")}
                                        for frame in inputs["capture"]["frames"]])
        manifest.write_text(json.dumps(value))
        manifest_hash = audit.digest(data=manifest.read_bytes())
        capture, replay, render = (inputs[key] for key in ("capture", "sequence_replay", "sequence_render"))
        for name in ("capture", "replay", "render"):
            (root / name).mkdir()
        capture.update(manifest=str(manifest), fixture_sha256={str(manifest): manifest_hash})
        cap_path = root / "capture/report.json"
        cap_path.write_text(json.dumps(capture))
        capture_hash = audit.digest(data=cap_path.read_bytes())
        payload = inputs["replay_payload"]
        payload["image_sha256"] = manifest_hash
        candidate = root / "replay/diagnostic-replay.json"
        candidate.write_text(json.dumps(payload))
        replay_hash = audit.digest(data=candidate.read_bytes())
        replay.update(capture_sha256=capture_hash, replay_sha256=replay_hash)
        render.update(capture=str(cap_path.parent), candidate=str(candidate), capture_sha256=capture_hash,
                      replay_sha256=replay_hash, manifest_sha256=manifest_hash)
        for name, report in (("replay", replay), ("render", render)):
            (root / name / "report.json").write_text(json.dumps(report))
        return argparse.Namespace(capture=cap_path, sequence_replay=root / "replay", sequence_render=root / "render/report.json",
                                  out=root / "out", current_source_root=None)

    def test_report_only_cli_path_diagnostic_stays_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.write_fixture(root=root)
            with patch.object(audit.sequence, "PRIVATE", root):
                result = audit.run(args=args)
                self.assertTrue(result["completed"])
                self.assertFalse(result["pipeline_parity"])
                self.assertEqual(set(result["report_sha256"]), {"capture", "sequence_replay", "sequence_render"})
                self.assertEqual(json.loads((root / "out/report.json").read_text()), result)
                with self.assertRaises(FileExistsError):
                    audit.run(args=args)

    def test_current_source_root_checks_are_optional_and_fail_on_stale_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.write_fixture(root=root)
            sources = root / "sources/local-model-pytorch"
            sources.mkdir(parents=True)
            source = sources / "example.py"
            source.write_text("synthetic_source = 1\n")
            expected = audit.digest(data=source.read_bytes())
            for path in (args.capture, root / "replay/report.json", args.sequence_render):
                report = json.loads(path.read_text())
                report["source_sha256"]["local-model-pytorch/example.py"] = expected
                path.write_text(json.dumps(report))
            capture_hash = audit.digest(data=args.capture.read_bytes())
            for path in (root / "replay/report.json", args.sequence_render):
                report = json.loads(path.read_text())
                report["capture_sha256"] = capture_hash
                path.write_text(json.dumps(report))
            args.current_source_root = sources.parent
            with patch.object(audit.sequence, "PRIVATE", root):
                self.assertTrue(audit.run(args=args)["source_hashes_verified"])
                source.write_text("synthetic_source = 2\n")
                args.out = root / "stale"
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    audit.run(args=args)
                failed = json.loads((args.out / "report.json").read_text())
                self.assertFalse(failed["completed"])
                self.assertFalse(failed["pipeline_parity"])

    def test_duplicate_json_and_cross_directory_replay_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.write_fixture(root=root)
            with patch.object(audit.sequence, "PRIVATE", root):
                args.capture.write_text('{"passed":true,"passed":false}')
                with self.assertRaisesRegex(ValueError, "duplicate JSON"):
                    audit.run(args=args)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.write_fixture(root=root)
            report = json.loads(args.sequence_render.read_text())
            report["candidate"] = str(root / "capture/wrong.json")
            args.sequence_render.write_text(json.dumps(report))
            with patch.object(audit.sequence, "PRIVATE", root), self.assertRaisesRegex(ValueError, "path link"):
                audit.run(args=args)

    def test_oversized_reports_fail_before_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.write_fixture(root=root)
            with patch.object(audit.sequence, "PRIVATE", root), patch.object(audit, "REPORT_LIMIT", 64), \
                    self.assertRaisesRegex(ValueError, "oversized"):
                audit.run(args=args)
            failed = json.loads((args.out / "report.json").read_text())
            self.assertFalse(failed["completed"])
            self.assertFalse(failed["pipeline_parity"])

    def test_cli_returns_nonzero_for_completed_diagnostic(self):
        with patch("sys.argv", ["audit", "--capture", "capture", "--sequence-replay", "replay", "--sequence-render", "render", "--out", "out"]), \
                patch.object(audit, "run", return_value=dict(completed=True, pipeline_parity=False, source_hashes_verified=False)), \
                patch("builtins.print"):
            self.assertEqual(audit.main(), 1)


if __name__ == "__main__":
    unittest.main()
