"""CPU scalar arithmetic, RGBA edge cases, and historical evidence guards."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_full_frame_quantization as sampler
import face_full_frame_quantization_probe as probe


def scalar_resize(*, frame, size):
    result = np.empty((size[1], size[0], 4), np.uint8)
    height, width = frame.shape[:2]
    for y in range(size[1]):
        fy = float(np.float32((y + .5) * (height / size[1]) - .5))
        iy = int(np.floor(fy))
        b1 = round((fy - iy) * 2048)
        b0 = 2048 - b1
        for x in range(size[0]):
            fx = float(np.float32((x + .5) * (width / size[0]) - .5))
            ix = int(np.floor(fx))
            a1 = round((fx - ix) * 2048)
            a0 = 2048 - a1
            for channel in range(4):
                taps = [int(frame[min(max(iy + dy, 0), height - 1),
                                  min(max(ix + dx, 0), width - 1), channel])
                        for dy, dx in ((0, 0), (0, 1), (1, 0), (1, 1))]
                top = taps[0] * a0 + taps[1] * a1
                bottom = taps[2] * a0 + taps[3] * a1
                result[y, x, channel] = ((b0 * (top // 16) // 65536) +
                                         (b1 * (bottom // 16) // 65536) + 2) // 4
    return result


class SamplerTests(unittest.TestCase):
    def test_seeded_arbitrary_rgba_matches_scalar_integer_reference(self):
        rng = np.random.default_rng(719)
        for shape, size in (((9, 13, 4), (7, 5)), ((3, 2, 4), (11, 17)),
                            ((1, 7, 4), (9, 1)), ((7, 1, 4), (1, 9)),
                            ((31, 29, 4), (17, 18))):
            frame = rng.integers(0, 256, shape, dtype=np.uint8)
            with self.subTest(shape=shape, size=size):
                np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=size),
                                              scalar_resize(frame=frame, size=size))

    def test_identity_preserves_all_256_channel_values(self):
        frame = np.arange(1024, dtype=np.int64).astype(np.uint8).reshape(16, 16, 4)
        result = sampler.resize_rgba(frame=frame, size=(16, 16))
        np.testing.assert_array_equal(result, frame)
        self.assertFalse(np.shares_memory(result, frame))

    def test_single_pixel_and_transparent_color_are_not_premultiplied(self):
        frame = np.array([[[255, 100, 31, 0]]], np.uint8)
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(13, 7)),
                                      np.broadcast_to(frame, (7, 13, 4)))

    def test_edges_clamp_and_half_pixel_centers(self):
        frame = np.array([[[0, 10, 200, 0], [100, 110, 0, 100]]], np.uint8)
        expected = np.array([[[0, 10, 200, 0], [25, 35, 150, 25],
                              [75, 85, 50, 75], [100, 110, 0, 100]]], np.uint8)
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(4, 1)), expected)

    def test_vertical_edges_clamp(self):
        frame = np.array([[[0] * 4], [[100] * 4]], np.uint8)
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(1, 4))[:, 0, 0],
                                      [0, 25, 75, 100])

    def test_uint8_white_does_not_overflow_at_largest_fixed_point(self):
        frame = np.full((7, 11, 4), 255, np.uint8)
        for mode in sampler.hypotheses().values():
            with self.subTest(mode=mode):
                np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(13, 9), **mode),
                                              np.full((9, 13, 4), 255, np.uint8))

    def test_strided_reversed_readonly_source_is_not_mutated(self):
        source = np.arange(400, dtype=np.uint16).astype(np.uint8).reshape(10, 10, 4)
        frame = source[::-2, ::-2]
        before = source.copy()
        frame.flags.writeable = False
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(8, 6)),
                                      scalar_resize(frame=frame, size=(8, 6)))
        np.testing.assert_array_equal(source, before)

    def test_row_chunk_boundary_does_not_change_output(self):
        frame = np.random.default_rng(45).integers(0, 256, (39, 29, 4), dtype=np.uint8)
        expected = sampler.resize_rgba(frame=frame, size=(17, 35))
        with patch.object(sampler, "ROW_BLOCK", 1):
            np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(17, 35)), expected)

    def test_staged_truncation_is_observable_not_a_relabelled_round(self):
        frame = np.random.default_rng(11).integers(0, 256, (19, 23, 4), dtype=np.uint8)
        actual = sampler.resize_rgba(frame=frame, size=(17, 13))
        for arithmetic in ("half-up", "even", "floor", "no-horizontal-truncation"):
            with self.subTest(arithmetic=arithmetic):
                other = sampler.resize_rgba(frame=frame, size=(17, 13), arithmetic=arithmetic)
                self.assertGreater(np.count_nonzero(actual != other), 0)

    def test_channel_permutation_equivariance(self):
        frame = np.random.default_rng(7).integers(0, 256, (7, 9, 4), dtype=np.uint8)
        order = [3, 1, 0, 2]
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame[:, :, order], size=(5, 3)),
                                      sampler.resize_rgba(frame=frame, size=(5, 3))[:, :, order])

    def test_float_baseline_keeps_historical_multiply_then_divide_order(self):
        source, target = 1448, 640
        x0, _, first, second = sampler.axis(source=source, target=target, bits=None,
                                            coordinate="half-pixel", weight_rounding="even")
        position = (np.arange(target) + .5) * source / target - .5
        np.testing.assert_array_equal(x0, np.floor(position).astype(np.int64))
        np.testing.assert_array_equal(second, position - np.floor(position))
        np.testing.assert_array_equal(first + second, np.ones(target))

    def test_nearest_even_and_half_up_are_distinct_controls(self):
        frame = np.array([[[0, 2, 254, 100], [1, 3, 255, 101]]], np.uint8)
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(1, 1), arithmetic="even"),
                                      [[[0, 2, 254, 100]]])
        np.testing.assert_array_equal(sampler.resize_rgba(frame=frame, size=(1, 1)),
                                      [[[1, 3, 255, 101]]])

    def test_coordinate_controls_differ_without_data_dependent_offsets(self):
        frame = np.arange(64, dtype=np.uint8).reshape(1, 16, 4)
        values = [sampler.resize_rgba(frame=frame, size=(7, 1), coordinate=mode).tobytes()
                  for mode in sampler.COORDINATES]
        self.assertEqual(len(set(values)), 3)

    def test_dimension_limits_are_inclusive(self):
        frame = np.zeros((1, 1, 4), np.uint8)
        for size in ((4096, 1), (1, 4096)):
            self.assertEqual(sampler.resize_rgba(frame=frame, size=size).shape, (size[1], size[0], 4))

    def test_bad_frames_are_rejected(self):
        frames = (None, [], np.zeros((0, 1, 4), np.uint8), np.zeros((4097, 1, 4), np.uint8),
                  np.zeros((1, 1, 3), np.uint8), np.zeros((1, 1, 4), np.float32),
                  np.zeros((1, 1, 4), np.int8), np.zeros((1, 4), np.uint8),
                  np.ma.array(np.zeros((1, 1, 4), np.uint8)))
        for frame in frames:
            with self.subTest(kind=type(frame)), self.assertRaises(ValueError):
                sampler.resize_rgba(frame=frame, size=(1, 1))

    def test_bad_sizes_and_hypotheses_are_rejected(self):
        frame = np.zeros((1, 1, 4), np.uint8)
        for size in (None, [1, 1], (1,), (1, 1, 1), (True, 1), (1.0, 1),
                     (np.int64(1), 1), (0, 1), (4097, 1)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                sampler.resize_rgba(frame=frame, size=size)
        for options in (dict(bits=True), dict(bits=11.0), dict(bits=3), dict(bits=17),
                        dict(bits=None), dict(bits=8), dict(coordinate="fitted"),
                        dict(arithmetic="fitted"), dict(weight_rounding="fitted")):
            with self.subTest(options=options), self.assertRaises(ValueError):
                sampler.resize_rgba(frame=frame, size=(1, 1), **options)

    def test_mapping_requires_plain_integer_and_all_slots(self):
        self.assertEqual([probe.prediction_frame(index=i) for i in range(26)],
                         [0] * 12 + [i for i in range(7) for _ in range(2)])
        for value in (True, 0.0, np.int64(0), -1, 26, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.prediction_frame(index=value)

    def test_metrics_detect_alpha_and_signed_error(self):
        reference = np.array([[[2, 2, 2, 2]]], np.uint8)
        actual = np.array([[[1, 3, 2, 1]]], np.uint8)
        metrics = probe.metrics(candidate=actual, reference=reference)
        self.assertEqual(metrics["per_channel_changed"], [1, 1, 0, 1])
        self.assertEqual((metrics["candidate_lower"], metrics["candidate_higher"]), (2, 1))
        self.assertFalse(metrics["equal"])


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.temp.name).resolve()
        cls.original, cls.capture = cls.base / "original", cls.base / "capture"
        cls.original.mkdir()
        (cls.capture / "geometry").mkdir(parents=True)
        fixtures, frames, descriptors, snapshots = {}, [], [], []
        for i in range(7):
            raw = bytes((10 + i, 30, 90, i)) * (1448 * 1086)
            path = cls.original / f"input-{i:02d}.rgba"
            path.write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            fixtures[str(path)] = digest
            frames.append(dict(input_rgba_sha256=digest))
        previous = cls.original / "report.json"
        previous.write_text(json.dumps(dict(frames=frames)))
        fixtures[str(previous)] = hashlib.sha256(previous.read_bytes()).hexdigest()
        for i in range(26):
            f = probe.prediction_frame(index=i)
            raw = bytes((10 + f, 30, 90, f)) * (640 * 480)
            path = cls.capture / "geometry" / f"frame-{i}.rgba"
            path.write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            fixtures[str(path)] = digest
            descriptors.append(dict(prediction=i, file=path.name, bytes=len(raw), sha256=digest))
            snapshots.append(dict(index=i, request=[0, 640, 480, 2560, 0],
                                  frame_file=path.name, frame_bytes=len(raw)))
        cls.template = dict(passed=True, diagnostic_only=True, observer_pixel_parity_verified=True,
                            capture=str(cls.original), fixture_sha256=fixtures, algorithm_frames=descriptors,
                            geometry_snapshots=snapshots)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.evidence = deepcopy(self.template)
        self.out = self.base / f"output-{self.id().split('.')[-1]}"
        self.save_report()

    def save_report(self):
        path = self.capture / "report.json"
        path.write_text(json.dumps(self.evidence))
        self.digest = hashlib.sha256(path.read_bytes()).hexdigest()

    def load(self):
        return probe.load_oracles(root=self.capture, report_sha256=self.digest, locked=LockedFiles())

    def run_probe(self):
        with patch.object(probe, "hypotheses", return_value={"staged-q11": {}}):
            return probe.run(capture=self.capture, capture_sha256=self.digest, out=self.out)

    def test_full_profile_saves_seven_independent_outputs_and_26_checks(self):
        report = self.run_probe()
        self.assertTrue(report["completed"])
        self.assertTrue(report["sampling_parity"])
        self.assertEqual(report["exact_modes"], ["staged-q11"])
        self.assertEqual(len(report["cases"]), 26)
        self.assertEqual(len(list(self.out.glob("candidate-*.rgba"))), 7)
        self.assertFalse(report["current_full_chain_provenance_revalidated"])
        self.assertFalse(report["native_caller_route_proven"])
        self.assertFalse(report["product_parity_verified"])
        self.assertFalse(report["oracle_pixels_used_by_sampler"])

    def test_wrong_capture_hash_is_rejected_and_failure_retained(self):
        self.digest = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.run_probe()
        report = json.loads((self.out / "report.json").read_bytes())
        self.assertFalse(report["completed"])
        self.assertFalse(report["sampling_parity"])

    def test_partial_or_empty_profile_never_vacuously_passes(self):
        for key, value in (("algorithm_frames", []), ("geometry_snapshots", self.template["geometry_snapshots"][:-1])):
            self.evidence = deepcopy(self.template)
            self.evidence[key] = value
            self.save_report()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()

    def test_boolean_and_float_observation_fields_are_rejected(self):
        for key, field, value in (("algorithm_frames", "prediction", False),
                                  ("geometry_snapshots", "index", 0.0),
                                  ("algorithm_frames", "bytes", float(probe.TARGET_BYTES)),
                                  ("geometry_snapshots", "frame_bytes", float(probe.TARGET_BYTES)),
                                  ("geometry_snapshots", "request", [False, 640, 480, 2560, 0]),
                                  ("geometry_snapshots", "request", [0, 640, 480, 2560, 1])):
            self.evidence = deepcopy(self.template)
            self.evidence[key][0][field] = value
            self.save_report()
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.load()

    def test_path_traversal_and_foreign_source_capture_are_rejected(self):
        self.evidence["algorithm_frames"][0]["file"] = "../frame-0.rgba"
        self.save_report()
        with self.assertRaises(ValueError):
            self.load()
        self.evidence = deepcopy(self.template)
        self.evidence["capture"] = "/tmp/foreign-capture"
        self.save_report()
        with self.assertRaises(ValueError):
            self.load()

    def test_missing_or_disagreeing_identity_is_rejected(self):
        for change in ("missing", "disagrees"):
            self.evidence = deepcopy(self.template)
            path = self.capture / "geometry/frame-0.rgba"
            if change == "missing":
                self.evidence["fixture_sha256"].pop(str(path))
            else:
                self.evidence["algorithm_frames"][0]["sha256"] = "a" * 64
            self.save_report()
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.load()

    def test_reference_corruption_is_detected(self):
        path = self.capture / "geometry/frame-25.rgba"
        raw = path.read_bytes()
        self.addCleanup(path.write_bytes, raw)
        path.write_bytes(b"\xff" + raw[1:])
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.load()

    def test_original_rgba_corruption_fails_without_using_oracle_as_input(self):
        path = self.original / "input-06.rgba"
        raw = path.read_bytes()
        self.addCleanup(path.write_bytes, raw)
        path.write_bytes(b"\xff" + raw[1:])
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.run_probe()
        report = json.loads((self.out / "report.json").read_bytes())
        self.assertFalse(report["completed"])
        self.assertFalse(report["sampling_parity"])

    def test_original_report_identity_cannot_be_silently_replaced(self):
        path = self.original / "report.json"
        raw = path.read_bytes()
        self.addCleanup(path.write_bytes, raw)
        path.write_bytes(raw + b" ")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.load()

    def test_unpassed_or_non_neutral_report_is_not_an_oracle(self):
        for key in ("passed", "diagnostic_only", "observer_pixel_parity_verified"):
            self.evidence = deepcopy(self.template)
            self.evidence[key] = 1
            self.save_report()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()

    def test_empty_hypothesis_set_cannot_pass(self):
        self.out.mkdir()
        with self.assertRaisesRegex(ValueError, "nonempty"):
            probe.compare(sources=[{}] * 7, observations=[{}] * 26, modes={},
                          locked=LockedFiles(), out=self.out)

    def test_truncated_packed_frame_is_rejected_even_with_matching_hash(self):
        path = self.capture / "geometry/frame-25.rgba"
        raw = path.read_bytes()
        self.addCleanup(path.write_bytes, raw)
        path.write_bytes(raw[:-4])
        digest = hashlib.sha256(raw[:-4]).hexdigest()
        self.evidence["fixture_sha256"][str(path)] = digest
        self.evidence["algorithm_frames"][25]["sha256"] = digest
        self.save_report()
        with self.assertRaisesRegex(ValueError, "byte count"):
            self.load()

    def test_output_directory_is_never_reused(self):
        self.out.mkdir()
        sentinel = self.out / "report.json"
        sentinel.write_bytes(b"immutable")
        with self.assertRaises(FileExistsError):
            self.run_probe()
        self.assertEqual(sentinel.read_bytes(), b"immutable")

    def test_symlink_input_is_rejected(self):
        link = self.base / "input-link"
        link.symlink_to(self.original / "input-00.rgba")
        self.addCleanup(link.unlink)
        with self.assertRaisesRegex(ValueError, "non-symlink"):
            probe.read_rgba(path=link, size=probe.SOURCE_SIZE,
                            expected=self.template["fixture_sha256"][str(self.original / "input-00.rgba")],
                            locked=LockedFiles())

    def test_late_guard_failure_revokes_completed_and_exact_modes(self):
        with patch.object(LockedFiles, "verify", side_effect=ValueError("changed late")):
            with self.assertRaisesRegex(ValueError, "changed late"):
                self.run_probe()
        report = json.loads((self.out / "report.json").read_bytes())
        self.assertFalse(report["completed"])
        self.assertFalse(report["sampling_parity"])
        self.assertEqual(report["exact_modes"], [])

    def test_one_changed_observation_blocks_exactness(self):
        original_metrics = probe.metrics

        def mismatch(*, candidate, reference):
            changed = candidate.copy()
            changed[0, 0, 3] ^= 1
            return original_metrics(candidate=changed, reference=reference)

        with patch.object(probe, "metrics", side_effect=mismatch):
            report = self.run_probe()
        self.assertTrue(report["completed"])
        self.assertFalse(report["sampling_parity"])
        self.assertEqual(report["exact_modes"], [])


if __name__ == "__main__":
    unittest.main()
