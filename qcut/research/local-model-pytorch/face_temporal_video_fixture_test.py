"""Synthetic local-video fixture contracts; no vendor code or remote media."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

import face_temporal_video_fixture as fixture


def metadata(*, duration="2", start="0", width=640, height=480):
    return dict(streams=[dict(index=0, width=width, height=height, duration=duration,
                             start_time=start, start_pts=int(float(start) * 1000000),
                             time_base="1/1000000", sample_aspect_ratio="1:1")],
                format=dict(duration=duration, format_name="mov,mp4,m4a,3gp,3g2,mj2"))


def decoded(*, timestamps=(0, 0.5, 1, 1.5), start=0, width=640, height=480):
    return dict(frames=[dict(width=width, height=height, best_effort_timestamp=
                            round((stamp + start) * 1000000) if fixture.finite(value=stamp + start) else None)
                        for stamp in timestamps])


class BoundaryTests(unittest.TestCase):
    def test_count_defaults_endpoints_repeated_windows_and_60_seconds(self):
        self.assertEqual(fixture.requests(start=0, end=1, count=7), [index / 6 for index in range(7)])
        self.assertEqual(fixture.requests(start=60, end=60, count=1), [60])
        self.assertEqual(fixture.requests(start=1, end=1, count=24), [1] * 24)
        for start, end, count in ((-1, 1, 7), (0, 60.01, 7), (2, 1, 7), (False, 1, 7),
                                  (0, float("inf"), 7), (0, float("nan"), 7), (0, 10**400, 7),
                                  (0, 1, 0), (0, 1, 25), (0, 1, True), (0, 1, 7.0)):
            with self.subTest(values=(start, end, count)), self.assertRaises(ValueError):
                fixture.requests(start=start, end=end, count=count)

    def test_one_parameter_intensity_and_explicit_no_face_boundaries(self):
        for parameter in fixture.EYE_PARAMETERS:
            for intensity in (-1, 0, 1):
                self.assertEqual(fixture.effect(parameter=parameter, intensity=intensity, no_face=[0], count=1),
                                 {parameter: [dict(id=-1, intensity=intensity)]})
        for values in (dict(parameter="unknown"), dict(intensity=1.01), dict(intensity=-1.01),
                       dict(intensity=True), dict(intensity=float("nan")), dict(no_face=[1]),
                       dict(no_face=[True]), dict(no_face=[0, 0]), dict(no_face={0})):
            arguments = dict(parameter="face_adjust_eye", intensity=1, no_face=[], count=1)
            arguments.update(values)
            with self.subTest(values=values), self.assertRaises(ValueError):
                fixture.effect(**arguments)

    def test_decoded_ceiling_selection_records_actual_not_requested_time(self):
        info = fixture.video_metadata(value=metadata(start="5"))
        result = fixture.select_frames(value=decoded(start=5), metadata=info, requested=[0, 0.2, 0.9, 1.5])
        self.assertEqual([row["timestamp"] for row in result], [0, 0.5, 1, 1.5])
        self.assertEqual([row["decoded_timestamp"] for row in result], [5, 5.5, 6, 6.5])
        self.assertEqual([row["decoded_frame_index"] for row in result], [0, 1, 2, 3])
        self.assertEqual(result[1]["requested_timestamp"], 0.2)

    def test_source_duration_and_replay_bounds_never_silently_clip_seek(self):
        for stamps, requested, duration in (((0, 1), [2], "2"), ((0, 1), [1.5], "2"),
                                            ((0, 60.01), [60], "61"), ((0, 2.1), [1.9], "2")):
            with self.subTest(values=(stamps, requested, duration)), self.assertRaises(ValueError):
                fixture.select_frames(value=decoded(timestamps=stamps),
                                      metadata=fixture.video_metadata(value=metadata(duration=duration)), requested=requested)
        result = fixture.select_frames(value=decoded(timestamps=(0, 60)),
                    metadata=fixture.video_metadata(value=metadata(duration="61")), requested=[60])
        self.assertEqual(result[0]["timestamp"], 60)

    def test_integer_pts_avoids_ffprobe_decimal_rounding_advancing_one_frame(self):
        value = metadata()
        value["streams"][0]["time_base"] = "1/6"
        rows = dict(frames=[dict(width=640, height=480, best_effort_timestamp=index) for index in range(12)])
        result = fixture.select_frames(value=rows, metadata=fixture.video_metadata(value=value),
                                       requested=[index / 6 for index in range(7)])
        self.assertEqual([row["decoded_frame_index"] for row in result], list(range(7)))
        self.assertEqual([row["timestamp"] for row in result], [index / 6 for index in range(7)])

    def test_frame_rows_missing_nonfinite_unordered_or_variable_dimensions_reject(self):
        for value in (dict(frames=[]), dict(frames=[{}]), dict(frames=[False]),
                      decoded(timestamps=(1, 0)), decoded(timestamps=(-0.1, 1)),
                      decoded(timestamps=(float("nan"),)), decoded(width=641),
                      dict(frames=[dict(width=640, height=480, best_effort_timestamp=True)]),
                      dict(frames=[dict(width=640, height=480, best_effort_timestamp=0)] * 12001)):
            with self.subTest(value=str(value)[:70]), self.assertRaises(ValueError):
                fixture.select_frames(value=value, metadata=fixture.video_metadata(value=metadata()), requested=[0])

    def test_metadata_duration_fallback_and_standalone_square_pixel_guards(self):
        value = metadata()
        value["streams"][0].pop("duration")
        self.assertEqual(fixture.video_metadata(value=value)["duration_basis"], "format")
        for key, bad in (("width", 4097), ("width", True), ("index", False), ("duration", "0"),
                         ("duration", "nan"), ("start_time", float("nan")), ("sample_aspect_ratio", "2:1"),
                         ("time_base", "1/0"), ("time_base", "0/1"), ("start_pts", True)):
            value = metadata()
            value["streams"][0][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError):
                fixture.video_metadata(value=value)
        for value in (dict(streams=[]), dict(streams=[{}, {}]),
                      dict(metadata(), format={"duration": "2", "format_name": "hls"})):
            with self.assertRaises(ValueError):
                fixture.video_metadata(value=value)

    def test_local_path_delimiters_remote_protocols_empty_and_directory_sources(self):
        for path in ("https://example.test/video.mp4", "file:///tmp/video.mp4", "clip\n.mp4", "clip\t.mp4"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                fixture.local_path(path=path)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaises(ValueError):
                fixture.video_identity(path=directory)
            empty = directory / "empty.mp4"
            empty.touch()
            with self.assertRaises(ValueError):
                fixture.video_identity(path=empty)
            source = directory / "video with spaces.mp4"
            source.write_bytes(b"local video")
            identity = fixture.video_identity(path=source)
            self.assertEqual(identity["sha256"], fixture.hashlib.sha256(b"local video").hexdigest())
            with patch.object(fixture, "VIDEO_LIMIT", 4), self.assertRaises(ValueError):
                fixture.video_identity(path=source)

    def test_unspecified_sar_requires_opt_in_and_never_overrides_explicit_nonsquare(self):
        for raw in ("missing", "N/A", "0:1"):
            value = metadata()
            if raw == "missing":
                value["streams"][0].pop("sample_aspect_ratio")
            else:
                value["streams"][0]["sample_aspect_ratio"] = raw
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                fixture.video_metadata(value=value)
            policy = fixture.video_metadata(value=value, assume_square_pixels=True)["sample_aspect_ratio"]
            self.assertEqual(policy["raw"], None if raw == "missing" else raw)
            self.assertEqual(policy["field_present"], raw != "missing")
            self.assertEqual((policy["assumed_square_pixels"], policy["basis"]), (True, "caller-assumption"))
        for raw in ("2:1", "16:15", "", None, True, 0):
            value = metadata()
            value["streams"][0]["sample_aspect_ratio"] = raw
            for enabled in (False, True):
                with self.subTest(raw=raw, enabled=enabled), self.assertRaises(ValueError):
                    fixture.video_metadata(value=value, assume_square_pixels=enabled)
        for flag in (1, 0, None, "true"):
            with self.subTest(flag=flag), self.assertRaisesRegex(ValueError, "typed boolean"):
                fixture.video_metadata(value=metadata(), assume_square_pixels=flag)

    def test_json_duplicate_nonfinite_not_object_limits_and_deadline(self):
        for data in (b'{"frames":[],"frames":[]}', b'{"duration":NaN}', b'[]', b'{oops'):
            commands = []
            with patch.object(fixture.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, data, b"")) as run:
                with self.assertRaises(ValueError):
                    fixture.command_json(command=["ffprobe", "video.mp4"], commands=commands)
                self.assertEqual(run.call_args.kwargs["timeout"], 120)
                self.assertTrue(run.call_args.kwargs["check"])
                self.assertEqual(commands, [["ffprobe", "video.mp4"]])
        with patch.object(fixture, "JSON_LIMIT", 1), patch.object(fixture.subprocess, "run", return_value=
                subprocess.CompletedProcess([], 0, b"{}", b"")), self.assertRaises(ValueError):
            fixture.command_json(command=["ffprobe"], commands=[])


class BuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.private = self.base / "private"
        self.source = self.base / "real local video with spaces.mp4"
        self.source.write_bytes(b"synthetic local video container")
        self.ffmpeg, self.ffprobe = (self.base / name for name in ("ffmpeg", "ffprobe"))
        for tool in (self.ffmpeg, self.ffprobe):
            tool.write_bytes(b"synthetic executable")
            tool.chmod(0o700)
        self.args = argparse.Namespace(video=self.source, out=self.private / "fixture", start=0, end=1, count=7,
            width=1448, height=1086, parameter="face_adjust_eye", intensity=1, no_face=[],
            ffmpeg=str(self.ffmpeg), ffprobe=str(self.ffprobe), assume_square_pixels=False)
        self.probe_metadata, self.probe_frames = metadata(), decoded()
        self.failure = None
        self.image_size = None
        self.attempt = 0
        private = patch.object(fixture.sequence, "PRIVATE", self.private)
        private.start()
        self.addCleanup(private.stop)
        process = patch.object(fixture.subprocess, "run", side_effect=self.process)
        self.run = process.start()
        self.addCleanup(process.stop)

    def process(self, command, **kwargs):
        if command[0] == str(self.ffprobe):
            value = self.probe_frames if "-show_frames" in command else self.probe_metadata
            return subprocess.CompletedProcess(command, 0, json.dumps(value).encode(), b"")
        if self.failure in ("process", "timeout"):
            Path(command[-1].replace("%02d", "01")).write_bytes(b"partial")
            if self.failure == "timeout":
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            raise subprocess.CalledProcessError(1, command, stderr=b"decode failed")
        count = int(command[command.index("-frames:v") + 1])
        for index in range(count if self.failure != "partial" else count - 1):
            image = Image.new("RGB", self.image_size or (self.args.width, self.args.height), (index * 20, 50, 70))
            image.save(Path(command[-1].replace("%02d", f"{index + 1:02d}")))
        if self.failure == "extra":
            Path(command[-1]).with_name("surprise.png").write_bytes(b"extra")
        if self.failure == "source":
            self.source.write_bytes(b"changed video during extraction")
        return subprocess.CompletedProcess(command, 0, b"", b"")

    def build(self, **changes):
        self.attempt += 1
        self.args.out = self.private / f"fixture-{self.attempt}"
        for key, value in changes.items():
            setattr(self.args, key, value)
        return fixture.build(args=self.args)

    def test_default_seven_frame_manifest_and_hashes_are_renderer_compatible(self):
        report = self.build()
        self.assertTrue(report["passed"], report["failures"])
        self.assertFalse(report["native_runtime_used"])
        self.assertFalse(report["no_face_inferred"])
        path = Path(report["manifest"])
        manifest = json.loads(path.read_text())
        frames = fixture.sequence.validate_manifest(value=manifest, base=path.parent)
        self.assertEqual(len(frames), 7)
        self.assertEqual([row["timestamp"] for row in frames], [0, 0.5, 0.5, 0.5, 1, 1, 1])
        self.assertTrue(all(row["expect_change"] for row in frames))
        for frame, evidence in zip(frames, report["frames"], strict=True):
            self.assertEqual(fixture.hashlib.sha256(Path(frame["image"]).read_bytes()).hexdigest(), evidence["image_sha256"])
            with Image.open(frame["image"]) as image:
                self.assertEqual(image.size, (1448, 1086))
        self.assertEqual(json.loads((path.parent / "source.json").read_text())["sha256"], report["source"]["sha256"])
        self.assertEqual(report["manifest_sha256"], fixture.hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertFalse(list(path.parent.glob("decode-*")))

    def test_ffmpeg_uses_unique_ordinals_scale_pad_no_seek_and_injected_executables(self):
        report = self.build()
        command = report["commands"][-1]
        self.assertEqual(command[0], str(self.ffmpeg))
        self.assertEqual(command[command.index("-frames:v") + 1], "3")
        filters = command[command.index("-vf") + 1]
        self.assertIn("select='eq(n,0)+eq(n,1)+eq(n,2)'", filters)
        self.assertIn("force_original_aspect_ratio=decrease", filters)
        self.assertIn("pad=1448:1086", filters)
        self.assertNotIn("-ss", command)
        self.assertIn("-noautorotate", command)
        self.assertEqual(command[command.index("-i") + 1], str(self.source))
        self.assertEqual(self.run.call_args.kwargs["timeout"], 180)

    def test_missing_sar_default_rejects_and_explicit_assumption_is_audited_before_scale(self):
        self.probe_metadata["streams"][0].pop("sample_aspect_ratio")
        report = self.build()
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["commands"]), 1)
        self.assertNotIn("sample_aspect_ratio", report["source"]["ffprobe_metadata"]["streams"][0])
        report = self.build(assume_square_pixels=True)
        self.assertTrue(report["passed"], report["failures"])
        self.assertEqual(report["sample_aspect_ratio_policy"], "caller-assumption")
        audit = json.loads((Path(report["out"]) / "source.json").read_text())
        self.assertEqual(audit, report["source"])
        self.assertEqual(audit["sample_aspect_ratio"]["raw"], None)
        self.assertTrue(audit["sample_aspect_ratio"]["assumed_square_pixels"])
        command = report["commands"][-1]
        filters = command[command.index("-vf") + 1]
        self.assertIn(",setsar=1,scale=", filters)
        self.assertEqual(filters.count("setsar=1"), 2)
        self.probe_metadata["streams"][0]["sample_aspect_ratio"] = "1:1"
        report = self.build(assume_square_pixels=True)
        self.assertTrue(report["passed"])
        self.assertFalse(report["source"]["sample_aspect_ratio"]["assumed_square_pixels"])
        command = report["commands"][-1]
        self.assertNotIn(",setsar=1,scale=", command[command.index("-vf") + 1])

    def test_opt_in_strict_flag_remote_sources_nonsquare_and_mutation_stay_rejected(self):
        for flag in (1, None, "true"):
            with self.subTest(flag=flag), self.assertRaisesRegex(ValueError, "typed boolean"):
                self.build(assume_square_pixels=flag)
        self.run.assert_not_called()
        with self.assertRaises(ValueError):
            self.build(assume_square_pixels=True, video=Path("https://example.test/video.mp4"))
        self.args.video = self.source
        self.probe_metadata["streams"][0]["sample_aspect_ratio"] = "2:1"
        report = self.build(assume_square_pixels=True)
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["commands"]), 1)
        self.probe_metadata["streams"][0].pop("sample_aspect_ratio")
        self.failure = "source"
        report = self.build(assume_square_pixels=True)
        self.assertFalse(report["passed"])
        self.assertIn("source video changed", report["failures"][0])
        self.assertEqual([path.name for path in Path(report["out"]).iterdir()], ["report.json"])

    def test_zero_and_explicit_no_face_are_the_only_false_expect_change_controls(self):
        report = self.build(intensity=0)
        self.assertTrue(report["passed"])
        self.assertTrue(all(not row["expect_change"] for row in json.loads(Path(report["manifest"]).read_text())["frames"]))
        report = self.build(intensity=-1, no_face=[2, 5], parameter="face_adjust_eye_distance")
        self.assertTrue(report["passed"])
        frames = json.loads(Path(report["manifest"]).read_text())["frames"]
        self.assertEqual([index for index, row in enumerate(frames) if not row["expect_change"]], [2, 5])
        self.assertEqual([index for index, row in enumerate(report["frames"]) if row["no_face_explicit"]], [2, 5])
        self.assertEqual(frames[0]["parameters"], {"face_adjust_eye_distance": [dict(id=-1, intensity=-1)]})

    def test_one_and_24_frames_preserve_repeated_source_timestamp(self):
        for count in (1, 24):
            report = self.build(count=count, start=0.5, end=0.5, no_face=[])
            self.assertTrue(report["passed"], report["failures"])
            self.assertEqual([row["timestamp"] for row in report["frames"]], [0.5] * count)
            self.assertEqual(report["commands"][-1][report["commands"][-1].index("-frames:v") + 1], "1")

    def test_partial_process_failure_extra_images_and_source_mutation_cleanup(self):
        for failure in ("process", "timeout", "partial", "extra", "source"):
            self.failure = failure
            self.source.write_bytes(b"synthetic local video container")
            report = self.build()
            self.assertFalse(report["passed"])
            out = Path(report["out"])
            self.assertEqual([path.name for path in out.iterdir()], ["report.json"])
            self.assertNotIn("manifest", report)

    def test_wrong_image_dimensions_fail_and_remove_already_extracted_files(self):
        self.image_size = (12, 10)
        report = self.build()
        self.assertFalse(report["passed"])
        self.assertIn("same dimensions", report["failures"][0])
        self.assertEqual([path.name for path in Path(report["out"]).iterdir()], ["report.json"])

    def test_source_code_guard_change_fails_without_publishing_manifest(self):
        original = fixture.sequence.file_identity
        calls = {}

        def changed(*, path, limit):
            identity, data = original(path=path, limit=limit)
            calls[path] = calls.get(path, 0) + 1
            if path == Path(fixture.__file__).resolve() and calls[path] == 2:
                identity = dict(identity, sha256="0" * 64)
            return identity, data

        with patch.object(fixture.sequence, "file_identity", side_effect=changed):
            report = self.build()
        self.assertFalse(report["passed"])
        self.assertIn("source/image guard", report["failures"][0])
        self.assertEqual([path.name for path in Path(report["out"]).iterdir()], ["report.json"])

    def test_outside_source_duration_rejects_before_frame_decoding(self):
        report = self.build(start=2, end=2, count=1)
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["commands"]), 1)
        self.assertIn("source video duration", report["failures"][0])

    def test_output_must_be_fresh_private_and_bad_preflight_never_spawns(self):
        for out in (self.base / "outside", self.private):
            self.args.out = out
            with self.subTest(out=out), self.assertRaises(ValueError):
                fixture.build(args=self.args)
        self.args.out = self.private / "already"
        self.args.out.mkdir(parents=True)
        (self.args.out / "keep.txt").write_text("preserve")
        with self.assertRaises(FileExistsError):
            fixture.build(args=self.args)
        self.assertEqual((self.args.out / "keep.txt").read_text(), "preserve")
        self.args.count = True
        with self.assertRaises(ValueError):
            fixture.build(args=self.args)
        self.run.assert_not_called()

    def test_cli_defaults_and_overrides_forward_only_local_options(self):
        with patch.object(fixture.sys, "argv", ["fixture", "--video", str(self.source), "--ffmpeg", str(self.ffmpeg),
                "--ffprobe", str(self.ffprobe), "--no-face", "3"]), patch.object(fixture, "build", return_value=
                dict(passed=True, out="private", failures=[])) as build, patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(fixture.main(), 0)
            args = build.call_args.kwargs["args"]
            self.assertEqual((args.width, args.height, args.count), (1448, 1086, 7))
            self.assertEqual(args.no_face, [3])
            self.assertEqual(args.ffmpeg, str(self.ffmpeg))
            self.assertIs(args.assume_square_pixels, False)
        with patch.object(fixture.sys, "argv", ["fixture", "--video", str(self.source), "--assume-square-pixels"]), \
                patch.object(fixture, "build", return_value=dict(passed=True, out="private", failures=[])) as build, \
                patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(fixture.main(), 0)
            self.assertIs(build.call_args.kwargs["args"].assume_square_pixels, True)


if __name__ == "__main__":
    unittest.main()
