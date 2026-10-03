"""Dependency-free validation, metrics, logging, and mocked sequence orchestration."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import face_render_sequence_probe as probe


def frame(**changes):
    return dict(image="photo.png", timestamp=0, parameters={"eye": [{"id": -1, "intensity": 1}]}, **changes)

def owned_records(*, count=2):
    conversion = dict(event="owned_face_conversion", faces=0, eye_shift=0,
        raw_clone_verified=True, original_restored=False, native_analysis_bypassed=False)
    restored = dict(event="owned_face_restored", original_restored=True, gpu_complete=True)
    return b"".join((json.dumps(event) + "\n").encode() for _ in range(count) for event in (conversion, restored))


class OwnedEvidenceTest(unittest.TestCase):
    def test_empty_face_conversions_are_valid_and_counts_exclude_warmup(self):
        evidence = probe.validate_owned_events(data=owned_records(), minimum=2)
        self.assertEqual(evidence, dict(owned_face_conversions=2, owned_face_restorations=2))
        probe.validate_owned_events(data=b"", minimum=0)
        with self.assertRaises(RuntimeError):
            probe.validate_owned_events(data=owned_records(count=1), minimum=2)

    def test_false_flags_perturbation_bad_counts_and_malformed_json_fail(self):
        for index, key, value in ((0, "raw_clone_verified", False), (0, "native_analysis_bypassed", True),
                (0, "original_restored", True), (0, "eye_shift", .01), (0, "faces", True),
                (1, "original_restored", False), (1, "gpu_complete", False)):
            events = [json.loads(row) for row in owned_records().splitlines()]
            events[index][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                probe.validate_owned_events(data=b"\n".join(json.dumps(event).encode() for event in events), minimum=2)
        for data in (b"[]\n", b"bad json", owned_records().splitlines()[0], b"\n".join(reversed(owned_records().splitlines()))):
            with self.subTest(data=data), self.assertRaises((RuntimeError, ValueError)):
                probe.validate_owned_events(data=data, minimum=2)

    def test_owned_source_snapshot_merges_all_ownership_sources_lazily(self):
        owned = SimpleNamespace(probe_sources=Mock(return_value={"owned-bridge": "owned-sha"}))
        with patch.dict(sys.modules, {"face_owned_result_probe": owned}), \
                patch.object(probe.consumer, "source_snapshot", return_value={"product-host": "sha"}):
            snapshot = probe.source_snapshot(owned=True)
        self.assertEqual(snapshot["owned-bridge"], "owned-sha")
        self.assertIn("product-host", snapshot)
        owned.probe_sources.assert_called_once()


class ValidationTest(unittest.TestCase):
    def validate(self, *, frames, expect_change=False):
        return probe.validate_manifest(value=dict(version=1, frames=frames), base=Path("/local"),
                                       expect_change=expect_change)

    def test_bounds_relative_paths_and_nonmonotonic_timestamps(self):
        result = self.validate(frames=[frame(), {**frame(), "timestamp": 60}, frame()])
        self.assertEqual([item["timestamp"] for item in result], [0, 60, 0])
        self.assertEqual(result[0]["image"], "/local/photo.png")
        self.assertEqual(len(self.validate(frames=[frame()] * 24)), 24)

    def test_invalid_manifest_shapes(self):
        for value in (None, [], {}, dict(version=True, frames=[frame()]),
                      dict(version=2, frames=[frame()]), dict(version=1, frames=[]),
                      dict(version=1, frames=[frame()] * 25), dict(version=1, frames={})):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.validate_manifest(value=value, base=Path("/local"))

    def test_all_invalid_frames_are_reported(self):
        with self.assertRaises(ValueError) as error:
            self.validate(frames=[None, {**frame(), "timestamp": -1}, {**frame(), "parameters": []}])
        for index in range(3):
            self.assertIn(f"frame {index}:", str(error.exception))

    def test_invalid_timestamps(self):
        for value in (-1, 60.001, float("nan"), float("inf"), -float("inf"), True, "0", None, 10**1000):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(frames=[{**frame(), "timestamp": value}])

    def test_local_paths_only_and_no_protocol_delimiters(self):
        for value in (None, "", " ", "https://host/a", "file:/a", "x\ty", "x\ny", "x\ry", "x\0y", "x" * 4097):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(frames=[{**frame(), "image": value}])
        result = self.validate(frames=[{**frame(), "image": "/absolute/photo.png"}])
        self.assertEqual(result[0]["image"], "/absolute/photo.png")

    def test_parameter_validation_is_recursive_and_bounded(self):
        for value in ([], None, 1, {"x": [float("nan")]}, {"x": {"v": float("inf")}}, {"x": "a" * 16384}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(frames=[{**frame(), "parameters": value}])

    def test_nonzero_control_is_explicit_and_identity_ids_do_not_count(self):
        self.validate(frames=[{**frame(), "expect_change": True}], expect_change=True)
        for parameters in ({}, {"eye": [{"id": -1, "intensity": 0}]}, {"track_id": 3}, {"x": True}):
            with self.subTest(parameters=parameters), self.assertRaisesRegex(ValueError, "nonzero"):
                self.validate(frames=[{**frame(), "parameters": parameters, "expect_change": True}])
        with self.assertRaisesRegex(ValueError, "marked"):
            self.validate(frames=[frame()], expect_change=True)
        self.validate(frames=[{**frame(), "parameters": {}}])

    def test_invalid_control_labels_and_unknown_keys(self):
        for changes in ({"expect_change": 1}, {"label": 3}, {"label": "x" * 81}, {"expect_changes": True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.validate(frames=[{**frame(), **changes}])

    def test_dimensions(self):
        probe.validate_dimensions(width=4096, height=4096, expected=(4096, 4096))
        for width, height, expected in ((0, 1, None), (4097, 1, None), (True, 1, None),
                                        (1, 1.0, None), (2, 1, (1, 1))):
            with self.subTest(width=width), self.assertRaises(ValueError):
                probe.validate_dimensions(width=width, height=height, expected=expected)

    def test_import_and_pure_helpers_without_site_packages(self):
        code = ("import sys; from pathlib import Path; import face_render_sequence_probe as p; "
                "p.validate_manifest(value={'version':1,'frames':[{'image':'a','timestamp':0,'parameters':{}}]},base=Path('/')); "
                "p.frame_difference(actual=b'1234',reference=b'1234',width=1,height=1); "
                "assert 'PIL' not in sys.modules and 'numpy' not in sys.modules")
        subprocess.run([sys.executable, "-S", "-c", code], cwd=Path(probe.__file__).parent, check=True, timeout=10)


class MetricsTest(unittest.TestCase):
    def test_equal_is_black(self):
        metrics, gray = probe.frame_difference(actual=b"12345678", reference=b"12345678", width=2, height=1)
        self.assertTrue(metrics["equal"])
        self.assertEqual((metrics["changed_pixels"], metrics["max_delta"], metrics["bbox"]), (0, 0, None))
        self.assertEqual(gray, b"\0\0")

    def test_alpha_signed_deltas_bbox_and_uniform_gain(self):
        reference = bytes([0, 0, 0, 255] * 6)
        actual = bytearray(reference)
        actual[3], actual[16], actual[20] = 0, 1, 31
        metrics, gray = probe.frame_difference(actual=bytes(actual), reference=reference, width=3, height=2)
        self.assertEqual((metrics["changed_pixels"], metrics["max_delta"], metrics["bbox"]), (3, 255, [0, 0, 3, 2]))
        self.assertEqual(list(gray), [255, 0, 0, 0, 8, 248])
        other, gain = probe.frame_difference(actual=bytes([1, 0, 0, 255]), reference=reference[:4], width=1, height=1)
        self.assertEqual(gain, b"\x08")
        self.assertNotEqual(other["sha256"], metrics["sha256"])

    def test_bad_lengths(self):
        for actual, reference in ((b"123", b"1234"), (b"1234", b"123"), (b"12345", b"12345")):
            with self.subTest(actual=actual), self.assertRaisesRegex(ValueError, "byte count"):
                probe.frame_difference(actual=actual, reference=reference, width=1, height=1)


class GuardsTest(unittest.TestCase):
    def test_fresh_private_output_refuses_reuse_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private = root / "private"
            private.mkdir()
            (private / "escape").symlink_to(root, target_is_directory=True)
            with patch.object(probe, "PRIVATE", private):
                output = probe.fresh_output(path=private / "case")
                self.assertEqual(output.stat().st_mode & 0o777, 0o700)
                for path in (output, private, root / "outside", private / "escape/case"):
                    with self.subTest(path=path), self.assertRaises((ValueError, FileExistsError)):
                        probe.fresh_output(path=path)

    def test_byte_limit_and_mutation_during_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image"
            path.write_bytes(b"abcd")
            with self.assertRaisesRegex(ValueError, "byte limit"):
                probe.bounded_bytes(path=path, limit=3)
            read = probe.bounded_bytes
            def mutate(**kwargs):
                data = read(**kwargs)
                path.write_bytes(b"efgh")
                return data
            with patch.object(probe, "bounded_bytes", side_effect=mutate), self.assertRaisesRegex(RuntimeError, "mutated"):
                probe.file_identity(path=path, limit=4)

    def test_all_source_image_runtime_guard_failures_are_captured(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "image"
            path.write_bytes(b"a")
            identity, _ = probe.file_identity(path=path, limit=1)
            path.write_bytes(b"b")
            report = dict(failures=[], source_sha256={"source": "old"})
            with patch.object(probe, "source_snapshot", return_value={"source": "new"}), \
                    patch.object(probe, "verify_runtime", side_effect=ValueError("wrong UUID")):
                self.assertFalse(probe.check_guards(report=report, files={path: (identity, 1)}, runtime=Path("/runtime")))
            self.assertEqual(len(report["failures"]), 3)

    def test_runtime_verification_reuses_guard_with_outer_timeout(self):
        with patch.object(probe.subprocess, "run") as execute:
            probe.verify_runtime(runtime=Path("/runtime"))
        args, kwargs = execute.call_args
        self.assertIn("c.verify_library", args[0][2])
        self.assertEqual(kwargs["timeout"], 60)
        self.assertTrue(kwargs["check"])


class LoggingTest(unittest.TestCase):
    def read(self, *, text, log_limit=probe.LOG_LIMIT, max_rows=25):
        host = probe.BoundedHost.__new__(probe.BoundedHost)
        host.protocol_rows, host.reader_error, host.rows = [], None, queue.Queue()
        host.max_rows = max_rows
        host.process = Mock(stdout=io.StringIO(text))
        host.process.poll.return_value = None
        with tempfile.TemporaryDirectory() as temporary, patch.object(probe, "LOG_LIMIT", log_limit):
            log = Path(temporary) / "host.log"
            host.read(log=log)
            self.assertLessEqual(log.stat().st_size, log_limit)
        return host

    def test_complete_rows_and_eof(self):
        host = self.read(text="vendor log\nQCUT\tREADY\t1\nQCUT\tRESULT\tframe-00\t0\n")
        host.receive(request_id=None)
        host.receive(request_id="frame-00")
        self.assertIsNone(host.rows.get_nowait())
        host.process.kill.assert_not_called()

    def test_line_log_protocol_flood_and_error_limits_kill_host(self):
        for text, limit in (("x" * (probe.LINE_LIMIT + 1), probe.LOG_LIMIT),
                            ("small line\n" * 10, 32), ("QCUT\tREADY\t1\n" * 26, probe.LOG_LIMIT),
                            ("[research-error] failure\n", probe.LOG_LIMIT), ("[error] failed\n", probe.LOG_LIMIT)):
            with self.subTest(text=text[:40]):
                host = self.read(text=text, log_limit=limit)
                self.assertIsInstance(host.reader_error, RuntimeError)
                host.process.kill.assert_called_once()

    def test_watchdog_bounds_stdin_write_and_is_cancelled_on_error(self):
        host = probe.BoundedHost.__new__(probe.BoundedHost)
        host.process = Mock()
        with patch.object(probe.threading, "Timer") as timer, \
                patch.object(probe.NativeHost, "render", side_effect=RuntimeError("timeout")), \
                self.assertRaises(RuntimeError):
            host.render(request_id="frame-00")
        timer.assert_called_once_with(65, host.process.kill)
        timer.return_value.start.assert_called_once()
        timer.return_value.cancel.assert_called_once()

    def test_owned_row_budget_includes_one_bootstrap_at_24_frames(self):
        self.assertIsNone(self.read(text="QCUT\tREADY\t1\n" * 26, max_rows=26).reader_error)
        self.assertIsInstance(self.read(text="QCUT\tREADY\t1\n" * 27, max_rows=26).reader_error, RuntimeError)


class SequenceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.runtime, self.package = self.root / "runtime", self.root / "package"
        (self.runtime / "Models").mkdir(parents=True)
        self.package.mkdir()
        self.image = self.root / "photo.png"
        self.image.write_bytes(b"synthetic-image")
        self.manifest = self.root / "manifest.json"
        self.args = argparse.Namespace(out=self.root / "private/case", runtime=self.runtime,
            package=self.package, manifest=self.manifest, expect_change=False)
        self.pixels = b"\x10\x20\x30\xff"
        fake_image = Mock(width=1, height=1, size=(1, 1))
        fake_image.__enter__ = Mock(return_value=fake_image)
        fake_image.__exit__ = Mock(return_value=False)
        fake_image.convert.return_value = fake_image
        fake_image.tobytes.return_value = self.pixels
        self.pil = SimpleNamespace(Image=Mock())
        self.pil.Image.open.return_value = fake_image
        self.pil.Image.frombytes.return_value = fake_image
        self.hosts = []
        self.outputs = lambda *, run_index, index, pixels: pixels
        self.owned_events = lambda *, bootstrap: owned_records(count=1 if bootstrap else 2)
        self.ownership = SimpleNamespace(compile_owned=Mock(side_effect=lambda **kw: kw["output"].write_bytes(b"owned-host")))
        for context in (patch.object(probe, "PRIVATE", self.root / "private"),
                        patch.object(probe, "source_snapshot", return_value={"source": "frozen"}),
                        patch.object(probe, "verify_runtime", return_value=None),
                        patch.object(probe.consumer, "compile_host", side_effect=lambda **kw: kw["output"].write_bytes(b"host")),
                        patch.object(probe, "BoundedHost", side_effect=self.host),
                        patch.dict(sys.modules, {"PIL": self.pil, "face_render_injection_inventory":
                            SimpleNamespace(LIBRARY_SHA256="frozen-runtime", UUID="frozen-uuid"),
                            "face_owned_result_probe": self.ownership})):
            context.start()
            self.addCleanup(context.stop)

    def host(self, **kwargs):
        host = Mock(protocol_rows=[], reader_error=None)
        host.process.poll.return_value = 0
        host.receive.side_effect = lambda **kw: host.protocol_rows.append("QCUT\tREADY\t1")
        run_index = len(self.hosts)
        record = kwargs["environment"].get("QCUT_CONSUMER_RECORD")
        if record:
            Path(record).write_bytes(b"")
        def render(**request):
            index = int(request["request_id"].split("-")[-1])
            pixels = self.outputs(run_index=run_index, index=index, pixels=request["input_path"].read_bytes())
            request["output_path"].write_bytes(pixels)
            if record:
                with Path(record).open("ab") as stream:
                    stream.write(self.owned_events(bootstrap=request["request_id"] == "warmup-0"))
            host.protocol_rows.append(f"QCUT\tRESULT\t{request['request_id']}\t0")
        host.render.side_effect = render
        self.hosts.append((host, kwargs))
        return host

    def execute(self, *, frames):
        self.manifest.write_text(json.dumps(dict(version=1, frames=frames)))
        report = probe.run(args=self.args)
        saved = json.loads((Path(report["out"]) / "report.json").read_text())
        self.assertEqual(saved, report)
        self.assertFalse(report["native_analysis_bypassed"])
        return report

    def test_two_fresh_original_hosts_and_legitimate_unchanged_frames(self):
        with patch.dict(os.environ, {"QCUT_FACE_REPLAY": "bad", "DYLD_INSERT_LIBRARIES": "bad", "QCUT_WAIT_ENGINE_RENDERER": "1"}):
            report = self.execute(frames=[frame(), {**frame(), "parameters": {"eye": 0}}])
        self.assertTrue(report["passed"], report["failures"])
        self.assertEqual(len(self.hosts), 2)
        probe.consumer.compile_host.assert_called_once_with(output=self.args.out / "host", original=True)
        self.assertEqual(probe.verify_runtime.call_count, 4)
        for host, kwargs in self.hosts:
            self.assertEqual(host.render.call_count, 2)
            host.finish.assert_called_once()
            host.close.assert_called_once()
            self.assertNotIn("DYLD_INSERT_LIBRARIES", kwargs["environment"])
            self.assertNotIn("QCUT_FACE_REPLAY", kwargs["environment"])
            self.assertNotIn("QCUT_WAIT_ENGINE_RENDERER", kwargs["environment"])
        self.assertEqual(len(report["comparisons"]), 2)
        self.assertTrue(all(item["equal"] for item in report["comparisons"]))

    def test_explicit_control_rejects_noop_in_both_runs(self):
        report = self.execute(frames=[{**frame(), "expect_change": True}])
        self.assertFalse(report["passed"])
        self.assertEqual(sum("control did not differ" in item["error"] for item in report["failures"]), 2)

    def test_nonzero_control_passes_with_matching_effect(self):
        self.outputs = lambda **kw: b"\x11\x20\x30\xff"
        self.assertTrue(self.execute(frames=[{**frame(), "expect_change": True}])["passed"])

    def test_all_corresponding_mismatches_are_reported(self):
        self.outputs = lambda **kw: bytes([17 + kw["run_index"], 32, 48, 255])
        report = self.execute(frames=[frame()] * 3)
        self.assertFalse(report["passed"])
        self.assertEqual([item["index"] for item in report["comparisons"] if not item["equal"]], [0, 1, 2])
        self.assertEqual(sum(item["stage"].startswith("repeat frame") for item in report["failures"]), 3)

    def test_bad_output_does_not_hide_later_frames(self):
        self.outputs = lambda **kw: b"short" if kw["index"] == 0 else kw["pixels"]
        report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["runs"]), 2)
        self.assertTrue(all(run["frames"][1]["passed"] for run in report["runs"]))

    def test_preflight_failures_write_strict_report_without_launch(self):
        probe.verify_runtime.side_effect = ValueError("wrong SHA/UUID")
        report = self.execute(frames=[frame()])
        self.assertFalse(report["passed"])
        probe.consumer.compile_host.assert_not_called()
        self.assertEqual(self.hosts, [])

    def test_mutated_input_refuses_second_host(self):
        def mutate(**kw):
            self.image.write_bytes(b"mutated-image")
            return kw["pixels"]
        self.outputs = mutate
        report = self.execute(frames=[frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(len(self.hosts), 1)
        self.assertTrue(any("file guard" in item["stage"] for item in report["failures"]))

    def test_source_mutation_during_compile_refuses_all_hosts(self):
        probe.source_snapshot.side_effect = [{"source": "frozen"}, {"source": "frozen"}, {"source": "mutated"}, {"source": "mutated"}]
        report = self.execute(frames=[frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(self.hosts, [])

    def test_invalid_manifest_still_reports_failure(self):
        report = self.execute(frames=[{**frame(), "timestamp": float("nan")}])
        self.assertFalse(report["passed"])
        self.pil.Image.open.assert_not_called()

    def test_startup_failure_captures_both_runs_and_every_skipped_frame(self):
        with patch.object(probe, "BoundedHost", side_effect=OSError("host failed")) as launch:
            report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(launch.call_count, 2)
        self.assertTrue(all(detail["skipped"] for run in report["runs"] for detail in run["frames"]))

    def test_native_error_response_does_not_hide_recovery(self):
        def native_error(**kw):
            if kw["index"] == 0:
                self.hosts[-1][0].protocol_rows.append("QCUT\tRESULT\tframe-00\t1\tfailed")
                raise RuntimeError("native error response")
            return kw["pixels"]
        self.outputs = native_error
        report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["runs"]), 2)
        self.assertTrue(all(run["frames"][1]["passed"] for run in report["runs"]))

    def test_failed_teardown_and_final_runtime_guard_cannot_pass(self):
        def fail_close(**kw):
            self.hosts[-1][0].close.side_effect = OSError("teardown failed")
            return kw["pixels"]
        self.outputs = fail_close
        probe.verify_runtime.side_effect = [None, None, None, ValueError("runtime mutated")]
        report = self.execute(frames=[frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(sum(item["stage"].endswith("close") for item in report["failures"]), 2)
        self.assertTrue(any("runtime mutated" in item["error"] for item in report["failures"]))

    def test_repeated_image_mutation_during_preparation_is_refused(self):
        original = self.pil.Image.open.return_value
        def mutate_image(*args):
            self.image.write_bytes(b"mutated-image")
            return original
        self.pil.Image.open.side_effect = mutate_image
        report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertEqual(self.hosts, [])
        self.assertTrue(any("repeated source image mutated" in item["error"] for item in report["failures"]))

    def test_reused_output_gets_fresh_failed_report_without_overwriting(self):
        self.args.out.mkdir(parents=True)
        sentinel = self.args.out / "sentinel"
        sentinel.write_bytes(b"preserve")
        report = self.execute(frames=[frame()])
        self.assertFalse(report["passed"])
        self.assertNotEqual(report["out"], str(self.args.out))
        self.assertEqual(sentinel.read_bytes(), b"preserve")

    def test_main_nonzero_exit_on_failed_report(self):
        with patch.object(probe, "run", return_value=dict(passed=False, out="private", failures=[])), \
                patch.object(sys, "argv", ["probe"]), patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(probe.main(), 1)

    def test_owned_compiler_bootstrap_arguments_trace_and_tested_seek_counts(self):
        self.args.owned = True
        frames = [{**frame(), "timestamp": 7.5}, frame()]
        report = self.execute(frames=frames)
        self.assertTrue(report["passed"], report["failures"])
        self.ownership.compile_owned.assert_called_once_with(output=self.args.out / "owned-host", binding=True)
        self.assertEqual(report["owned_face_conversions"], 4)
        self.assertEqual(report["owned_face_restorations"], 4)
        for host, kwargs in self.hosts:
            self.assertEqual(host.render.call_count, 3)
            warmup, first = [call.kwargs for call in host.render.call_args_list[:2]]
            self.assertEqual(warmup["request_id"], "warmup-0")
            for key in ("timestamp", "input_path", "parameters"):
                self.assertEqual(warmup[key], first[key])
            self.assertEqual(kwargs["max_rows"], 26)
        environment = self.hosts[1][1]["environment"]
        self.assertEqual(environment["QCUT_TRACE_UPDATES"], "1")
        self.assertEqual(environment["QCUT_FACE_POINT_SHIFT"], "0")
        self.assertTrue(environment["QCUT_CONSUMER_RECORD"].endswith("run-1/records.jsonl"))
        self.assertTrue(self.hosts[0][1]["command"][0].endswith("/host"))
        self.assertTrue(self.hosts[1][1]["command"][0].endswith("/owned-host"))

    def test_owned_warmup_conversions_cannot_mask_missing_tested_conversions(self):
        self.args.owned = True
        self.owned_events = lambda *, bootstrap: owned_records(count=8 if bootstrap else 1)
        report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertFalse(report["owned_result_rendered"])
        self.assertEqual(sum("tested-seek" in item["error"] for item in report["failures"]), 2)

    def test_owned_bootstrap_failure_skips_tested_frames(self):
        self.args.owned = True
        self.outputs = Mock(side_effect=RuntimeError("bootstrap failed"))
        report = self.execute(frames=[frame(), frame()])
        self.assertFalse(report["passed"])
        self.assertTrue(all(detail["skipped"] for run in report["runs"] for detail in run["frames"]))
        self.assertTrue(all(host.render.call_count == 1 for host, _ in self.hosts))


if __name__ == "__main__":
    unittest.main()
