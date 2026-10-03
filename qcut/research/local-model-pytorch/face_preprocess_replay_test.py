"""Synthetic independent preprocessing controls; no native runtime or captures."""
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import io
import json
import math
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

import face_preprocess_replay as replay


def observed_call(*, rect=None, flags=None):
    return dict(format=0, orientation=0, target=[160, 160],
                flags=[0, 0, 0] if flags is None else flags,
                rect={"values": [0, 0, 4, 4] if rect is None else rect},
                expansion=1)


def rgba(*, height=4, width=4):
    y, x = np.indices((height, width))
    return np.stack(((x * 11 + y * 3) % 256, (x + y * 17 + 37) % 256,
                     (x * 5 + y * 7 + 101) % 256, (x + y) % 256), axis=-1).astype(np.uint8)


def linear_pixel(*, pixels, row, column):
    def axis(*, index, size):
        coordinate = (index + .5) * (size / 160) - .5
        low = math.floor(coordinate)
        weight = round((0 if coordinate < 0 else coordinate - low) * 128)
        return min(max(low, 0), size - 1), min(max(low + 1, 0), size - 1), weight
    y0, y1, fy = axis(index=row, size=pixels.shape[0])
    x0, x1, fx = axis(index=column, size=pixels.shape[1])
    rows = [((pixels[y, x0].astype(np.int64) * (128 - fx)
              + pixels[y, x1].astype(np.int64) * fx) // 128) for y in (y0, y1)]
    return ((rows[0] * (128 - fy) + rows[1] * fy) // 128).astype(np.uint8)


class PrepareTests(unittest.TestCase):
    def reject(self, *, frame=None, call=None):
        with self.assertRaises(ValueError):
            replay.prepare(frame=rgba() if frame is None else frame,
                           call=observed_call() if call is None else call)

    def test_identity_rgba_to_bgr_and_exact_signed_endpoints(self):
        frame = rgba(height=160, width=160)
        frame[0, :4] = [[0, 127, 128, 11], [255, 128, 127, 22],
                        [128, 255, 0, 33], [127, 0, 255, 44]]
        result = replay.prepare(frame=frame, call=observed_call(rect=[0, 0, 160, 160]))
        expected = frame[:, :, [2, 1, 0]]
        for stage in ("source", "crop", "resized"):
            np.testing.assert_array_equal(result[stage], expected)
            self.assertEqual(result[stage].dtype, np.uint8)
        self.assertEqual(result["resize"], "nearest")
        self.assertEqual(result["post_crop_rect"], [0, 0, 160, 160])
        self.assertEqual(result["tensor"].shape, (1, 160, 160, 3))
        self.assertEqual(result["tensor"].dtype, np.int8)
        np.testing.assert_array_equal(result["tensor"], (expected.astype(np.int16) - 128)[None])
        np.testing.assert_array_equal(result["tensor"][0, 0, :4],
                                      [[0, -1, -128], [-1, 0, 127],
                                       [-128, 127, 0], [127, -128, -1]])

    def test_alpha_never_changes_pixels_or_tensor(self):
        frame = rgba()
        before = replay.prepare(frame=frame, call=observed_call())
        frame[:, :, 3] ^= 255
        after = replay.prepare(frame=frame, call=observed_call())
        for stage in ("source", "crop", "resized", "tensor"):
            np.testing.assert_array_equal(before[stage], after[stage])

    def test_frame_shape_dtype_and_budget_gates(self):
        invalid = [None, [], np.zeros((4, 4), np.uint8), np.zeros((1, 4, 4, 4), np.uint8),
                   np.zeros((4, 4, 3), np.uint8), np.zeros((4, 4, 5), np.uint8),
                   np.zeros((0, 4, 4), np.uint8), np.zeros((4, 0, 4), np.uint8),
                   np.zeros((4097, 1, 4), np.uint8), np.zeros((1, 4097, 4), np.uint8),
                   rgba().astype(np.float32), rgba().astype(np.int8), rgba().astype(np.uint16),
                   np.broadcast_to(np.zeros((1, 1, 4), np.uint8), (2049, 2048, 4))]
        for index, frame in enumerate(invalid):
            with self.subTest(index=index), self.assertRaises(ValueError):
                replay.prepare(frame=frame, call=observed_call())

    def test_call_requires_dictionary(self):
        for call in (None, [], "observed", 0):
            with self.subTest(call=call), self.assertRaises(ValueError):
                replay.prepare(frame=rgba(), call=call)

    def test_minimum_and_maximum_frame_sides_are_accepted(self):
        for height, width in ((1, 1), (1, 4096), (4096, 1)):
            with self.subTest(height=height, width=width):
                frame = rgba(height=height, width=width)
                result = replay.prepare(frame=frame, call=observed_call(rect=[0, 0, 1, 1], flags=[1, 0, 0]))
                np.testing.assert_array_equal(result["resized"], np.broadcast_to(frame[0, 0, [2, 1, 0]], (160, 160, 3)))

    def test_format_and_orientation_require_observed_typed_zero(self):
        for field in ("format", "orientation"):
            for value in (None, False, True, 0.0, 1, -1, "0", np.int64(0)):
                call = observed_call()
                call[field] = value
                with self.subTest(field=field, value=value):
                    self.reject(call=call)
            call = observed_call()
            call.pop(field)
            self.reject(call=call)

    def test_target_requires_exact_160_integer_list(self):
        for target in (None, [], [160], [160, 160, 3], [120, 120], [160, 120],
                       (160, 160), ["160", "160"], [160.0, 160.0], [np.int64(160), 160]):
            call = observed_call()
            call["target"] = target
            with self.subTest(target=target):
                self.reject(call=call)

    def test_flags_require_three_integer_bits_and_verified_allocator(self):
        invalid = [None, (), (0, 0, 0), [], [0, 0], [0, 0, 0, 0], [0, 0, 1]]
        invalid.extend([([0, 0, 0][:index] + [value] + [0, 0, 0][index + 1:])
                        for index in range(3) for value in (False, True, 0.0, "0", -1, 2, np.int32(0))])
        for flags in invalid:
            call = observed_call()
            call["flags"] = flags
            with self.subTest(flags=flags):
                self.reject(call=call)

    def test_expansion_requires_finite_positive_bounded_real(self):
        for value in (None, False, True, "1", 0, -1, 4.001, np.float32(1),
                      float("nan"), float("inf"), -float("inf"), 1e-30):
            call = observed_call()
            call["expansion"] = value
            with self.subTest(expansion=value):
                self.reject(call=call)
        for value in (.25, 1, 1.5, 4):
            call = observed_call()
            call["expansion"] = value
            with self.subTest(expansion=value):
                self.assertEqual(replay.prepare(frame=rgba(), call=call)["crop"].shape[0],
                                 math.floor(4 * value + .5))

    def test_rect_requires_observed_four_value_list_not_inverse(self):
        for rect in (None, [], {}, {"values": (0, 0, 4, 4)}, {"values": [0, 0, 4]},
                     {"values": [0, 0, 4, 4, 0]}, {"inverse": [[1, 0, 0], [0, 1, 0]]}):
            call = observed_call()
            call["rect"] = rect
            with self.subTest(rect=rect):
                self.reject(call=call)

    def test_rect_rejects_nonfinite_and_nonreal_values_in_every_coordinate(self):
        for index in range(4):
            for value in (None, False, True, "4", np.float32(4), float("nan"),
                          float("inf"), -float("inf")):
                rect = [0, 0, 4, 4]
                rect[index] = value
                with self.subTest(index=index, value=value):
                    self.reject(call=observed_call(rect=rect))

    def test_rect_rejects_invalid_sides_and_no_image_intersection(self):
        for rect in ([0, 0, 0, 4], [0, 0, 4, .99], [0, 0, -1, 4],
                     [4, 0, 4, 4], [0, 4, 4, 4], [-5, 0, 4, 4], [0, -5, 4, 4]):
            with self.subTest(rect=rect):
                self.reject(call=observed_call(rect=rect))

    def test_generated_crop_budget_rejected_before_allocation(self):
        with patch.object(replay, "crop_pixels") as crop, patch.object(replay, "resize_candidates") as resize:
            self.reject(call=observed_call(rect=[0, 0, 2365, 2365]))
            crop.assert_not_called()
            resize.assert_not_called()

    def test_black_padding_and_signed_black_are_exact(self):
        frame = rgba()
        call = observed_call(rect=[-1, -1, 4, 4])
        call["expansion"] = 2
        result = replay.prepare(frame=frame, call=call)
        expected = np.zeros((8, 8, 3), np.uint8)
        expected[2:6, 2:6] = frame[:, :, [2, 1, 0]]
        self.assertEqual(result["post_crop_rect"], [-2, -2, 8, 8])
        np.testing.assert_array_equal(result["crop"], expected)
        np.testing.assert_array_equal(result["tensor"][0, 0, 0], [-128, -128, -128])

    def test_origins_truncate_toward_zero_sides_round_half_up(self):
        cases = [([-.75, -.75, 4, 4], 1, [0, 0, 4, 4]),
                 ([-1.75, -1.75, 4, 4], 1, [-1, -1, 4, 4]),
                 ([.75, .75, 4.5, 4.5], 1, [1, 1, 5, 5]),
                 ([2.25, 3.75, 4.5, 6.5], 1, [1, 4, 7, 7]),
                 ([1, 2, 4, 6], 1.5, [-1, 1, 9, 9])]
        for rect, expansion, expected in cases:
            call = observed_call(rect=rect)
            call["expansion"] = expansion
            with self.subTest(rect=rect, expansion=expansion):
                result = replay.prepare(frame=rgba(height=20, width=20), call=call)
                self.assertEqual(result["post_crop_rect"], expected)

    def test_legacy_anchor_landscape_portrait_and_boundary_branches(self):
        cases = [([2, 3, 6, 4], 20, 20, [2, 1, 6, 6]),
                 ([2, 3, 4, 6], 20, 20, [0, 3, 6, 6]),
                 ([2, 6, 6, 2], 8, 20, [2, 6, 6, 6]),
                 ([6, 2, 2, 6], 20, 8, [6, 2, 6, 6])]
        for rect, height, width, expected in cases:
            with self.subTest(rect=rect):
                result = replay.prepare(frame=rgba(height=height, width=width),
                                        call=observed_call(rect=rect, flags=[0, 1, 0]))
                self.assertEqual(result["post_crop_rect"], expected)

    def test_nearest_upscale_and_downscale_exact_sampling(self):
        for size in (2, 320):
            with self.subTest(size=size):
                frame = rgba(height=size, width=size)
                result = replay.prepare(frame=frame, call=observed_call(rect=[0, 0, size, size]))
                expected = (np.repeat(np.repeat(frame[:, :, [2, 1, 0]], 80, axis=0), 80, axis=1)
                            if size == 2 else frame[::2, ::2, [2, 1, 0]])
                np.testing.assert_array_equal(result["resized"], expected)

    def test_linear_upscale_7bit_weights_and_two_truncations(self):
        frame = np.zeros((2, 2, 4), np.uint8)
        frame[:, :, :3] = np.array([[0, 1], [2, 4]], np.uint8)[:, :, None]
        result = replay.prepare(frame=frame, call=observed_call(rect=[0, 0, 2, 2], flags=[1, 0, 0]))
        self.assertEqual(result["resize"], "linear")
        for row, column in ((0, 0), (0, 159), (159, 0), (159, 159), (64, 64), (89, 97), (80, 80)):
            with self.subTest(row=row, column=column):
                np.testing.assert_array_equal(result["resized"][row, column],
                                              linear_pixel(pixels=result["crop"], row=row, column=column))
        np.testing.assert_array_equal(result["resized"][64, 64], [0, 0, 0])
        nearest = replay.prepare(frame=frame, call=observed_call(rect=[0, 0, 2, 2]))
        self.assertFalse(np.array_equal(result["resized"], nearest["resized"]))

    def test_resize_switch_only_below_target_with_upscale_enabled(self):
        for size, flag, expected in ((159, 0, "nearest"), (159, 1, "linear"),
                                     (160, 1, "nearest"), (161, 1, "nearest")):
            with self.subTest(size=size, flag=flag):
                result = replay.prepare(frame=rgba(height=size, width=size),
                                        call=observed_call(rect=[0, 0, size, size], flags=[flag, 0, 0]))
                self.assertEqual(result["resize"], expected)

    def test_noncontiguous_readonly_frames_have_isolated_writable_outputs(self):
        backing = rgba(height=8, width=8)
        for frame in (backing[::2, ::2], backing[::-2, ::-2], backing.transpose(1, 0, 2)[::2, ::2]):
            with self.subTest(strides=frame.strides):
                frame.setflags(write=False)
                call = observed_call()
                before_frame, before_call = backing.copy(), deepcopy(call)
                result = replay.prepare(frame=frame, call=call)
                np.testing.assert_array_equal(result["source"], frame[:, :, [2, 1, 0]])
                for stage in ("source", "crop", "resized", "tensor"):
                    output = result[stage]
                    self.assertTrue(output.flags.c_contiguous and output.flags.writeable)
                    self.assertFalse(np.shares_memory(output, backing))
                    for other in ("source", "crop", "resized", "tensor"):
                        if other != stage:
                            self.assertFalse(np.shares_memory(output, result[other]))
                    output.flat[0] = 12
                np.testing.assert_array_equal(backing, before_frame)
                self.assertEqual(call, before_call)
                result["post_crop_rect"][0] = 123
                self.assertEqual(call, before_call)


class OracleBlobTests(unittest.TestCase):
    def read(self, *, data=bytes(range(6)), fields=None, prediction=2, stage="crop", declared_size=None):
        row = dict(file="prediction-02-crop.bgr", rows=1, cols=2,
                   sha256=hashlib.sha256(data).hexdigest())
        row.update(fields or {})
        stat = SimpleNamespace(st_dev=1, st_ino=2,
                               st_size=len(data) if declared_size is None else declared_size, st_mtime_ns=3)
        path = Path("/synthetic/capture/trace") / row["file"]
        locked = replay.LockedFiles()
        with patch.object(Path, "resolve", return_value=path), patch.object(Path, "stat", return_value=stat), \
                patch.object(Path, "is_file", return_value=True), \
                patch.object(Path, "open", side_effect=lambda *args, **kwargs: io.BytesIO(data)):
            result = replay.oracle_blob(capture_dir=Path("/synthetic/capture"), prediction=prediction,
                                        stage=stage, row=row, locked=locked)
            locked.verify()
        return result, locked

    def test_exact_blob_shape_dtype_channel_order_and_lock(self):
        result, locked = self.read()
        np.testing.assert_array_equal(result, [[[0, 1, 2], [3, 4, 5]]])
        self.assertEqual(result.dtype, np.uint8)
        self.assertEqual(len(locked.files), 1)
        self.assertEqual(next(iter(locked.files.values())), hashlib.sha256(bytes(range(6))).hexdigest())

    def test_prediction_stage_and_path_association_before_read(self):
        for filename in ("prediction-03-crop.bgr", "prediction-02-source.bgr",
                         "../prediction-02-crop.bgr", "/tmp/prediction-02-crop.bgr", None):
            locked = Mock()
            with self.subTest(filename=filename), self.assertRaisesRegex(ValueError, "prediction/stage"):
                replay.oracle_blob(capture_dir=Path("/synthetic"), prediction=2, stage="crop",
                                   row={"file": filename}, locked=locked)
            locked.read.assert_not_called()

    def test_each_comparison_stage_uses_its_exact_blob(self):
        for stage in ("source", "crop", "resized"):
            with self.subTest(stage=stage):
                result, _ = self.read(stage=stage, fields={"file": f"prediction-02-{stage}.bgr"})
                self.assertEqual(result.shape, (1, 2, 3))

    def test_hash_mismatch_and_malformed_hash_fail_closed(self):
        for expected in ("0" * 64, "ABCDEF" * 11, "", 123, "x" * 64):
            with self.subTest(expected=expected), self.assertRaisesRegex(ValueError, "hash"):
                self.read(fields={"sha256": expected})

    def test_missing_hash_must_not_disable_oracle_lock(self):
        with self.assertRaises(ValueError):
            self.read(fields={"sha256": None})

    def test_blob_size_must_equal_declared_rows_columns_channels(self):
        for fields in ({"rows": 2}, {"cols": 1}, {"rows": 0}, {"cols": 0}):
            with self.subTest(fields=fields), self.assertRaisesRegex(ValueError, "dimensions mismatch"):
                self.read(fields=fields)

    def test_read_is_bounded_and_uses_expected_hash(self):
        locked = Mock()
        locked.read.return_value = bytes(range(6))
        row = dict(file="prediction-02-crop.bgr", rows=1, cols=2, sha256="a" * 64)
        replay.oracle_blob(capture_dir=Path("/synthetic/capture"), prediction=2,
                           stage="crop", row=row, locked=locked)
        locked.read.assert_called_once_with(path=Path("/synthetic/capture/trace/prediction-02-crop.bgr"),
                                            maximum=16 * 1024**2, expected="a" * 64)

    def test_real_locked_read_rejects_empty_and_oversized_blob(self):
        for size in (0, 16 * 1024**2 + 1):
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, "oversized fixture"):
                self.read(declared_size=size)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.root, self.out = Path("/synthetic/capture"), Path("/synthetic/replay-output")
        self.args = SimpleNamespace(capture=self.root, out=self.out)
        self.frame = rgba()
        self.expected = replay.prepare(frame=self.frame, call=observed_call())
        self.blobs, self.cases, inputs = {}, [], []
        for prediction in (0, 20):
            self.blobs[self.root / "geometry" / f"frame-{prediction}.rgba"] = self.frame.tobytes()
            event = dict(call=observed_call(), network=9,
                         post_crop_rect={"values": self.expected["post_crop_rect"]})
            for stage in ("source", "crop", "resized"):
                pixels = self.expected[stage]
                name = f"prediction-{prediction:02d}-{stage}.bgr"
                self.blobs[self.root / "trace" / name] = pixels.tobytes()
                event[stage] = dict(file=name, rows=pixels.shape[0], cols=pixels.shape[1],
                                   sha256=hashlib.sha256(pixels.tobytes()).hexdigest())
            tensor_path = Path(f"/synthetic/tensor-{prediction}.bin")
            self.blobs[tensor_path] = self.expected["tensor"].tobytes()
            inputs.append(dict(name="data", inference=prediction + 7, raw=[1, 6], dims_nwhc=[1, 160, 160, 3],
                               path=str(tensor_path), sha256=hashlib.sha256(self.blobs[tensor_path]).hexdigest()))
            self.cases.append(dict(prediction=prediction, face_id=prediction + 11, inference=prediction + 7, event=event))
        self.event, self.tensor_row = self.cases[0]["event"], inputs[0]
        self.evidence = dict(passed=True, diagnostic_only=True, observer_pixel_parity_verified=True,
                             fixture_sha256={}, geometry_snapshots=[], trace={}, prediction_inferences=[],
                             algorithm_frames=[dict(prediction=i, file=f"frame-{i}.rgba",
                                                    sha256=hashlib.sha256(self.frame.tobytes()).hexdigest())
                                               for i in range(26)],
                             captures={"networks": {"9": {"inputs": inputs}}})
        self.records = [dict(request=[0, 4, 4, 16, 0]) for _ in range(26)]
        self.locked = Mock(files={})
        self.locked.json.return_value = self.evidence
        self.locked.read.side_effect = self.read
        stack = ExitStack()
        self.addCleanup(stack.close)
        for target, fields in ((replay.sequence, {"fresh_output": Mock(return_value=self.out)}),
                               (replay, {"LockedFiles": Mock(return_value=self.locked),
                                         "validate_sequence": Mock(return_value=self.records)}),
                               (replay.capture, {"validate_trace": Mock(return_value=self.cases)})):
            stack.enter_context(patch.multiple(target, **fields))
        stack.enter_context(patch.object(Path, "resolve", return_value=self.root))
        stack.enter_context(patch.object(replay.Image, "fromarray", return_value=Mock()))
        stack.enter_context(patch("ctypes.CDLL", side_effect=AssertionError("native runtime forbidden")))
        stack.enter_context(patch("subprocess.Popen", side_effect=AssertionError("native process forbidden")))
        self.writer = stack.enter_context(patch.object(Path, "write_text"))
        self.producer = stack.enter_context(patch.object(replay, "prepare", wraps=replay.prepare))

    def read(self, *, path, maximum=32 * 1024**2, expected=None):
        if path == self.root / "report.json":
            return b"synthetic report"
        if path.name in replay.SOURCE_NAMES:
            return b"synthetic source lock"
        data = self.blobs[path]
        if len(data) > maximum or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("synthetic bounded hash mismatch")
        if "trace" in path.parts or path.suffix == ".bin":
            self.assertEqual(self.producer.call_count, 2 if "-20" in path.name else 1)
        return data

    def written_report(self):
        self.writer.assert_called_once()
        self.locked.verify.assert_called_once()
        return json.loads(self.writer.call_args.args[0])

    def test_success_only_claims_diagnostic_comparison(self):
        report = replay.run(args=self.args)
        self.assertTrue(report["passed"])
        self.assertTrue(report["diagnostic_only"])
        for field in ("captured_pixel_input_used", "independent_full_frame_preprocessing",
                      "arbitrary_frame_backend_connected", "product_parity_verified"):
            self.assertIs(report[field], False)
        self.assertEqual(self.producer.call_count, 2)
        self.assertEqual([row["prediction"] for row in report["cases"]], [0, 20])
        for invocation in self.producer.call_args_list:
            np.testing.assert_array_equal(invocation.kwargs["frame"], self.frame)
            self.assertEqual(set(invocation.kwargs), {"frame", "call"})
        self.assertEqual(report, self.written_report())

    def assert_comparison_only(self, *, stage):
        path = (Path(self.tensor_row["path"]) if stage == "tensor"
                else self.root / "trace" / f"prediction-00-{stage}.bgr")
        self.blobs[path] = bytes(len(self.blobs[path]))
        row = self.tensor_row if stage == "tensor" else self.event[stage]
        row["sha256"] = hashlib.sha256(self.blobs[path]).hexdigest()
        with self.assertRaisesRegex(ValueError, "preprocessing differs"):
            replay.run(args=self.args)
        report = self.written_report()
        self.assertFalse(report["passed"])
        self.assertTrue(report["cases"][1]["passed"])
        self.assertEqual(self.producer.call_count, 2)
        checks = report["cases"][0]["checks"]
        self.assertFalse(checks[stage]["exact"])
        self.assertTrue(all(check["exact"] for name, check in checks.items() if name != stage))
        self.assertEqual(report["cases"][0]["generated_tensor_sha256"],
                         hashlib.sha256(self.expected["tensor"].tobytes()).hexdigest())
        np.testing.assert_array_equal(self.producer.call_args.kwargs["frame"], self.frame)

    def test_source_oracle_is_comparison_only(self):
        self.assert_comparison_only(stage="source")

    def test_crop_oracle_is_comparison_only(self):
        self.assert_comparison_only(stage="crop")

    def test_resize_oracle_is_comparison_only(self):
        self.assert_comparison_only(stage="resized")

    def test_tensor_oracle_is_comparison_only(self):
        self.assert_comparison_only(stage="tensor")

    def test_unverified_capture_fails_closed_and_records_failure(self):
        self.evidence["passed"] = 1
        with self.assertRaisesRegex(ValueError, "actual preprocessing capture"):
            replay.run(args=self.args)
        report = self.written_report()
        self.assertFalse(report["passed"])
        self.assertTrue(report["failures"])
        self.producer.assert_not_called()

    def test_empty_validated_cases_cannot_pass_vacuously(self):
        self.cases.clear()
        with self.assertRaises(ValueError):
            replay.run(args=self.args)
        self.assertFalse(self.written_report()["passed"])

    def test_algorithm_descriptor_association_fails_before_production(self):
        self.evidence["algorithm_frames"][0]["file"] = "frame-1.rgba"
        with self.assertRaisesRegex(ValueError, "descriptor association"):
            replay.run(args=self.args)
        self.assertFalse(self.written_report()["passed"])
        self.producer.assert_not_called()

    def test_algorithm_frame_hash_mismatch_fails_before_production(self):
        self.evidence["algorithm_frames"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            replay.run(args=self.args)
        self.assertFalse(self.written_report()["passed"])
        self.producer.assert_not_called()

    def test_algorithm_layout_fails_before_production(self):
        self.records[0]["request"][3] = 15
        with self.assertRaisesRegex(ValueError, "layout/profile"):
            replay.run(args=self.args)
        self.assertFalse(self.written_report()["passed"])
        self.producer.assert_not_called()

    def test_ambiguous_tensor_association_fails_closed(self):
        self.evidence["captures"]["networks"]["9"]["inputs"].append(deepcopy(self.tensor_row))
        with self.assertRaisesRegex(ValueError, "comparison tensor"):
            replay.run(args=self.args)
        self.assertFalse(self.written_report()["passed"])

    def test_lock_guard_failure_invalidates_success(self):
        self.locked.verify.side_effect = ValueError("fixture changed after comparison")
        with self.assertRaisesRegex(ValueError, "fixture changed after comparison"):
            replay.run(args=self.args)
        report = self.written_report()
        self.assertFalse(report["passed"])
        self.assertTrue(any("guard ValueError" in failure for failure in report["failures"]))

    def test_guard_failure_does_not_mask_primary_validation_error(self):
        self.evidence["passed"] = False
        self.locked.verify.side_effect = RuntimeError("changed fixture")
        with self.assertRaisesRegex(ValueError, "actual preprocessing capture"):
            replay.run(args=self.args)
        report = self.written_report()
        self.assertFalse(report["passed"])
        self.assertEqual(len(report["failures"]), 2)


if __name__ == "__main__":
    unittest.main()
