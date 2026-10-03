"""Synthetic consumer contracts/lifecycle only; never execute vendor code."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image

import face_host_geometry_sequence_render as render


def event_rows(*, frames, external):
    result = []
    for frame in frames:
        faces = deepcopy(frame["faces"])
        for face in faces:
            face["points"] = [[struct.unpack("<f", struct.pack("<f", coordinate))[0] for coordinate in point]
                              for point in face["points"]]
        result.extend([dict(event="owned_face_conversion", raw_clone_verified=True, original_restored=False,
                            native_analysis_bypassed=False, eye_shift=0, faces=len(faces), external_points=external,
                            source_points_unchanged=True, owned_points_isolated=True,
                            timestamp_us=frame["timestamp_us"], faces_before=deepcopy(faces), faces_applied=faces),
                       dict(event="owned_face_restored", gpu_complete=True, original_restored=True)])
    return result


def encoded(*, rows):
    return b"".join(json.dumps(row).encode() + b"\n" for row in rows)


class RenderTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.capture, self.runtime, self.package, self.producer = [self.base / name for name in
                                                                 ("capture", "runtime", "package", "producer")]
        for name in ("capture/baseline", "capture/observed", "runtime/Frameworks", "runtime/Models", "package", "producer"):
            (self.base / name).mkdir(parents=True)
        self.host_path = self.capture / "host"
        self.host_path.write_bytes(b"synthetic owned host")
        self.host_path.chmod(0o700)
        self.host_hash = render.digest(data=self.host_path.read_bytes())
        for name in ("liblens.dylib", "libbytenn.dylib"):
            (self.runtime / "Frameworks" / name).write_bytes(b"synthetic runtime")
        self.pixels = bytes((11, 22, 33, 255, 44, 55, 66, 255))
        self.image = self.base / "image.png"
        Image.frombytes("RGBA", (2, 1), self.pixels).save(self.image)
        self.frames = [dict(image=str(self.image), timestamp=index / 100, parameters={"intensity": index / 6},
                            expect_change=False, label=f"frame-{index}") for index in range(7)]
        self.manifest = self.base / "manifest.json"
        self.manifest.write_text(json.dumps(dict(version=1, frames=self.frames)))
        self.value = dict(version=1, coordinate_space=render.consumer.COORDINATE_SPACE, width=2, height=1,
                          image_sha256=render.digest(data=self.manifest.read_bytes()), frames=[])
        stamps = [0] * 10 + [index * 10_000 for index in range(7) for _ in range(2)]
        for index, stamp in enumerate(stamps):
            frame_index = 0 if index < 10 else (index - 10) // 2
            faces = [] if frame_index == 3 else [dict(id=10 + frame_index, points=[[0.2, 0.7]] * 106)]
            self.value["frames"].append(dict(timestamp_us=stamp, faces=faces))
        self.candidate = self.producer / "replay.json"
        self.previous = dict(passed=True, native_analysis_bypassed=False, observer_pixel_parity_verified=True,
                             per_prediction_inference_association_verified=True, width=2, height=1,
                             warmup_requests_per_host=6, seeks_per_request=2, host_sha256=self.host_hash,
                             manifest=str(self.manifest), frames=[], comparisons=[], runs=[], source_sha256={})
        source = Path(render.consumer.__file__)
        self.previous["source_sha256"][str(source.relative_to(render.SOURCE_ROOT))] = render.digest(data=source.read_bytes())
        for index, frame in enumerate(self.frames):
            (self.capture / f"input-{index:02d}.rgba").write_bytes(self.pixels)
            self.previous["frames"].append(dict(frame, image_sha256=render.digest(data=self.image.read_bytes()),
                                                input_rgba_sha256=render.digest(data=self.pixels)))
            baseline = bytes((index, 2, 3, 255)) * 2
            for name in ("baseline", "observed"):
                (self.capture / name / f"frame-{index:02d}.rgba").write_bytes(baseline)
            self.previous["comparisons"].append(dict(index=index, equal=True, changed_pixels=0, max_delta=0, bbox=None,
                                                     sha256=render.digest(data=baseline), baseline_sha256=render.digest(data=baseline)))
        trace = encoded(rows=event_rows(frames=self.value["frames"], external=False))
        command = list(map(str, (self.host_path, self.runtime, self.runtime / "Models", self.package)))
        for name in ("baseline", "observed"):
            (self.capture / name / "records.jsonl").write_bytes(trace)
            self.previous["runs"].append(dict(name=name, command=command, protocol_rows=render.protocol(frames=self.frames),
                                              reader_error=None, records_sha256=render.digest(data=trace)))
        self.evidence = dict(passed=True, independent_120_sampling_input_used=True)
        self.hosts, self.calls = [], []
        self.attempt, self.bad = 0, None
        self.host_error, self.close_error = None, None
        self.library, self.factory = Mock(), Mock(side_effect=self.create_host)
        for replacement in (patch.object(render, "DIMENSIONS", (2, 1)),
                            patch.object(render.sequence, "fresh_output", side_effect=self.fresh_output),
                            patch.object(render.sequence, "BoundedHost", self.factory),
                            patch.object(render.consumer, "verify_library", self.library),
                            patch.object(render.geometry, "LIBRARY_SHA256", render.digest(data=b"synthetic runtime")),
                            patch.object(render.geometry, "BYTENN_SHA256", render.digest(data=b"synthetic runtime"))):
            replacement.start()
            self.addCleanup(replacement.stop)
        self.write_reports()

    def write_reports(self):
        (self.capture / "report.json").write_text(json.dumps(self.previous))
        self.candidate.write_text(json.dumps(self.value))
        self.evidence.update(capture_sha256=render.digest(data=(self.capture / "report.json").read_bytes()),
                             replay_sha256=render.digest(data=self.candidate.read_bytes()))
        (self.producer / "report.json").write_text(json.dumps(self.evidence))

    def fresh_output(self, *, path):
        path.mkdir()
        return path

    def arguments(self):
        self.attempt += 1
        return argparse.Namespace(capture=self.capture, candidate=self.candidate, runtime=self.runtime,
                                  package=self.package, out=self.base / f"out-{self.attempt}", diagnostic=False)

    def create_host(self, **kwargs):
        host = Mock(protocol_rows=["QCUT\tREADY\t1"], reader_error=None)
        host.directory, host.cursor, host.request_index = kwargs["log"].parent, 0, 0
        kwargs["log"].write_text("QCUT\tREADY\t1\n")
        (host.directory / "records.jsonl").write_bytes(b"")
        host.render.side_effect = lambda **request: self.do_render(host=host, request=request)
        host.finish.side_effect = lambda: self.finish_host(host=host)
        host.close.side_effect = self.close_error
        self.hosts.append(host)
        self.calls.append(kwargs)
        return host

    def do_render(self, *, host, request):
        if self.host_error:
            raise self.host_error
        index = host.request_index
        frame_index = 0 if index < 6 else index - 6
        pixels = (self.capture / "baseline" / f"frame-{frame_index:02d}.rgba").read_bytes()
        if self.bad == "pixels" and index == 6:
            pixels = bytes((pixels[0] + 1,)) + pixels[1:]
        request["output_path"].write_bytes(pixels[:-1] if self.bad == "truncated" else pixels)
        count = 0 if index == 0 else 2
        events = event_rows(frames=self.value["frames"][host.cursor:host.cursor + count], external=True)
        if index == 1 and events:
            if self.bad == "gpu":
                events[1]["gpu_complete"] = False
            if self.bad == "id":
                events[0]["faces_applied"][0]["id"] += 1
            if self.bad == "points":
                events[0]["faces_applied"][0]["points"][0][0] += 0.01
            if self.bad == "external":
                events[0]["external_points"] = False
            if self.bad == "timing":
                events[0]["timestamp_us"] += 1
            if self.bad == "overlap":
                events = [events[0], events[2], events[1], events[3]]
            if self.bad == "count":
                events = events[:2]
        records = host.directory / "records.jsonl"
        prior = records.read_bytes()
        records.write_bytes((b"" if self.bad == "rewrite" and index == 2 else prior) + encoded(rows=events))
        if self.bad == "malformed":
            records.write_bytes(b'{"event":"x","event":"y"}\n')
        row = f"QCUT\tRESULT\t{request['request_id']}\t0"
        host.protocol_rows.append(row)
        log = host.directory / "host.log"
        log.write_text(log.read_text() + row + "\n")
        host.cursor, host.request_index = host.cursor + count, index + 1

    def finish_host(self, *, host):
        if self.bad == "protocol":
            host.protocol_rows.append("QCUT\tRESULT\textra\t0")
        if self.bad == "reader":
            host.reader_error = RuntimeError("bounded reader failed")
        if self.bad == "late":
            path = host.directory / "records.jsonl"
            path.write_bytes(path.read_bytes() + b'{"event":"late"}\n')
        if self.bad == "log":
            (host.directory / "host.log").write_text("[research-error] fake failure\n")
        if self.bad in ("garbled", "oversized_log"):
            path = host.directory / "host.log"
            path.write_bytes(path.read_bytes() + (b"vendor \xff\xfe diagnostics\n" if self.bad == "garbled"
                                                  else b"x" * render.sequence.LOG_LIMIT))
        if self.bad == "mutation":
            self.host_path.write_bytes(b"mutated executable")

    def run_failure(self, *, pattern=None):
        args = self.arguments()
        context = self.assertRaises(Exception) if pattern is None else self.assertRaisesRegex(Exception, pattern)
        with context:
            render.run(args=args)
        report = json.loads((args.out / "report.json").read_text())
        self.assertFalse(report["passed"])
        self.assertTrue(report["failures"])
        return args, report

    def test_success_exact_schedule_external_payload_and_all_artifacts(self):
        with patch.dict("os.environ", {"QCUT_EVIL": "1", "DYLD_INSERT_LIBRARIES": "bad", "MTL_BAD": "1", "LD_PRELOAD": "bad"}):
            args = self.arguments()
            report = render.run(args=args)
        self.assertTrue(report["passed"])
        self.assertTrue(report["external_replay_verified"] and report["pixel_parity_verified"])
        for field in ("native_analysis_bypassed", "independent_inference_verified", "product_parity_verified"):
            self.assertIs(report[field], False)
        self.assertEqual(len(report["comparisons"]), 7)
        self.assertEqual(report["runs"][0]["owned_face_conversions"], 24)
        host = self.hosts[0]
        host.receive.assert_called_once_with(request_id=None)
        host.finish.assert_called_once()
        host.close.assert_called_once()
        self.assertEqual(host.render.call_count, 13)
        self.assertEqual(self.calls[0]["command"][0], str(self.host_path))
        self.assertEqual(self.calls[0]["max_rows"], 14)
        for key in ("QCUT_EVIL", "DYLD_INSERT_LIBRARIES", "MTL_BAD", "LD_PRELOAD"):
            self.assertNotIn(key, self.calls[0]["environment"])
        self.assertEqual(self.calls[0]["environment"]["QCUT_FACE_BIND_REPLAY"], str(args.out / "replay.bin"))
        requests = [call.kwargs for call in host.render.call_args_list]
        for request in requests[:6]:
            self.assertEqual(request["timestamp"], self.frames[0]["timestamp"])
            self.assertEqual(request["input_path"], self.capture / "input-00.rgba")
            self.assertEqual(json.loads(request["parameters"]), self.frames[0]["parameters"])
        self.assertEqual([request["timestamp"] for request in requests[6:]], [frame["timestamp"] for frame in self.frames])
        self.assertEqual((args.out / "replay.bin").read_bytes(), render.consumer.validate_replay(
            value=self.value, width=2, height=1, image_hash=self.value["image_sha256"]))
        with Image.open(args.out / "comparison-sheet.png") as image:
            self.assertEqual(image.width, 360 * 4)
        for index in range(7):
            self.assertTrue((args.out / f"frame-{index:02d}.png").is_file())
            with Image.open(args.out / f"frame-{index:02d}-diff-gain8.png") as image:
                self.assertEqual(image.mode, "L")
                self.assertEqual(image.getextrema(), (0, 0))
        self.assertEqual(self.library.call_count, 2)

    def test_capture_proof_counts_sources_and_pixel_metrics_fail_before_host(self):
        original = deepcopy(self.previous)
        changes = [("passed", False), ("native_analysis_bypassed", True), ("observer_pixel_parity_verified", False),
                   ("per_prediction_inference_association_verified", False), ("warmup_requests_per_host", 1),
                   ("seeks_per_request", True), ("width", 3), ("frames", original["frames"][:-1]),
                   ("comparisons", original["comparisons"][:-1]), ("source_sha256", {}),
                   ("source_sha256", {"../escape.py": "0" * 64}), ("host_sha256", None)]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                self.previous = dict(deepcopy(original), **{key: value})
                self.write_reports()
                self.run_failure()
                self.factory.assert_not_called()
        self.previous = deepcopy(original)
        self.previous["comparisons"][0]["changed_pixels"] = True
        self.write_reports()
        self.run_failure(pattern="exact baseline")

    def test_candidate_flags_hashes_timing_ids_and_layout_reject_before_host(self):
        original_value, original_evidence = deepcopy(self.value), deepcopy(self.evidence)
        changes = [("passed", 1), ("independent_120_sampling_input_used", False), ("capture_sha256", "0" * 64),
                   ("replay_sha256", None)]
        for key, value in changes:
            with self.subTest(key=key):
                self.evidence = deepcopy(original_evidence)
                self.write_reports()
                self.evidence[key] = value
                (self.producer / "report.json").write_text(json.dumps(self.evidence))
                self.run_failure()
        self.evidence = deepcopy(original_evidence)
        for change in ("count", "timing", "id", "dimensions", "manifest"):
            self.value = deepcopy(original_value)
            if change == "count":
                self.value["frames"].pop()
            if change == "timing":
                self.value["frames"][-1]["timestamp_us"] += 1
            if change == "id":
                self.value["frames"][0]["faces"][0]["id"] += 1
            if change == "dimensions":
                self.value["width"] = 3
            if change == "manifest":
                self.value["image_sha256"] = "0" * 64
            self.write_reports()
            with self.subTest(change=change):
                self.run_failure()
        self.factory.assert_not_called()

    def test_original_manifest_image_input_and_baseline_hash_guards(self):
        for path in (self.manifest, self.image, self.capture / "input-00.rgba", self.capture / "baseline/frame-00.rgba",
                     self.capture / "observed/records.jsonl", self.host_path):
            original = path.read_bytes()
            path.write_bytes(b"mutated")
            with self.subTest(path=path.name):
                self.run_failure()
                self.factory.assert_not_called()
            path.write_bytes(original)

    def test_external_trace_counts_timing_ids_points_restores_and_log_fail_closed(self):
        for bad in ("gpu", "id", "points", "external", "timing", "overlap", "count", "rewrite", "malformed",
                    "protocol", "reader", "late", "log", "truncated", "oversized_log"):
            self.bad = bad
            with self.subTest(bad=bad):
                self.run_failure()
                self.hosts[-1].close.assert_called_once()

    def test_pixel_failure_retains_seven_comparisons_pngs_and_sheet(self):
        self.bad = "pixels"
        args, report = self.run_failure(pattern="beauty pixels differ")
        self.assertTrue(report["external_replay_verified"])
        self.assertEqual(len(report["comparisons"]), 7)
        self.assertEqual(report["comparisons"][0]["max_delta"], 1)
        self.assertTrue((args.out / "comparison-sheet.png").is_file())
        self.assertTrue((args.out / "frame-06.png").is_file())
        with Image.open(args.out / "frame-00-diff-gain8.png") as image:
            self.assertEqual(image.getextrema(), (0, 8))

    def test_diagnostic_mode_keeps_failed_pixel_gate_and_default_rejection(self):
        self.evidence.update(passed=False, completed=True, diagnostic_only=True)
        self.write_reports()
        self.run_failure(pattern="provenance failed")
        self.bad = "pixels"
        args = self.arguments()
        args.diagnostic = True
        report = render.run(args=args)
        self.assertTrue(report["completed"])
        self.assertTrue(report["external_replay_verified"])
        self.assertFalse(report["passed"])
        self.assertFalse(report["pixel_parity_verified"])
        self.assertEqual(len(report["comparisons"]), 7)

    def test_host_exception_and_close_exception_preserve_primary_failure(self):
        self.host_error, self.close_error = RuntimeError("primary render failure"), RuntimeError("close failure")
        _, report = self.run_failure(pattern="primary render failure")
        self.assertIn("close failure", report["runs"][0]["close_error"])
        self.hosts[0].close.assert_called_once()

    def test_close_only_error_and_constructor_failure_write_reports(self):
        self.close_error = RuntimeError("close failed")
        self.run_failure(pattern="close failed")
        self.factory.side_effect = RuntimeError("constructor failed")
        self.run_failure(pattern="constructor failed")

    def test_final_fixture_and_runtime_guards_override_success(self):
        self.bad = "mutation"
        _, report = self.run_failure(pattern="hash mismatch|between reads")
        self.assertTrue(any(row["stage"] == "fixture/source guard" for row in report["failures"]))
        self.host_path.write_bytes(b"synthetic owned host")
        self.bad = None
        self.library.side_effect = [None, RuntimeError("runtime changed")]
        _, report = self.run_failure(pattern="runtime changed")
        self.assertTrue(any(row["stage"] == "runtime guard" for row in report["failures"]))

    def test_shared_validator_is_used_without_timestamp_rebasing(self):
        self.value["frames"][-1]["timestamp_us"] = 200_000
        self.write_reports()
        with patch.object(render.consumer, "validate_replay", side_effect=ValueError("shared timing limit")) as validator:
            self.run_failure(pattern="shared timing limit")
        self.assertEqual(validator.call_args.kwargs["value"]["frames"][-1]["timestamp_us"], 200_000)
        self.factory.assert_not_called()

    def test_normalized_source_paths_and_bare_or_scheme_paths(self):
        self.evidence["source_sha256"] = deepcopy(self.previous["source_sha256"])
        self.write_reports()
        self.assertTrue(render.run(args=self.arguments())["passed"])
        name, checksum = next(iter(self.previous["source_sha256"].items()))
        self.factory.reset_mock()
        for bad in (Path(name).name, "https://example.test/source.py", "file:///source.py", str(Path(render.__file__)),
                    "local-model-pytorch/../source.py", "local-model-pytorch/source\n.py"):
            self.evidence["source_sha256"] = {bad: checksum}
            self.write_reports()
            with self.subTest(path=bad):
                self.run_failure()
                self.factory.assert_not_called()

    def test_raw_non_utf8_vendor_log_is_hashed_without_decoding(self):
        self.bad = "garbled"
        args = self.arguments()
        report = render.run(args=args)
        self.assertTrue(report["passed"])
        checksum = render.digest(data=(args.out / "host.log").read_bytes())
        self.assertEqual(report["runs"][0]["host_log_sha256"], checksum)
        self.assertEqual(report["fixture_sha256"][str(args.out / "host.log")], checksum)

    def test_effect_changed_gate_preserves_sheet_on_noop_failure(self):
        self.frames[0]["expect_change"] = self.previous["frames"][0]["expect_change"] = True
        parameters = {"face_adjust_eye": [{"id": -1, "intensity": 1}]}
        self.frames[0]["parameters"] = self.previous["frames"][0]["parameters"] = parameters
        self.manifest.write_text(json.dumps(dict(version=1, frames=self.frames)))
        self.value["image_sha256"] = render.digest(data=self.manifest.read_bytes())
        for name in ("baseline", "observed"):
            (self.capture / name / "frame-00.rgba").write_bytes(self.pixels)
        self.previous["comparisons"][0].update(sha256=render.digest(data=self.pixels), baseline_sha256=render.digest(data=self.pixels))
        self.write_reports()
        args, report = self.run_failure(pattern="nonzero-effect control")
        self.assertTrue(report["comparisons"][0]["versus_input"]["equal"])
        self.assertTrue((args.out / "comparison-sheet.png").is_file())

    def test_cli_requires_exact_five_arguments(self):
        args = self.arguments()
        argv = ["render"] + [item for key in ("capture", "candidate", "runtime", "package", "out")
                             for item in (f"--{key}", str(getattr(args, key)))]
        result = dict(passed=True, completed=True, pixel_parity_verified=True, external_replay_verified=True)
        with patch("sys.argv", argv), patch.object(render, "run", return_value=result) as runner, patch("builtins.print"):
            render.main()
        self.assertEqual(runner.call_args.kwargs["args"], args)


if __name__ == "__main__":
    unittest.main()
