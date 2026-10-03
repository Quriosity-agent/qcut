"""CPU-only full-frame controls and synthetic, locked 26-call diagnostics."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from face_alignment_replay import LockedFiles
import face_full_frame_probe as probe


class BilinearTests(unittest.TestCase):
    def sample(self, *, values, size):
        return probe.bilinear_control(frame=np.asarray(values, np.uint8), size=size)

    def test_identity_preserves_every_rgba_channel_and_source(self):
        frame = np.arange(120, dtype=np.uint8).reshape(5, 6, 4)
        before = frame.copy()
        result = probe.bilinear_control(frame=frame, size=(6, 5))
        np.testing.assert_array_equal(result, frame)
        np.testing.assert_array_equal(frame, before)
        self.assertEqual(result.dtype, np.uint8)
        self.assertFalse(np.shares_memory(result, frame))

    def test_single_pixel_clamps_both_axes_without_premultiplying_alpha(self):
        result = self.sample(values=[[[255, 12, 99, 0]]], size=(7, 5))
        np.testing.assert_array_equal(result, np.tile([255, 12, 99, 0], (5, 7, 1)))

    def test_horizontal_half_center_upscale_and_edge_clamp(self):
        result = self.sample(values=[[[0, 10, 200, 0], [100, 110, 0, 100]]], size=(4, 1))
        np.testing.assert_array_equal(result, [[[0, 10, 200, 0], [25, 35, 150, 25],
                                               [75, 85, 50, 75], [100, 110, 0, 100]]])

    def test_vertical_half_center_upscale_and_edge_clamp(self):
        result = self.sample(values=[[[0, 10, 200, 0]], [[100, 110, 0, 100]]], size=(1, 4))
        np.testing.assert_array_equal(result[:, 0], [[0, 10, 200, 0], [25, 35, 150, 25],
                                                    [75, 85, 50, 75], [100, 110, 0, 100]])

    def test_downscale_samples_quarter_and_three_quarter_centers(self):
        result = self.sample(values=[[[0] * 4, [100] * 4, [200] * 4]], size=(2, 1))
        np.testing.assert_array_equal(result, [[[25] * 4, [175] * 4]])

    def test_two_axis_downscale_averages_four_corners(self):
        values = [[[0, 10, 20, 30], [40, 50, 60, 70]],
                  [[80, 90, 100, 110], [120, 130, 140, 150]]]
        np.testing.assert_array_equal(self.sample(values=values, size=(1, 1)), [[[60, 70, 80, 90]]])

    def test_half_values_round_up_instead_of_bankers_rounding(self):
        result = self.sample(values=[[[0, 2, 254, 100], [1, 3, 255, 101]]], size=(1, 1))
        np.testing.assert_array_equal(result, [[[1, 3, 255, 101]]])

    def test_odd_upscale_has_center_pixel_not_endpoint_interpolation(self):
        result = self.sample(values=[[[0] * 4, [100] * 4]], size=(3, 1))
        np.testing.assert_array_equal(result, [[[0] * 4, [50] * 4, [100] * 4]])

    def test_noncontiguous_and_readonly_arrays_are_sampled_without_mutation(self):
        original = np.arange(192, dtype=np.uint8).reshape(6, 8, 4)
        for frame in (original[::2, ::2], original[::-1, ::-1], np.asfortranarray(original)):
            with self.subTest(strides=frame.strides):
                frame.flags.writeable = False
                before = frame.copy()
                result = probe.bilinear_control(frame=frame, size=(5, 3))
                expected = probe.bilinear_control(frame=frame.copy(), size=(5, 3))
                np.testing.assert_array_equal(result, expected)
                np.testing.assert_array_equal(frame, before)

    def test_target_dimension_limit_is_inclusive_without_large_allocation(self):
        for size in ((4096, 1), (1, 4096)):
            with self.subTest(size=size):
                result = self.sample(values=[[[1, 2, 3, 4]]], size=size)
                self.assertEqual(result.shape, (size[1], size[0], 4))

    def test_target_dimensions_require_bounded_plain_integers(self):
        invalid = (True, False, 1.0, float("nan"), float("inf"), np.int64(1), 0, -1, 4097, 10**100)
        frame = np.zeros((1, 1, 4), np.uint8)
        for value in invalid:
            for size in ((value, 1), (1, value)):
                with self.subTest(size=size), self.assertRaises(ValueError):
                    probe.bilinear_control(frame=frame, size=size)

    def test_target_requires_an_exact_two_item_tuple(self):
        for size in (None, 1, [1, 1], (), (1,), (1, 1, 1), "11", np.array([1, 1])):
            with self.subTest(size=size), self.assertRaises(ValueError):
                probe.bilinear_control(frame=np.zeros((1, 1, 4), np.uint8), size=size)

    def test_frame_dtype_must_be_uint8_even_when_noncontiguous(self):
        for dtype in (np.float32, np.float64, np.int8, np.uint16, np.bool_, object):
            frame = np.zeros((4, 4, 4), dtype=dtype)[::2, ::2]
            with self.subTest(dtype=dtype), self.assertRaises(ValueError):
                probe.bilinear_control(frame=frame, size=(1, 1))

    def test_nonfinite_float_pixels_are_rejected_before_conversion(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.bilinear_control(frame=np.full((1, 1, 4), value), size=(1, 1))

    def test_frame_rank_channels_empty_or_huge_dimensions_are_rejected(self):
        shapes = ((4,), (2, 4), (1, 1, 3), (1, 1, 5), (1, 1, 1, 4),
                  (0, 1, 4), (1, 0, 4), (4097, 1, 4), (1, 4097, 4))
        for shape in shapes:
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                probe.bilinear_control(frame=np.zeros(shape, np.uint8), size=(1, 1))

    def test_lists_none_and_array_subclasses_are_not_accepted(self):
        for frame in (None, [[[1, 2, 3, 4]]], np.ma.array(np.zeros((1, 1, 4), np.uint8))):
            with self.subTest(kind=type(frame)), self.assertRaises(ValueError):
                probe.bilinear_control(frame=frame, size=(1, 1))


class MappingAndExecutorTests(unittest.TestCase):
    def test_twelve_warmup_predictions_map_to_first_input(self):
        self.assertEqual([probe.prediction_frame(index=index) for index in range(12)], [0] * 12)

    def test_seven_manifest_frames_have_two_predictions_each_in_order(self):
        self.assertEqual([probe.prediction_frame(index=index) for index in range(12, 26)],
                         [index for index in range(7) for _ in range(2)])

    def test_prediction_index_rejects_noninteger_and_out_of_profile_values(self):
        for index in (True, False, 0.0, 25.0, float("nan"), np.int64(0), -1, 26, 10**100, None, "0"):
            with self.subTest(index=index), self.assertRaises(ValueError):
                probe.prediction_frame(index=index)

    def test_executor_uses_bounded_checked_subprocess_without_shell(self):
        command = ["synthetic sampler", "input with spaces.rgba"]
        result = subprocess.CompletedProcess(command, 0, "诊断".encode(), b"stderr")
        with patch.object(probe.subprocess, "run", return_value=result) as execute:
            self.assertEqual(probe.execute(command=command),
                             dict(command=command, stdout="诊断", stderr="stderr", returncode=0))
        execute.assert_called_once_with(command, capture_output=True, timeout=120, check=True)

    def test_executor_accepts_exact_combined_log_bound(self):
        result = subprocess.CompletedProcess(["synthetic"], 0, b"abc", b"12345")
        with patch.object(probe.sequence, "LOG_LIMIT", 8), patch.object(probe.subprocess, "run", return_value=result):
            self.assertEqual(probe.execute(command=result.args)["stderr"], "12345")

    def test_executor_rejects_combined_stdout_stderr_over_bound(self):
        result = subprocess.CompletedProcess(["synthetic"], 0, b"abcd", b"12345")
        with patch.object(probe.sequence, "LOG_LIMIT", 8), patch.object(probe.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, "log exceeds bound"):
                probe.execute(command=result.args)

    def test_executor_propagates_timeout_checked_failure_and_invalid_utf8(self):
        for error in (subprocess.TimeoutExpired(["synthetic"], 120),
                      subprocess.CalledProcessError(1, ["synthetic"], output=b"failed")):
            with self.subTest(error=type(error)), patch.object(probe.subprocess, "run", side_effect=error):
                with self.assertRaises(type(error)):
                    probe.execute(command=["synthetic"])
        result = subprocess.CompletedProcess(["synthetic"], 0, b"\xff", b"")
        with patch.object(probe.subprocess, "run", return_value=result), self.assertRaises(UnicodeDecodeError):
            probe.execute(command=result.args)


class ProbeRunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name).resolve()
        cls.capture = cls.root / "capture"
        cls.capture.mkdir()
        (cls.capture / "geometry").mkdir()
        (cls.capture / "report.json").write_bytes(b'{"synthetic":true}\n')
        cls.frames, cls.descriptors, cls.buffers = [], [], []
        for index in range(7):
            pixel = bytes((1 + index * 10, 20 + index, 40 + index, 180 + index))
            data = pixel * (1448 * 1086)
            path = cls.capture / f"input-{index:02d}.rgba"
            path.write_bytes(data)
            cls.frames.append(dict(input=path))
            cls.buffers.append(np.frombuffer(pixel * (640 * 480), np.uint8).reshape(480, 640, 4))
        for index in range(26):
            frame = 0 if index < 12 else (index - 12) // 2
            data = cls.buffers[frame].tobytes()
            name = f"frame-{index}.rgba"
            (cls.capture / "geometry" / name).write_bytes(data)
            cls.descriptors.append(dict(prediction=index, file=name, bytes=len(data),
                                        sha256=hashlib.sha256(data).hexdigest()))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name).resolve()
        self.args = argparse.Namespace(capture=self.capture, out=self.out)
        self.locked = LockedFiles()
        self.context = dict(root=self.capture, frames=deepcopy(self.frames),
                            snapshots=[dict(index=index, request=[0, 640, 480, 2560, 0]) for index in range(26)],
                            evidence=dict(algorithm_frames=deepcopy(self.descriptors)))
        self.exact_modes, self.bad_frames = {2}, {}
        self.addCleanup(patch.stopall)
        self.real_load = probe.capture.load
        patch.object(probe, "LockedFiles", return_value=self.locked).start()
        self.fresh = patch.object(probe.sequence, "fresh_output", return_value=self.out).start()
        self.load = patch.object(probe.capture, "load", side_effect=self.load_context).start()
        self.sources = patch.object(probe, "sources", return_value={name: "a" * 64 for name in probe.SOURCE_NAMES}).start()
        self.sampler = patch.object(probe, "execute", side_effect=self.execute).start()
        self.control = patch.object(probe, "bilinear_control", side_effect=self.control_frame).start()
        self.metrics = patch.object(probe, "frame_metrics", side_effect=self.measure).start()
        self.visual = patch.object(probe, "visual").start()

    def load_context(self, *, root, locked):
        self.assertEqual(root, self.capture)
        locked.read(path=root / "report.json")
        return self.context

    def control_frame(self, *, frame, size):
        self.assertEqual((frame.shape, frame.dtype, size), ((1086, 1448, 4), np.dtype("uint8"), (640, 480)))
        index = (int(frame[0, 0, 0]) - 1) // 10
        return self.buffers[index].copy()

    def execute(self, *, command):
        if command[0] == "xcrun":
            Path(command[-1]).write_bytes(b"synthetic sampler, never executed")
        else:
            self.assertEqual(command[3:7], ["1448", "1086", "640", "480"])
            frame_index = next(index for index, frame in enumerate(self.frames) if str(frame["input"]) == command[1])
            mode = int(command[-1])
            candidate = self.buffers[frame_index].copy()
            if mode not in self.exact_modes or frame_index in self.bad_frames.get(mode, set()):
                candidate[0, 0, 0] += 1
            Path(command[2]).write_bytes(candidate.tobytes())
        return dict(command=command, stdout="synthetic CPU fixture", stderr="", returncode=0)

    def measure(self, *, actual, reference, width, height):
        self.assertEqual((width, height, len(actual), len(reference)), (640, 480, 640 * 480 * 4, 640 * 480 * 4))
        equal = actual == reference
        if not equal:
            self.assertEqual(actual[4:], reference[4:])
        delta = max(abs(a - b) for a, b in zip(actual[:4], reference[:4], strict=True))
        return dict(equal=equal, changed_pixels=0 if equal else 1, max_delta=delta,
                    bbox=None if equal else [0, 0, 1, 1], sha256=hashlib.sha256(actual).hexdigest())

    def saved(self):
        return json.loads((self.out / "report.json").read_bytes())

    def failed(self, *, error=ValueError, message=None):
        self.locked.files.clear()
        self.locked.identities.clear()
        with self.assertRaises(error) as caught:
            probe.run(args=self.args)
        if message is not None:
            self.assertIn(message, str(caught.exception))
        report = self.saved()
        for key in ("passed", "completed", "sampling_parity", "product_parity_verified", "arbitrary_frame_backend_connected"):
            self.assertIs(report[key], False)
        self.assertTrue(report["failures"])
        return report

    def test_completed_diagnostic_does_not_claim_live_neural_or_product_backend(self):
        report = probe.run(args=self.args)
        self.assertEqual(report, self.saved())
        for key in ("passed", "completed", "diagnostic_only", "sampling_parity"):
            self.assertIs(report[key], True)
        for key in ("captured_pixel_input_used", "native_library_loaded_by_sampler",
                    "arbitrary_frame_backend_connected", "product_parity_verified", "native_algorithm_rgba_required"):
            self.assertIs(report[key], False)
        self.assertEqual(report["profile"], "full-frame-algorithm-input-diagnostic-v1")
        self.assertEqual(report["exact_modes"], [probe.MODES[2]])
        self.assertEqual(len(report["runs"]), 36)
        self.assertEqual(len(report["cases"]), 26)
        self.assertEqual(self.control.call_count, 7)
        self.assertEqual(self.metrics.call_count, 26 * 6)
        self.load.assert_called_once_with(root=self.capture, locked=self.locked)
        self.sources.assert_called_once_with(names=probe.SOURCE_NAMES, locked=self.locked)

    def test_every_prediction_maps_to_correct_original_frame_without_oracle_fallback(self):
        report = probe.run(args=self.args)
        for index, row in enumerate(report["cases"]):
            frame = 0 if index < 12 else (index - 12) // 2
            self.assertEqual((row["prediction"], row["frame_index"]), (index, frame))
            self.assertEqual(row["input_rgba_sha256"], self.locked.files[str(self.frames[frame]["input"])])
            self.assertEqual(row["reference_sha256"], self.descriptors[index]["sha256"])
            self.assertTrue(row["checks"]["cpu-bilinear-control"]["equal"])
            self.assertEqual(row["checks"][probe.MODES[0]]["changed_pixels"], 1)
        self.assertEqual([call.kwargs["path"].name for call in self.visual.call_args_list],
                         [f"frame-{index:02d}-{name}.png" for index in range(7)
                          for name in ("cpu-bilinear-control", *probe.MODES.values())])

    def test_completed_without_any_metal_parity_keeps_native_algorithm_requirement(self):
        self.exact_modes = set()
        report = probe.run(args=self.args)
        self.assertIs(report["passed"], True)
        self.assertIs(report["completed"], True)
        self.assertIs(report["sampling_parity"], False)
        self.assertIs(report["native_algorithm_rgba_required"], True)
        self.assertEqual(report["exact_modes"], [])
        self.assertTrue(all(row["checks"]["cpu-bilinear-control"]["equal"] for row in report["cases"]))

    def test_one_bad_frame_revokes_mode_parity_instead_of_cherry_picking_frames(self):
        self.bad_frames = {2: {6}}
        report = probe.run(args=self.args)
        self.assertEqual(report["exact_modes"], [])
        self.assertIs(report["sampling_parity"], False)
        self.assertIs(report["completed"], True)
        self.assertEqual([row["prediction"] for row in report["cases"] if not row["checks"][probe.MODES[2]]["equal"]], [24, 25])

    def test_compile_failure_saves_error_without_sampling_or_visual_fallback(self):
        self.sampler.side_effect = subprocess.CalledProcessError(1, ["synthetic compiler"])
        self.failed(error=subprocess.CalledProcessError)
        self.control.assert_not_called()
        self.visual.assert_not_called()

    def test_sampler_timeout_does_not_compare_partial_or_native_fallback_outputs(self):
        original = self.sampler.side_effect
        def execute(*, command):
            if command[0] != "xcrun":
                raise subprocess.TimeoutExpired(command, 120)
            return original(command=command)
        self.sampler.side_effect = execute
        self.failed(error=subprocess.TimeoutExpired)
        self.metrics.assert_not_called()
        self.visual.assert_not_called()

    def test_rejected_capture_profile_stops_before_compilation(self):
        self.load.side_effect = ValueError("actual preprocessing capture required")
        self.failed(message="actual preprocessing capture required")
        self.sampler.assert_not_called()
        self.control.assert_not_called()

    def test_real_capture_loader_rejects_false_neutral_profile_claim(self):
        invalid = self.out / "invalid-capture"
        invalid.mkdir()
        (invalid / "report.json").write_text(json.dumps(dict(passed=True, diagnostic_only=False,
            observer_pixel_parity_verified=True, native_analysis_bypassed=False, old_sources_verified=50)))
        self.args.capture = invalid
        self.load.side_effect = self.real_load
        self.failed(message="neutral preprocessing capture")
        self.sampler.assert_not_called()

    def test_invalid_native_requests_reject_format_orientation_stride_and_dimensions(self):
        for request in ([1, 640, 480, 2560, 0], [0, 640, 480, 2560, 1], [0, 640, 480, 2559, 0],
                        [0, 641, 480, 2564, 0], [0, 640, 481, 2560, 0], [0, 640, 480], None):
            with self.subTest(request=request):
                self.context["snapshots"][0]["request"] = request
                self.failed(message="unrotated packed algorithm profile")

    def test_native_request_rejects_boolean_and_float_values_that_compare_equal(self):
        for request in ([False, 640, 480, 2560, 0], [0, 640.0, 480, 2560, 0]):
            with self.subTest(request=request):
                self.context["snapshots"][0]["request"] = request
                self.failed()

    def test_reference_descriptor_rejects_wrong_dimensions_identity_and_digest(self):
        for key, value in (("bytes", 639 * 480 * 4), ("prediction", False),
                           ("file", "frame-1.rgba"), ("sha256", "b" * 64)):
            original = self.context["evidence"]["algorithm_frames"][0][key]
            with self.subTest(key=key):
                self.context["evidence"]["algorithm_frames"][0][key] = value
                self.failed()
            self.context["evidence"]["algorithm_frames"][0][key] = original

    def test_snapshot_descriptor_count_mismatch_is_not_silently_truncated(self):
        self.context["evidence"]["algorithm_frames"].pop()
        self.failed()

    def test_empty_profile_does_not_vacuously_pass_all_modes(self):
        self.context["snapshots"] = []
        self.context["evidence"]["algorithm_frames"] = []
        self.failed()

    def test_partial_prediction_profile_is_not_full_fixed_profile_parity(self):
        self.context["snapshots"] = self.context["snapshots"][:-1]
        self.context["evidence"]["algorithm_frames"] = self.context["evidence"]["algorithm_frames"][:-1]
        self.failed()

    def test_truncated_original_rgba_is_rejected_before_cpu_control(self):
        path = self.out / "truncated.rgba"
        path.write_bytes(b"short RGBA")
        self.context["frames"][0]["input"] = path
        self.failed(message="full-frame RGBA byte count")
        self.control.assert_not_called()

    def test_truncated_sampler_output_is_rejected_before_metrics(self):
        original = self.sampler.side_effect
        def execute(*, command):
            result = original(command=command)
            if command[0] != "xcrun":
                Path(command[2]).write_bytes(b"short RGBA")
            return result
        self.sampler.side_effect = execute
        self.failed(message="sampler output byte count")
        self.metrics.assert_not_called()

    def test_final_guard_failure_revokes_completion_and_sampling_parity(self):
        original = self.visual.side_effect
        def mutate(*, reference, candidate, path, label):
            if original is not None:
                original(reference=reference, candidate=candidate, path=path, label=label)
            (self.out / "sampler").write_bytes(b"mutated sampler")
        self.visual.side_effect = mutate
        report = self.failed(message="hash mismatch")
        self.assertEqual(report["exact_modes"], [])
        self.assertIs(report["native_algorithm_rgba_required"], True)

    def test_single_final_guard_failure_is_not_cleared_by_a_successful_second_check(self):
        with patch.object(self.locked, "verify", side_effect=[ValueError("first final guard failed"), None]):
            report = self.failed(message="first final guard failed")
        self.assertEqual(report["exact_modes"], [])
        self.assertIs(report["native_algorithm_rgba_required"], True)

    def test_primary_error_survives_guard_error_and_records_both(self):
        self.sampler.side_effect = RuntimeError("original compiler failure")
        with patch.object(self.locked, "verify", side_effect=ValueError("final guard failure")):
            report = self.failed(error=RuntimeError, message="original compiler failure")
        self.assertEqual(report["failures"], ["RuntimeError: original compiler failure", "guard ValueError: final guard failure"])

    def test_visual_failure_is_saved_without_success_or_backend_claim(self):
        self.visual.side_effect = OSError("cannot write comparison")
        self.failed(error=OSError, message="cannot write comparison")


class VisualTests(unittest.TestCase):
    def test_grayscale_uses_all_channels_fixed_gain_saturation_and_zero_difference(self):
        reference = np.zeros((1, 3, 4), np.uint8)
        candidate = reference.copy()
        candidate[0, 1, 3], candidate[0, 2, 0] = 3, 255
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "difference.png"
            probe.visual(reference=reference, candidate=candidate, path=path, label="Synthetic candidate")
            with Image.open(path) as image:
                self.assertEqual((image.mode, image.size), ("RGB", (1920, 510)))
                self.assertEqual([image.getpixel((1280 + index, 30)) for index in range(3)],
                                 [(0, 0, 0), (24, 24, 24), (255, 255, 255)])
        np.testing.assert_array_equal(reference, np.zeros((1, 3, 4), np.uint8))


if __name__ == "__main__":
    unittest.main()
