"""CPU-only video export/bridge gates; all decoder and native launches are faked."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from PIL import Image

import face_live_bridge_bundle as bundle
import face_live_video_probe as probe


class VideoFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="video-probe-test-", dir=probe.sequence.PRIVATE)
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.source = self.directory / "portrait ; literal $(input).mp4"
        self.source.write_bytes(b"local synthetic container, never executed")
        self.executables = []
        for name in ("ffmpeg", "ffprobe"):
            path = self.directory / name
            path.write_bytes(b"CPU-test fake executable")
            path.chmod(0o700)
            self.executables.append(path)
        self.args = probe.parser().parse_args(["--source", str(self.source), "--out", str(self.directory / "out"),
            "--ffmpeg", str(self.executables[0]), "--ffprobe", str(self.executables[1]), "--frames", "3"])
        self.stream = dict(index=0, codec_type="video", width=8, height=6, avg_frame_rate="30000/1001",
            r_frame_rate="30000/1001", time_base="1/90000", sample_aspect_ratio="1:1", field_order="progressive")
        self.metadata = dict(streams=[self.stream], format=dict(duration="103.994000"))
        self.pts = [90000, 93003, 97500]
        self.rows = [dict(stream_index=0, pts=pts, best_effort_timestamp=pts, duration=3003,
                         width=8, height=6, interlaced_frame=0) for pts in self.pts]
        self.commands = []

    def fake_invoke(self, *, name, command, out, scope, timeout):
        self.commands.append(command)
        stdout = out / f"{name}.stdout"
        if name == "metadata":
            stdout.write_text(json.dumps(self.metadata))
        if name == "timestamps":
            stdout.write_text(json.dumps(dict(frames=self.rows)))
        if name == "decode":
            stdout.write_text("")
            lines = ["#hash: SHA256", "#tb 0: 1/90000"]
            for index, pts in enumerate(self.pts):
                image = Image.new("RGBA", (8, 6), (index * 50, 20, 30, 255))
                image.save(out / f"frames/frame-{index:02d}.png")
                digest = hashlib.sha256(image.tobytes()).hexdigest()
                lines.append(f"0, {pts}, {pts}, 3003, {8 * 6 * 4}, {digest}")
            (out / "decoded.framehash").write_text("\n".join(lines))
        return stdout

    def export(self, *, invoke=None, bridge=None):
        with mock.patch.object(probe, "invoke", side_effect=invoke or self.fake_invoke) as decoder, \
                mock.patch.object(probe, "run_bridge", side_effect=bridge) as native:
            result = probe.run(args=self.args)
        return result, decoder, native

    def allow_native(self):
        self.args.execute_native = True
        self.args.lease = "parent-serial-test-lease-NO-NATIVE"
        self.args.runtime = self.args.package = self.args.root = self.directory

    def bridge_result(self, *, args):
        out = args.out.parent
        decoded = json.loads((out / "decoded.json").read_text())["frames"]
        count = (len(decoded) + bundle.WARMUPS) * 2
        return dict(passed=True, completed=True, live_checks_completed=True, dependencies_unchanged=True,
            native_execution_performed=True, cleanup=dict(completed=True), failures=[],
            warmup_request_count=6, render_tolerance=0, temporal_sequence_acceptance=False,
            product_backend_registered=False, manifest_sha256=probe.file_fingerprint(path=args.manifest)["sha256"],
            input_frames=[dict(input_sha256=row["rgba_sha256"], timestamp=row["timestamp"]) for row in decoded],
            frames=[dict(frame=index, equal=True) for index in range(len(decoded))],
            callback_audit=dict(predictions=count, conversions=count - 2, restorations=count - 2, owned_point_groups=count))


class CommandTests(VideoFixture):
    def test_commands_are_argv_local_cpu_bounded_and_never_resample(self):
        commands = probe.commands(args=self.args, out=self.args.out)
        decode = commands["decode"]
        self.assertEqual(decode[decode.index("-i") + 1], str(self.source))
        for option in ("-n", "-nostdin", "-xerror", "-copyts", "-noautorotate"):
            self.assertIn(option, decode)
        for option in ("-y", "-ss", "-s", "-r", "-vf", "-filter_complex", "-stream_loop"):
            self.assertNotIn(option, decode)
        self.assertEqual(decode[decode.index("-hwaccel") + 1], "none")
        self.assertEqual(decode.count("-frames:v"), 2)
        self.assertEqual(decode.count("passthrough"), 2)
        self.assertEqual(decode.count("demux"), 2)
        for name in ("metadata", "timestamps", "decode"):
            command = commands[name]
            self.assertEqual(command[command.index("-protocol_whitelist") + 1], "file")
            self.assertEqual(command[command.index("-threads") + 1], "1")
            self.assertIn("-max_alloc", command)
        self.assertIn("%+4", commands["timestamps"])
        self.assertIn("json", commands["timestamps"])

    def test_invoke_uses_shared_scope_deadline_and_reaping(self):
        self.args.out.mkdir()
        scope = mock.Mock()
        (self.args.out / "metadata.stderr").write_bytes(b"")
        with mock.patch.object(probe.bundle, "system_environment", return_value={"PATH": "/test"}):
            path = probe.invoke(name="metadata", command=["fake", "literal arg"], out=self.args.out,
                                scope=scope, timeout=17)
        self.assertEqual(path.name, "metadata.stdout")
        self.assertEqual(scope.spawn.call_args.kwargs["command"], ["fake", "literal arg"])
        self.assertEqual(scope.spawn.call_args.kwargs["environment"], {"PATH": "/test"})
        scope.wait.assert_called_once_with(process=scope.spawn.return_value, timeout=17)
        scope.finish.assert_called_once_with(process=scope.spawn.return_value)

    def test_decoder_error_stderr_rejects_success_exit(self):
        self.args.out.mkdir()
        (self.args.out / "decode.stderr").write_text("corrupt packet")
        with self.assertRaisesRegex(ValueError, "decoder errors"):
            probe.invoke(name="decode", command=["fake"], out=self.args.out, scope=mock.Mock(), timeout=10)

    def test_unknown_extra_or_seek_flags_are_not_accepted(self):
        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            probe.parser().parse_args(["--extra-root", "/not-enabled"])


class MetadataTests(VideoFixture):
    def test_original_nonzero_pts_and_vfr_are_preserved_not_replaced_by_fps(self):
        info = probe.metadata(value=self.metadata)
        frames = probe.timestamps(value=dict(frames=self.rows), info=info, count=3)
        self.assertEqual(info["avg_frame_rate"], "30000/1001")
        self.assertEqual(info["source_duration"], "51997/500")
        self.assertEqual([row["source_pts"] for row in frames], self.pts)
        self.assertEqual([row["timestamp_us"] for row in frames], [0, 33367, 83333])
        self.assertEqual(frames[1]["relative_seconds"], "1001/30000")
        self.assertNotEqual(frames[2]["timestamp"], 2 / (30000 / 1001))

    def test_negative_absolute_pts_rebase_without_changing_intervals(self):
        for row in self.rows:
            row["pts"] -= 180000
            row["best_effort_timestamp"] = row["pts"]
        frames = probe.timestamps(value=dict(frames=self.rows), info=probe.metadata(value=self.metadata), count=3)
        self.assertEqual(frames[0]["source_seconds"], "-1")
        self.assertEqual(frames[0]["timestamp"], 0)
        self.assertEqual(frames[-1]["timestamp_us"], 83333)

    def test_metadata_resource_geometry_and_video_gates(self):
        cases = [dict(width=2049), dict(width=2048, height=2048), dict(height=0), dict(width=True),
                 dict(codec_type="audio"), dict(disposition=dict(attached_pic=1)),
                 dict(time_base="0/1"), dict(avg_frame_rate="121/1"), dict(r_frame_rate="NaN"),
                 dict(field_order="tt"), dict(sample_aspect_ratio="4:3"), dict(tags=dict(rotate="90")),
                 dict(side_data_list=[dict(side_data_type="Display Matrix", rotation=0)])]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(ValueError):
                probe.metadata(value=dict(self.metadata, streams=[dict(self.stream, **change)]))
        for duration in ("0", "601", "-2", "NaN", 2, True, "9" * 49):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                probe.metadata(value=dict(self.metadata, format=dict(duration=duration)))
        for streams in ([], [self.stream] * 2, "bad", [None]):
            with self.subTest(streams=streams), self.assertRaises(ValueError):
                probe.metadata(value=dict(self.metadata, streams=streams))

    def test_bad_frame_metadata_rejects_before_decode(self):
        cases = [dict(pts=None), dict(pts=True), dict(pts=90000, best_effort_timestamp=90000),
                 dict(pts=89000, best_effort_timestamp=89000), dict(best_effort_timestamp=93004),
                 dict(width=7), dict(stream_index=2), dict(interlaced_frame=1), dict(duration=0),
                 dict(duration=900000), dict(pts=990000, best_effort_timestamp=990000)]
        info = probe.metadata(value=self.metadata)
        for change in cases:
            rows = copy.deepcopy(self.rows)
            rows[1].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                probe.timestamps(value=dict(frames=rows), info=info, count=3)
        for rows in ([], self.rows[:2], self.rows * 400, "bad"):
            with self.subTest(size=len(rows)), self.assertRaises(ValueError):
                probe.timestamps(value=dict(frames=rows), info=info, count=3)

    def test_microsecond_collisions_rejected(self):
        info = probe.metadata(value=self.metadata)
        info["time_base"] = "1/1000000000"
        rows = [dict(self.rows[0], pts=index, best_effort_timestamp=index) for index in range(3)]
        with self.assertRaisesRegex(ValueError, "sub-microsecond"):
            probe.timestamps(value=dict(frames=rows), info=info, count=3)

    def test_duplicate_fields_and_nonfinite_json_rejected(self):
        path = self.directory / "bad.json"
        for value in ('{"frames":[],"frames":[]}', '{"fps":NaN}', '{"fps":1e999}', '[]'):
            path.write_text(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.read_json(path=path)


class ExportTests(VideoFixture):
    def test_default_export_is_fresh_private_manifest_compatible_and_not_native_preparation(self):
        report, decoder, native = self.export()
        self.assertTrue(report["prepared"])
        self.assertTrue(report["completed"])
        self.assertTrue(report["cleanup"]["completed"])
        self.assertTrue(report["dependencies_unchanged"])
        self.assertEqual(decoder.call_count, 3)
        native.assert_not_called()
        for name in ("passed", "bridge_invoked", "native_execution_performed", "temporal_sequence_acceptance",
                     "product_parity_verified", "product_backend_registered", "extra_refinement_enabled"):
            self.assertIs(report[name], False)
        self.assertEqual(self.args.out.stat().st_mode & 0o777, 0o700)
        self.assertEqual(report["motion"]["distinct_frames"], 3)
        self.assertEqual(report["covered_pts_span_seconds"], "1/12")
        self.assertEqual(report["warmup_requests_per_host"], 6)
        self.assertEqual(report["source"]["sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        scratch = self.directory / "bridge-input-CPU-only"
        scratch.mkdir()
        frames, dimensions = bundle.prepare_inputs(manifest=self.args.out / "manifest.json", out=scratch,
                                                   guard=bundle.DependencyGuard())
        self.assertEqual(dimensions, (8, 6))
        requests, _ = bundle.requests(frames=frames, directory=scratch)
        self.assertEqual(len(requests), 9)
        self.assertEqual(sum(row["warmup"] for row in requests), 6)
        self.assertEqual([row["timestamp_us"] for row in requests[6:]], [0, 33367, 83333])
        self.assertEqual(json.loads((self.args.out / "report.json").read_text())["phase"], "cpu-prepared-native-not-run")

    def test_explicit_dry_run_and_static_decoding_fail_closed(self):
        self.args.dry_run = True

        def static(**kwargs):
            path = self.fake_invoke(**kwargs)
            if kwargs["name"] == "decode":
                receipt = self.args.out / "decoded.framehash"
                digest = hashlib.sha256(Image.open(self.args.out / "frames/frame-00.png").tobytes()).hexdigest()
                lines = receipt.read_text().splitlines()[:2]
                for index, pts in enumerate(self.pts):
                    if index:
                        (self.args.out / f"frames/frame-{index:02d}.png").write_bytes(
                            (self.args.out / "frames/frame-00.png").read_bytes())
                    lines.append(f"0, {pts}, {pts}, 3003, 192, {digest}")
                receipt.write_text("\n".join(lines))
            return path

        report, _, native = self.export(invoke=static)
        self.assertFalse(report["prepared"])
        self.assertFalse(report["completed"])
        self.assertIn("static repeats", report["failures"][0]["error"])
        native.assert_not_called()

    def test_decode_missing_extra_wrong_size_hash_or_timestamp_rejected(self):
        for case in ("missing", "extra", "dimensions", "hash", "pts", "order", "receipt-count", "hash-algorithm"):
            self.args.out = self.directory / case

            def corrupt(**kwargs):
                path = self.fake_invoke(**kwargs)
                if kwargs["name"] != "decode":
                    return path
                png = self.args.out / "frames/frame-01.png"
                receipt = self.args.out / "decoded.framehash"
                text = receipt.read_text()
                if case == "missing":
                    png.unlink()
                if case == "extra":
                    (png.parent / "frame-03.png").write_bytes(png.read_bytes())
                if case == "dimensions":
                    Image.new("RGBA", (1, 1)).save(png)
                if case == "hash":
                    Image.new("RGBA", (8, 6)).save(png)
                if case == "pts":
                    receipt.write_text(text.replace("93003", "93004"))
                if case == "order":
                    lines = text.splitlines()
                    lines[2], lines[3] = lines[3], lines[2]
                    receipt.write_text("\n".join(lines))
                if case == "receipt-count":
                    receipt.write_text("\n".join(text.splitlines()[:-1]))
                if case == "hash-algorithm":
                    receipt.write_text(text.replace("SHA256", "MD5"))
                return path

            with self.subTest(case=case):
                report, _, native = self.export(invoke=corrupt)
                self.assertFalse(report["completed"])
                self.assertFalse(report["prepared"])
                self.assertTrue(report["cleanup"]["completed"])
                native.assert_not_called()

    def test_source_mutation_between_probe_and_decode_is_rejected(self):
        def mutate(**kwargs):
            path = self.fake_invoke(**kwargs)
            if kwargs["name"] == "metadata":
                self.source.write_bytes(b"changed source")
            return path

        report, decoder, native = self.export(invoke=mutate)
        self.assertEqual(decoder.call_count, 1)
        self.assertFalse(report["dependencies_unchanged"])
        self.assertFalse(report["completed"])
        native.assert_not_called()

    def test_failure_timeout_and_cancellation_retain_reports_and_cleanup(self):
        for error in (RuntimeError("decoder failed"), TimeoutError("deadline"), KeyboardInterrupt("cancelled")):
            self.args.out = self.directory / type(error).__name__

            def fail(**kwargs):
                if kwargs["name"] == "decode":
                    raise error
                return self.fake_invoke(**kwargs)

            with self.subTest(error=error):
                report, _, native = self.export(invoke=fail)
                self.assertFalse(report["completed"])
                self.assertFalse(report["prepared"])
                self.assertTrue(report["cleanup"]["completed"])
                self.assertEqual(report["failures"][0]["phase"], "decode")
                self.assertIn(type(error).__name__, report["failures"][0]["error"])
                self.assertTrue((self.args.out / "report.json").exists())
                native.assert_not_called()

    def test_existing_output_is_untouched(self):
        self.args.out.mkdir()
        marker = self.args.out / "keep.txt"
        marker.write_text("original")
        with self.assertRaises(FileExistsError):
            self.export()
        self.assertEqual(marker.read_text(), "original")
        self.assertEqual(list(self.args.out.iterdir()), [marker])

    def test_local_output_source_and_executable_gates(self):
        for case in ("public-output", "source-symlink", "relative-executable", "not-executable"):
            args = copy.copy(self.args)
            args.out = self.directory / case
            if case == "public-output":
                args.out = Path("/tmp/video-probe-public-output-must-not-be-created")
            if case == "source-symlink":
                args.source = self.directory / "symlink.mp4"
                args.source.symlink_to(self.source)
            if case == "relative-executable":
                args.ffmpeg = Path("ffmpeg")
            if case == "not-executable":
                args.ffprobe = self.source
            with self.subTest(case=case), mock.patch.object(probe, "invoke") as decoder:
                if case == "public-output":
                    with self.assertRaises(ValueError):
                        probe.run(args=args)
                else:
                    self.assertFalse(probe.run(args=args)["completed"])
                decoder.assert_not_called()


class NativeGateTests(VideoFixture):
    def test_invalid_args_never_create_artifacts(self):
        cases = [dict(frames=1), dict(frames=25), dict(frames=True), dict(decode_timeout=121),
                 dict(timeout=float("nan")), dict(timeout=0), dict(timeout=241), dict(eye_intensity=0),
                 dict(eye_intensity=float("inf")), dict(execute_native=True), dict(execute_native=True, lease=" "),
                 dict(execute_native=True, lease="x\n"), dict(execute_native=True, lease="x" * 161),
                 dict(execute_native=True, lease="x"), dict(lease="no-execute"),
                 dict(execute_native=True, dry_run=True)]
        for change in cases:
            args = copy.copy(self.args)
            for name, value in change.items():
                setattr(args, name, value)
            with self.subTest(change=change), self.assertRaises(ValueError):
                probe.run(args=args)
            self.assertFalse(self.args.out.exists())

    def test_success_is_only_bounded_BASE_handoff_never_temporal_or_product(self):
        self.allow_native()
        self.args.stable_host = True
        report, _, native = self.export(bridge=self.bridge_result)
        self.assertTrue(report["passed"])
        self.assertTrue(report["bounded_native_dependent_rgba_parity"])
        for name in ("temporal_sequence_acceptance", "product_backend_registered", "product_parity_verified",
                     "extra_refinement_enabled"):
            self.assertFalse(report[name])
        forwarded = native.call_args.kwargs["args"]
        self.assertEqual(forwarded.lease, self.args.lease)
        self.assertEqual(forwarded.out, self.args.out / "bridge")
        self.assertTrue(forwarded.execute_native)
        self.assertTrue(forwarded.stable_host)
        self.assertFalse(forwarded.single_frame)
        self.assertFalse(forwarded.static_controls)
        self.assertFalse(forwarded.cold_frame)
        self.assertIsNone(forwarded.extra_root)

    def test_failed_partial_wrong_manifest_point_source_or_result_cannot_pass(self):
        self.allow_native()
        for case in ("failed", "cleanup", "dependencies", "native", "manifest", "source", "time", "rgba", "points", "warmups", "scope"):
            self.args.out = self.directory / case

            def incomplete(*, args):
                result = self.bridge_result(args=args)
                if case == "failed":
                    result["passed"] = False
                if case == "cleanup":
                    result["cleanup"]["completed"] = False
                if case == "dependencies":
                    result["dependencies_unchanged"] = False
                if case == "native":
                    result["native_execution_performed"] = False
                if case == "manifest":
                    result["manifest_sha256"] = "0" * 64
                if case == "source":
                    result["input_frames"][1]["input_sha256"] = "0" * 64
                if case == "time":
                    result["input_frames"][1]["timestamp"] = 0.5
                if case == "rgba":
                    result["frames"][1]["equal"] = False
                if case == "points":
                    result["callback_audit"]["owned_point_groups"] = 0
                if case == "warmups":
                    result["warmup_request_count"] = 0
                if case == "scope":
                    result["temporal_sequence_acceptance"] = True
                return result

            with self.subTest(case=case):
                report, _, native = self.export(bridge=incomplete)
                self.assertTrue(report["prepared"])
                self.assertFalse(report["passed"])
                self.assertFalse(report["completed"])
                self.assertFalse(report["bounded_native_dependent_rgba_parity"])
                native.assert_called_once()

    def test_post_bridge_source_mutation_revokes_pass(self):
        self.allow_native()

        def mutate(*, args):
            result = self.bridge_result(args=args)
            self.source.write_bytes(b"mutation after native")
            return result

        report, _, _ = self.export(bridge=mutate)
        self.assertFalse(report["passed"])
        self.assertFalse(report["bounded_native_dependent_rgba_parity"])
        self.assertFalse(report["dependencies_unchanged"])

    def test_bridge_exception_or_cancel_cannot_be_misreported_as_prepared_success(self):
        self.allow_native()
        for error in (RuntimeError("bridge failed"), KeyboardInterrupt("bridge cancelled")):
            self.args.out = self.directory / type(error).__name__
            with self.subTest(error=error):
                report, _, native = self.export(bridge=error)
                self.assertTrue(report["bridge_invoked"])
                self.assertFalse(report["completed"])
                self.assertFalse(report["passed"])
                self.assertEqual(report["failures"][0]["phase"], "BASE-bridge")
                native.assert_called_once()


if __name__ == "__main__":
    unittest.main()
