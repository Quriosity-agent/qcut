"""In-memory capture-loader contracts; no native host, GPU or private fixtures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, call, patch

import face_preprocess_chain_capture as capture

PIXEL_BYTES = 1448 * 1086 * 4
PIXELS = bytes(PIXEL_BYTES)
PIXEL_HASH = hashlib.sha256(PIXELS).hexdigest()


def encoded(*, value):
    return json.dumps(value).encode("utf-8")


class LoadTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("/synthetic/neutral")
        self.original, self.audit = Path("/synthetic/old-capture"), Path("/synthetic/old-audit")
        self.runtime, self.package = Path("/synthetic/runtime"), Path("/synthetic/package")
        self.host, self.manifest = Path("/synthetic/host"), Path("/synthetic/manifest.json")
        self.frames = [dict(timestamp=index / 30, input=Path(f"/synthetic/input-{index}.rgba"),
                            parameters={"amount": 0}) for index in range(7)]
        self.previous = dict(passed=True, predictions=26, observer_pixel_parity_verified=True,
                             manifest=str(self.manifest), host_sha256="a" * 64)
        self.files = {Path(f"/synthetic/old-sources/source-{index:02d}.py"): f"source {index}".encode()
                      for index in range(50)}
        self.files[self.original / "report.json"] = encoded(value=self.previous)
        self.guard = dict(passed=True, source_count=50, report_sha256={
            "capture": capture.digest(data=self.files[self.original / "report.json"])})
        self.files[self.audit / "report.json"] = encoded(value=self.guard)
        self.fixtures = {str(path): capture.digest(data=data) for path, data in self.files.items()}
        self.files[self.manifest] = encoded(value={"frames": [dict(timestamp=index / 30) for index in range(7)]})
        timestamps = [0] * 10 + [int(frame["timestamp"] * 1_000_000 + .5) for frame in self.frames for _ in range(2)]
        events = []
        for timestamp in timestamps:
            events.extend([dict(event="owned_face_conversion", timestamp_us=timestamp, faces=0,
                raw_clone_verified=True, original_restored=False, native_analysis_bypassed=False, eye_shift=0,
                external_points=False, source_points_unchanged=True, owned_points_isolated=True),
                dict(event="owned_face_restored", gpu_complete=True, original_restored=True)])
        self.records = b"\n".join(encoded(value=row) for row in events) + b"\n"
        protocol = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(6)),
                    *(f"QCUT\tRESULT\tframe-{index:02d}\t0" for index in range(7))]
        self.protocol = dict(protocol_rows=protocol, records_sha256=capture.digest(data=self.records),
                             owned_face_conversions=24, owned_face_restorations=24)
        self.snapshots = [dict(index=index, handle=4096, request=[0, 640, 480, 2560, index])
                          for index in range(26)]
        self.descriptors = [dict(prediction=index, file=f"frame-{index:02d}.rgba", width=640, height=480)
                            for index in range(26)]
        self.inventory = dict(networks={"40960": dict(graph_sha256="b" * 64, graph_path="/synthetic/graph.json",
            declared_outputs=["fc_landmark_s1", ""], successful_inferences=[0, 1], outputs=[], inputs=[
                dict(name="data", inference=index, dims_nwhc=[1, 160, 160, 3], raw=[1, 6],
                     path=f"/synthetic/tensor-{index}.bin", sha256="c" * 64) for index in range(2)])},
            successful_inferences=2, metadata_records=2)
        self.associations = [dict(prediction=index, neural_window=[index * 8, (index + 1) * 8],
                                 inferences=[]) for index in range(26)]
        self.trace = dict(passed=True, predictions=[dict(index=index) for index in range(26)],
                          events=[dict(prediction=index) for index in (0, 20)])
        self.cases = [dict(prediction=index, face_id=index, inference=ordinal,
                           neural_window=[index * 8, (index + 1) * 8]) for ordinal, index in enumerate((0, 20))]
        self.metrics = dict(equal=True, changed_pixels=0, max_delta=0, bbox=None, sha256=PIXEL_HASH)
        self.evidence = dict(passed=True, diagnostic_only=True, observer_pixel_parity_verified=True,
            native_analysis_bypassed=False, old_sources_verified=50, fixture_sha256=deepcopy(self.fixtures),
            capture=str(self.original), audit=str(self.audit), runtime=str(self.runtime), package=str(self.package),
            host_sha256=self.previous["host_sha256"], geometry_snapshots=deepcopy(self.snapshots),
            algorithm_frames=deepcopy(self.descriptors), captures=deepcopy(self.inventory),
            prediction_inferences=deepcopy(self.associations), trace=deepcopy(self.trace), cases=deepcopy(self.cases),
            baseline=deepcopy(self.protocol), observed=deepcopy(self.protocol),
            comparisons=[dict(index=index, **self.metrics) for index in range(7)])
        self.native = dict(frames=[dict(timestamp_us=timestamp, faces=[]) for timestamp in timestamps])
        self.metadata_paths = [self.root / "capture/network.json", self.root / "capture/inference.json"]
        self.metadata = [dict(record=index) for index in range(2)]
        for name in ("baseline", "observed"):
            self.files[self.root / name / "records.jsonl"] = self.records
            for index in range(7):
                self.files[self.root / name / f"frame-{index:02d}.rgba"] = PIXELS
        self.locked = Mock(read=Mock(side_effect=self.read), json=Mock(side_effect=self.read_json))
        self.resolve = self.enterContext(patch.object(Path, "resolve", autospec=True,
                                                     side_effect=lambda path, *, strict: path))
        self.glob = self.enterContext(patch.object(Path, "glob", autospec=True, side_effect=self.glob_metadata))
        self.open_file = self.enterContext(patch.object(Path, "open", side_effect=AssertionError("disk read forbidden")))
        self.profile = self.mock(capture.probe, "lock_profile", return_value=(
            self.previous, self.runtime, self.package, {"host": self.host}, self.frames))
        self.neutrality_validator = capture.parity.validate_capture
        self.neutrality = self.mock(capture.parity, "validate_capture")
        self.actual_snapshots = self.mock(capture.observed, "snapshots", return_value=self.snapshots)
        self.validate_sequence = self.mock(capture, "validate_sequence")
        self.algorithm_frames = self.mock(capture.geometry, "algorithm_frames", return_value=self.descriptors)
        self.actual_inventory = self.mock(capture.models, "inventory", return_value=self.inventory)
        self.lock_inventory = self.mock(capture.observed, "lock_inventory")
        self.read_metadata = self.mock(capture.models, "metadata", side_effect=self.read_capture_metadata)
        self.associate = self.mock(capture, "associate_inferences", return_value=self.associations)
        self.validate_trace = self.mock(capture.probe, "validate_trace", return_value=self.cases)
        self.validate_protocol = self.mock(capture.probe, "validate_protocol", return_value=self.protocol)
        self.frame_metrics = self.mock(capture, "frame_metrics", return_value=self.metrics)
        self.capture_replay = self.mock(capture.owned, "capture_replay", return_value=self.native)

    def mock(self, module, name, **kwargs):
        return self.enterContext(patch.object(module, name, **kwargs))

    def glob_metadata(self, directory, pattern):
        self.assertEqual((directory, pattern), (self.root / "capture", "*.json"))
        return iter(self.metadata_paths)

    def read_capture_metadata(self, *, path):
        return self.metadata[self.metadata_paths.index(path)]

    def read(self, *, path, maximum, expected=None):
        if path not in self.files:
            raise FileNotFoundError(str(path))
        data = self.files[path]
        if len(data) > maximum:
            raise ValueError("synthetic read exceeds bound")
        if expected is not None and capture.digest(data=data) != expected:
            raise ValueError("synthetic fixture hash mismatch")
        return data

    def read_json(self, *, path):
        if path == self.root / "report.json":
            return self.evidence
        if path == self.root / "trace/trace.json":
            return self.trace
        raise AssertionError(f"unexpected fixture JSON path: {path}")

    def load(self):
        return capture.load(root=self.root, locked=self.locked)

    def reject(self, *, message):
        with self.assertRaisesRegex(ValueError, message):
            self.load()
        self.capture_replay.assert_not_called()

    def test_good_path_returns_locked_profile_and_actual_observations_without_mutation(self):
        before = deepcopy((self.evidence, self.snapshots, self.associations, self.native))
        result = self.load()
        self.assertEqual(set(result), {"root", "evidence", "original", "runtime", "package", "host", "frames",
                                      "snapshots", "associations", "native"})
        for name in result:
            with self.subTest(name=name):
                self.assertEqual(result[name], getattr(self, name))
        self.assertEqual((self.evidence, self.snapshots, self.associations, self.native), before)
        self.assertIs(result["evidence"], self.evidence)
        self.assertIs(result["native"], self.native)
        self.open_file.assert_not_called()

    def test_all_50_old_sources_and_both_old_reports_are_hash_bound_before_profile(self):
        self.load()
        self.assertEqual(len(self.fixtures), 52)
        self.assertEqual(self.guard["source_count"], 50)
        self.assertEqual(self.fixtures[str(self.original / "report.json")], self.guard["report_sha256"]["capture"])
        expected = [call(path=Path(path), maximum=128 * 1024**2, expected=digest)
                    for path, digest in self.fixtures.items()]
        self.assertEqual(self.locked.read.call_args_list[:52], expected)
        self.profile.assert_called_once_with(capture=self.original, audit=self.audit, locked=self.locked)
        self.resolve.assert_has_calls([call(self.root, strict=True), call(self.original, strict=True),
                                       call(self.audit, strict=True)])

    def test_actual_geometry_inventory_metadata_and_associations_are_revalidated(self):
        self.load()
        self.neutrality.assert_called_once_with(captured=self.evidence, expected_comparisons=7)
        self.actual_snapshots.assert_called_once_with(directory=self.root / "geometry", locked=self.locked)
        self.validate_sequence.assert_called_once_with(records=self.snapshots, temporal=True)
        self.algorithm_frames.assert_called_once_with(records=self.snapshots, directory=self.root / "geometry",
                                                     locked=self.locked)
        self.actual_inventory.assert_called_once_with(capture=self.root / "capture")
        self.lock_inventory.assert_called_once_with(inventory=self.inventory, directory=self.root / "capture",
                                                   locked=self.locked)
        self.assertEqual(self.read_metadata.call_args_list, [call(path=path) for path in self.metadata_paths])
        self.associate.assert_called_once_with(records=self.snapshots, networks=self.inventory["networks"],
                                               temporal=True, metadata=self.metadata)

    def test_fresh_report_paths_are_hash_bound_and_forwarded(self):
        paths = {key: Path("/synthetic/fresh") / (key + ".json") for key in capture.probe.OLD_REPORTS}
        for key, path in paths.items():
            self.files[path] = encoded(value={"role": key})
            self.evidence["fixture_sha256"][str(path)] = capture.digest(data=self.files[path])
        self.evidence["profile_reports"] = {key: str(path) for key, path in paths.items()}
        self.load()
        self.profile.assert_called_once_with(capture=self.original, audit=self.audit, locked=self.locked, **paths)

    def test_unbound_fresh_report_path_is_rejected_before_profile(self):
        self.evidence["profile_reports"] = {key: "/synthetic/unbound.json" for key in capture.probe.OLD_REPORTS}
        self.reject(message="hash-bound")
        self.profile.assert_not_called()

    def test_trace_protocol_and_each_bounded_pixel_pair_are_revalidated(self):
        self.load()
        self.validate_trace.assert_called_once_with(trace=self.trace, records=self.snapshots,
                                                   associations=self.associations)
        self.assertEqual(self.validate_protocol.call_args_list, [
            call(directory=self.root / name, frames=self.frames, locked=self.locked)
            for name in ("baseline", "observed")])
        pixels = [call(path=self.root / name / f"frame-{index:02d}.rgba", maximum=PIXEL_BYTES)
                  for index in range(7) for name in ("baseline", "observed")]
        self.assertEqual(self.locked.read.call_args_list[52:66], pixels)
        self.assertEqual(self.frame_metrics.call_count, 7)
        self.frame_metrics.assert_has_calls([call(reference=PIXELS, actual=PIXELS, width=1448, height=1086)] * 7)

    def test_owned_conversion_reference_is_bound_to_observed_records_manifest_and_time_limit(self):
        self.load()
        self.assertEqual(self.locked.read.call_args_list[-2:], [
            call(path=self.root / "observed/records.jsonl", maximum=capture.sequence.LOG_LIMIT,
                 expected=self.protocol["records_sha256"]),
            call(path=self.manifest, maximum=capture.sequence.MANIFEST_LIMIT)])
        self.capture_replay.assert_called_once_with(events=[capture.strict_json(data=row)
            for row in self.records.splitlines()], width=1448, height=1086,
            image_hash=capture.digest(data=self.files[self.manifest]),
            maximum_timestamp_us=capture.consumer.REPLAY_TIME_LIMIT_US)

    def test_neutral_capture_claims_require_literal_booleans(self):
        claims = {"passed": True, "diagnostic_only": True, "observer_pixel_parity_verified": True,
                  "native_analysis_bypassed": False}
        for field, valid in claims.items():
            for value in (not valid, None, 0, 1, "true", [], {}):
                self.evidence[field] = value
                with self.subTest(field=field, value=value):
                    self.reject(message="passed neutral")
                self.evidence[field] = valid
        self.profile.assert_not_called()

    def test_missing_neutral_claims_rejected(self):
        for field in ("passed", "diagnostic_only", "observer_pixel_parity_verified", "native_analysis_bypassed"):
            saved = self.evidence.pop(field)
            with self.subTest(field=field):
                self.reject(message="passed neutral")
            self.evidence[field] = saved
        self.locked.read.assert_not_called()

    def test_old_source_count_requires_exact_builtin_integer_50(self):
        for value in (None, False, True, 0, 49, 51, 50.0, "50", [50]):
            self.evidence["old_sources_verified"] = value
            with self.subTest(value=value):
                self.reject(message="locked old sources")
        self.evidence.pop("old_sources_verified")
        self.reject(message="locked old sources")

    def test_missing_empty_nonobject_or_oversized_fixture_map_rejected(self):
        for value in (None, {}, [], "fixtures", {f"/synthetic/{index}": "a" * 64 for index in range(4097)}):
            self.evidence["fixture_sha256"] = value
            with self.subTest(size=len(value) if isinstance(value, dict) else value):
                self.reject(message="bounded absolute")
        self.evidence.pop("fixture_sha256")
        self.reject(message="bounded absolute")
        self.locked.read.assert_not_called()

    def test_fixture_paths_require_absolute_strings(self):
        for path in (None, 5, Path("/synthetic/file"), "", ".", "relative/file", "../outside"):
            self.evidence["fixture_sha256"] = {path: "a" * 64}
            with self.subTest(path=path):
                self.reject(message="bounded absolute")
        self.locked.read.assert_not_called()

    def test_fixture_hashes_require_lowercase_sha256(self):
        for value in (None, True, 42, b"a" * 64, "", "a" * 63, "a" * 65, "A" * 64, "g" * 64):
            self.evidence["fixture_sha256"] = {str(self.original / "report.json"): value}
            with self.subTest(value=value):
                self.reject(message="fixture identities")
        self.profile.assert_not_called()

    def test_original_capture_and_audit_reports_must_both_be_hash_bound(self):
        for directory in (self.original, self.audit):
            self.evidence["fixture_sha256"] = deepcopy(self.fixtures)
            self.evidence["fixture_sha256"].pop(str(directory / "report.json"))
            with self.subTest(directory=directory):
                self.reject(message="original capture and audit must be hash-bound")
        self.profile.assert_not_called()

    def test_capture_or_audit_cannot_redirect_to_an_unbound_directory(self):
        for field in ("capture", "audit"):
            saved = self.evidence[field]
            self.evidence[field] = "/synthetic/unbound"
            with self.subTest(field=field):
                self.reject(message="must be hash-bound")
            self.evidence[field] = saved

    def test_changed_old_report_or_source_hash_is_rejected_by_locked_reader(self):
        for path in (self.original / "report.json", self.audit / "report.json",
                     Path("/synthetic/old-sources/source-49.py")):
            saved = self.files[path]
            self.files[path] = saved + b"changed"
            with self.subTest(path=path):
                self.reject(message="fixture hash mismatch")
            self.files[path] = saved
        self.profile.assert_not_called()

    def test_fixture_byte_budget_is_passed_to_locked_reader(self):
        path = self.original / "report.json"
        self.locked.read.side_effect = ValueError("synthetic read exceeds bound")
        self.reject(message="read exceeds bound")
        self.assertEqual(self.locked.read.call_args.kwargs["maximum"], 128 * 1024**2)
        self.assertIn(self.locked.read.call_args.kwargs["path"], self.files)
        self.assertIn(str(path), self.fixtures)

    def test_missing_hash_bound_fixture_is_not_skipped(self):
        self.files.pop(self.audit / "report.json")
        with self.assertRaises(FileNotFoundError):
            self.load()
        self.profile.assert_not_called()

    def test_missing_root_cannot_read_report(self):
        self.resolve.side_effect = FileNotFoundError("missing synthetic root")
        with self.assertRaises(FileNotFoundError):
            self.load()
        self.locked.json.assert_not_called()

    def test_profile_validation_failure_stops_before_actual_capture_reads(self):
        for message in ("locked 50-source audit required", "locked source union changed", "source path escaped research",
                        "runtime library mismatch", "host hash mismatch", "manifest request differs"):
            self.profile.side_effect = ValueError(message)
            with self.subTest(message=message):
                self.reject(message=message)
        self.neutrality.assert_not_called()
        self.actual_snapshots.assert_not_called()

    def test_runtime_package_and_host_mismatch_rejected(self):
        for field in ("runtime", "package", "host_sha256"):
            saved = self.evidence[field]
            for value in (None, "different", saved + "changed"):
                self.evidence[field] = value
                with self.subTest(field=field, value=value):
                    self.reject(message="differs from locked profile")
            self.evidence[field] = saved
        self.neutrality.assert_not_called()

    def test_capture_neutrality_failure_propagates_before_snapshot_read(self):
        self.neutrality.side_effect = ValueError("passed pixel-neutral actual host capture required")
        self.reject(message="pixel-neutral")
        self.actual_snapshots.assert_not_called()

    def test_seven_comparisons_and_literal_equal_true_reach_neutrality_guard(self):
        self.neutrality.side_effect = self.neutrality_validator
        saved = deepcopy(self.evidence["comparisons"])
        for count in (0, 6, 8):
            self.evidence["comparisons"] = (saved * 2)[:count]
            with self.subTest(count=count):
                self.reject(message="pixel-neutral")
        self.evidence["comparisons"] = saved
        for value in (False, None, 0, 1, "true"):
            self.evidence["comparisons"][0]["equal"] = value
            with self.subTest(equal=value):
                self.reject(message="pixel-neutral")
        self.actual_snapshots.assert_not_called()

    def test_good_synthetic_inventory_also_passes_cpu_neutrality_validator(self):
        self.neutrality.side_effect = self.neutrality_validator
        self.assertIs(self.load()["native"], self.native)

    def test_changed_actual_geometry_or_report_geometry_rejected(self):
        self.actual_snapshots.return_value = deepcopy(self.snapshots)
        self.actual_snapshots.return_value[20]["handle"] += 1
        self.reject(message="actual preprocessing predictions changed")
        self.actual_snapshots.return_value = self.snapshots
        self.evidence["geometry_snapshots"][25]["request"][-1] += 1
        self.reject(message="actual preprocessing predictions changed")
        self.algorithm_frames.assert_not_called()

    def test_snapshot_count_must_be_exactly_26(self):
        for count in (0, 25, 27):
            rows = (self.snapshots * 2)[:count]
            self.actual_snapshots.return_value = rows
            self.evidence["geometry_snapshots"] = deepcopy(rows)
            with self.subTest(count=count):
                self.reject(message="predictions changed")

    def test_sequence_validator_failures_propagate(self):
        self.validate_sequence.side_effect = ValueError("prediction index or boolean invalid")
        self.reject(message="index or boolean")
        self.algorithm_frames.assert_not_called()

    def test_changed_algorithm_frame_descriptors_rejected(self):
        self.algorithm_frames.return_value = deepcopy(self.descriptors)
        self.algorithm_frames.return_value[25]["width"] += 1
        self.reject(message="algorithm frames changed")
        self.actual_inventory.assert_not_called()

    def test_algorithm_frame_hash_guard_failure_propagates(self):
        self.algorithm_frames.side_effect = ValueError("algorithm frame hash mismatch")
        self.reject(message="frame hash mismatch")

    def test_changed_actual_inventory_rejected(self):
        self.actual_inventory.return_value = deepcopy(self.inventory)
        self.actual_inventory.return_value["networks"]["40960"]["graph_sha256"] = "d" * 64
        self.reject(message="neural inventory changed")
        self.lock_inventory.assert_not_called()

    def test_inventory_hash_guard_failure_propagates(self):
        self.lock_inventory.side_effect = ValueError("captured tensor hash mismatch")
        self.reject(message="tensor hash mismatch")
        self.associate.assert_not_called()

    def test_changed_associations_rejected(self):
        self.associate.return_value = deepcopy(self.associations)
        self.associate.return_value[20]["neural_window"][0] += 1
        self.reject(message="neural associations changed")
        self.validate_trace.assert_not_called()

    def test_metadata_and_association_validation_failures_propagate(self):
        self.read_metadata.side_effect = ValueError("metadata identity changed")
        self.reject(message="metadata identity changed")
        self.read_metadata.side_effect = self.read_capture_metadata
        self.associate.side_effect = ValueError("ambiguous face/inference association")
        self.reject(message="ambiguous face/inference")

    def test_changed_actual_trace_or_recomputed_trace_cases_rejected(self):
        self.trace["predictions"][20]["index"] = 21
        self.reject(message="hardware trace changed")
        self.trace["predictions"][20]["index"] = 20
        self.validate_trace.return_value = deepcopy(self.cases)
        self.validate_trace.return_value[1]["face_id"] += 1
        self.reject(message="hardware trace changed")
        self.validate_protocol.assert_not_called()

    def test_trace_validator_rejects_unresolved_or_mutating_observer(self):
        self.validate_trace.side_effect = ValueError("read-only resolved hardware trace required")
        self.reject(message="read-only resolved")
        self.validate_protocol.assert_not_called()

    def test_changed_baseline_or_observed_protocol_rejected(self):
        for name in ("baseline", "observed"):
            self.evidence[name]["protocol_rows"][-1] = "QCUT\tRESULT\tframe-06\t1"
            with self.subTest(name=name):
                self.reject(message="owned protocol changed")
            self.evidence[name] = deepcopy(self.protocol)
        self.frame_metrics.assert_not_called()

    def test_protocol_validator_failure_propagates(self):
        self.validate_protocol.side_effect = ValueError("actual owned seek timestamps changed")
        self.reject(message="seek timestamps changed")
        self.frame_metrics.assert_not_called()

    def test_short_or_oversized_pixels_rejected_for_both_hosts(self):
        for name in ("baseline", "observed"):
            path = self.root / name / "frame-06.rgba"
            for pixels in (b"", PIXELS[:-1], PIXELS + b"\0"):
                self.files[path] = pixels
                with self.subTest(name=name, size=len(pixels)):
                    self.reject(message="pixels changed|read exceeds bound")
            self.files[path] = PIXELS

    def test_each_comparison_index_requires_exact_builtin_integer(self):
        for index in (0, 1, 6):
            for value in (None, False, True, float(index), str(index), -1, 7):
                self.evidence["comparisons"][index]["index"] = value
                with self.subTest(index=index, value=value):
                    self.reject(message="pixels changed")
            self.evidence["comparisons"][index]["index"] = index

    def test_missing_comparison_index_rejected(self):
        self.evidence["comparisons"][6].pop("index")
        self.reject(message="pixels changed")

    def test_changed_or_missing_metric_fields_rejected(self):
        for field, value in (("equal", False), ("changed_pixels", 1), ("max_delta", 1),
                             ("bbox", [0, 0, 1, 1]), ("sha256", "f" * 64)):
            row = self.evidence["comparisons"][6]
            row[field] = value
            with self.subTest(field=field, changed=True):
                self.reject(message="pixels changed")
            row.pop(field)
            with self.subTest(field=field, missing=True):
                self.reject(message="pixels changed")
            row[field] = self.metrics[field]

    def test_actual_changed_pixels_cannot_reuse_reported_zero_difference(self):
        changed = b"\x01" + PIXELS[1:]
        self.files[self.root / "observed/frame-00.rgba"] = changed
        self.frame_metrics.return_value = dict(self.metrics, equal=False, changed_pixels=1, max_delta=1,
                                               bbox=[0, 0, 1, 1], sha256=capture.digest(data=changed))
        self.reject(message="pixels changed")
        self.frame_metrics.assert_called_once_with(reference=PIXELS, actual=changed, width=1448, height=1086)

    def test_observed_records_hash_change_stops_before_owned_reference(self):
        self.files[self.root / "observed/records.jsonl"] = self.records + b"changed"
        self.reject(message="fixture hash mismatch")

    def test_duplicate_or_nonfinite_owned_records_fail_before_reference(self):
        for data in (b'{"event":"a","event":"b"}\n', b'{"timestamp":NaN}\n', b'not json\n'):
            self.files[self.root / "observed/records.jsonl"] = data
            self.evidence["observed"]["records_sha256"] = capture.digest(data=data)
            self.protocol["records_sha256"] = capture.digest(data=data)
            self.evidence["baseline"]["records_sha256"] = capture.digest(data=data)
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    self.load()
            self.capture_replay.assert_not_called()

    def test_owned_reference_must_contain_exactly_24_conversions(self):
        for count in (0, 23, 25, 26):
            self.capture_replay.return_value = dict(frames=[{}] * count)
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "exact 24 owned"):
                self.load()

    def test_owned_reference_validation_error_is_not_suppressed(self):
        self.capture_replay.side_effect = ValueError("owned conversion not restored")
        with self.assertRaisesRegex(ValueError, "not restored"):
            self.load()


if __name__ == "__main__":
    unittest.main()
