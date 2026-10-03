"""CPU-only candidate validation and mocked host runs using temporary profiles."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_preprocess_chain_render as chain


def sha(*, data):
    return hashlib.sha256(data).hexdigest()


def encoded(*, value):
    return json.dumps(value, allow_nan=False).encode() + b"\n"


class CandidateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.capture, self.candidate, self.source_root = (self.root / name for name in ("capture", "candidate", "sources"))
        for directory in (self.capture, self.candidate, self.source_root):
            directory.mkdir()
        self.path = self.candidate / "replay.json"
        self.capture_report = self.capture / "report.json"
        self.capture_report.write_bytes(b'{"synthetic":true}\n')
        self.fixture = self.capture / "fixture.bin"
        self.fixture.write_bytes(b"synthetic readonly fixture")
        self.source = self.source_root / "local-model-pytorch/synthetic.py"
        self.source.parent.mkdir()
        self.source.write_bytes(b"synthetic source identity")
        self.value = dict(version=1, coordinate_space=chain.consumer.COORDINATE_SPACE, width=1448, height=1086,
                          image_sha256="a" * 64, frames=[])
        for index in range(24):
            faces = [] if index in (16, 17) else [dict(id=int(index >= 18), points=[[0.25, 0.75] for _ in range(106)])]
            self.value["frames"].append(dict(timestamp_us=index * 1000, faces=faces))
        self.context = dict(root=self.capture, native=deepcopy(self.value))
        self.evidence = dict(profile="actual-preprocess-owned-chain-v1", passed=True, completed=True,
                             geometry_exact=True, final_consumer_parity=True,
                             independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
                             owned_initialization_used=True, owned_temporal_smoothing_used=True,
                             captured_tensor_input_used=False, native_final_point_input_used=False,
                             native_smoothing_seed_required=False, native_analysis_bypassed=False,
                             product_parity_verified=False, arbitrary_frame_backend_connected=False,
                             capture_sha256=sha(data=self.capture_report.read_bytes()),
                             owned_smoothing_seed_predictions=[0, 20], native_smoothing_seed_predictions=[],
                             fixture_sha256={str(path): sha(data=path.read_bytes()) for path in
                                             (self.capture_report, self.fixture, self.source)},
                             source_sha256={"local-model-pytorch/synthetic.py": sha(data=self.source.read_bytes())})
        self.addCleanup(patch.stopall)
        patch.object(chain.render, "SOURCE_ROOT", self.source_root).start()

    def persist(self, *, data=None):
        data = encoded(value=self.value) if data is None else data
        self.path.write_bytes(data)
        self.evidence["replay_sha256"] = sha(data=data)
        (self.candidate / "report.json").write_bytes(encoded(value=self.evidence))

    def load(self):
        actual = LockedFiles()
        actual.read(path=self.capture_report)
        self.locked = Mock(wraps=actual)
        self.locked.files = actual.files
        return chain.load_candidate(path=self.path, context=self.context, locked=self.locked)

    def reject(self, *, message=None):
        with self.assertRaises((ValueError, KeyError, FileNotFoundError)) as error:
            self.load()
        if message is not None:
            self.assertIn(message, str(error.exception))

    def test_exact_profile_has_bounded_hash_reads_and_no_mutation(self):
        self.persist()
        paths = (self.path, self.candidate / "report.json", self.capture_report, self.fixture, self.source)
        before = {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in paths}
        value, payload = self.load()
        self.assertEqual(value, self.value)
        self.assertTrue(payload.startswith(chain.consumer.MAGIC))
        self.locked.json.assert_called_once_with(path=self.candidate / "report.json")
        for call in self.locked.read.call_args_list:
            path = call.kwargs["path"]
            self.assertEqual(call.kwargs["expected"], sha(data=path.read_bytes()))
            self.assertGreater(call.kwargs["maximum"], 0)
            self.assertLessEqual(call.kwargs["maximum"], 128 * 1024**2)
        replay_read = [call.kwargs for call in self.locked.read.call_args_list if call.kwargs["path"] == self.path]
        self.assertEqual(replay_read, [dict(path=self.path, expected=self.evidence["replay_sha256"], maximum=chain.owned.REPLAY_LIMIT)])
        self.assertEqual(before, {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in paths})
        self.locked.verify()

    def test_required_flags_reject_missing_false_and_truthy_nonboolean(self):
        keys = ("passed", "completed", "geometry_exact", "final_consumer_parity",
                "independent_120_sampling_input_used", "independent_160_sampling_input_used",
                "owned_initialization_used", "owned_temporal_smoothing_used")
        for key in keys:
            for value in (None, False, 1, "true"):
                with self.subTest(key=key, value=value):
                    self.evidence[key] = value
                    self.persist()
                    self.reject(message="bound to this capture")
            self.evidence[key] = True

    def test_forbidden_flags_require_exact_false(self):
        keys = ("captured_tensor_input_used", "native_final_point_input_used", "native_smoothing_seed_required",
                "native_analysis_bypassed", "product_parity_verified", "arbitrary_frame_backend_connected")
        for key in keys:
            for value in (None, True, 0, "false"):
                with self.subTest(key=key, value=value):
                    self.evidence[key] = value
                    self.persist()
                    self.reject(message="bound to this capture")
            self.evidence[key] = False

    def test_wrong_profile_and_capture_identity_are_rejected(self):
        for key, value in (("profile", "diagnostic-only"), ("capture_sha256", "b" * 64)):
            old = self.evidence[key]
            with self.subTest(key=key):
                self.evidence[key] = value
                self.persist()
                self.reject(message="bound to this capture")
            self.evidence[key] = old

    def test_wrong_seed_lifecycle_and_native_seed_claim_are_rejected(self):
        for key, value in (("owned_smoothing_seed_predictions", [0, 21]),
                           ("owned_smoothing_seed_predictions", [0]), ("native_smoothing_seed_predictions", [20])):
            old = self.evidence[key]
            self.evidence[key] = value
            with self.subTest(key=key, value=value):
                self.persist()
                self.reject(message="bound to this capture")
            self.evidence[key] = old

    def test_fixture_inventory_requires_nonempty_bounded_dictionary(self):
        for fixtures in ({}, None, [], {str(self.root / str(index)): "a" * 64 for index in range(4097)}):
            with self.subTest(count=len(fixtures) if fixtures is not None else None):
                self.evidence["fixture_sha256"] = fixtures
                self.persist()
                self.reject(message="bounded candidate fixture")

    def test_fixture_paths_and_hashes_must_be_exact_absolute_identities(self):
        for fixtures in ({"relative.bin": "a" * 64}, {str(self.fixture): "b" * 64},
                         {str(self.fixture): "invalid"}, {str(self.root / "missing"): "a" * 64}):
            with self.subTest(fixtures=fixtures):
                self.evidence["fixture_sha256"] = fixtures
                self.persist()
                self.reject()

    def test_source_inventory_requires_valid_bounded_relative_paths_and_hashes(self):
        invalid = ({}, None, {"../fixture": "a" * 64}, {str(self.source): "a" * 64},
                   {"local-model-pytorch/synthetic.py": "b" * 64}, {"local-model-pytorch/synthetic.py": "invalid"},
                   {f"source-{index}": "a" * 64 for index in range(129)})
        for sources in invalid:
            with self.subTest(sources=sources):
                self.evidence["source_sha256"] = sources
                self.persist()
                self.reject()

    def test_fixture_changed_after_profile_creation_is_rejected(self):
        self.persist()
        self.fixture.write_bytes(b"mutated fixture")
        self.reject(message="fixture hash mismatch")

    def test_source_symlink_cannot_escape_locked_source_root(self):
        outside = self.root / "outside-source.py"
        outside.write_bytes(self.source.read_bytes())
        self.source.unlink()
        self.source.symlink_to(outside)
        self.persist()
        self.reject(message="invalid source path")

    def test_replay_hash_mismatch_is_not_recomputed(self):
        self.persist()
        self.path.write_bytes(encoded(value=dict(self.value, version=2)))
        self.reject(message="hash mismatch: replay.json")

    def test_replay_byte_bound_is_enforced(self):
        self.persist(data=b"x" * (chain.owned.REPLAY_LIMIT + 1))
        self.reject(message="oversized fixture")

    def test_duplicate_json_fields_and_nonfinite_constants_are_rejected(self):
        for data in (b'{"version":1,"version":1}', b'{"version":NaN}', b'{"version":1e999}'):
            with self.subTest(data=data):
                self.persist(data=data)
                self.reject()

    def test_replay_provenance_coordinate_space_and_dimensions_are_exact(self):
        for key, value in (("version", True), ("width", 1448.0), ("height", 1087),
                           ("image_sha256", "b" * 64), ("coordinate_space", "top-left")):
            old = self.value[key]
            with self.subTest(key=key):
                self.value[key] = value
                self.persist()
                self.reject()
            self.value[key] = old

    def test_frame_count_requires_exact_24_conversions(self):
        original = deepcopy(self.value["frames"])
        for frames in (original[:-1], original + [deepcopy(original[-1])]):
            with self.subTest(count=len(frames)):
                self.value["frames"] = frames
                self.persist()
                self.reject(message="exact 24")

    def test_valid_but_different_timestamp_and_face_identity_are_rejected(self):
        original = deepcopy(self.value["frames"])
        for field in ("timestamp", "identity"):
            self.value["frames"] = deepcopy(original)
            if field == "timestamp":
                self.value["frames"][0]["timestamp_us"] = 1
            else:
                self.value["frames"][0]["faces"][0]["id"] = 7
            with self.subTest(field=field):
                self.persist()
                self.reject(message="timestamps or face identities differ")

    def test_one_float32_value_mutation_is_rejected_without_diagnostic_escape(self):
        self.value["frames"][0]["faces"][0]["points"][0][0] = float(np.nextafter(np.float32(0.25), np.float32(1)))
        self.evidence["diagnostic_only"] = True
        self.persist()
        self.reject(message="normalized points differ; diagnostic rendering is not accepted")

    def test_no_face_window_cannot_publish_stale_points(self):
        self.value["frames"][16]["faces"] = deepcopy(self.value["frames"][15]["faces"])
        self.persist()
        self.reject(message="timestamps or face identities differ")

    def test_timestamp_type_order_and_maximum_are_bounded(self):
        original = deepcopy(self.value["frames"])
        for value in (-1, True, 0.5, chain.consumer.REPLAY_TIME_LIMIT_US + 1):
            self.value["frames"] = deepcopy(original)
            self.value["frames"][1]["timestamp_us"] = value
            with self.subTest(value=value):
                self.persist()
                self.reject(message="replay timing")

    def test_landmarks_require_106_finite_normalized_pairs_and_integer_ids(self):
        original = deepcopy(self.value["frames"])
        for field, value in (("points", [[0.25, 0.75]] * 105), ("points", [[-0.01, 0.75]] * 106),
                             ("points", [[0.25, 1.01]] * 106), ("points", [[True, 0.75]] * 106),
                             ("id", True), ("id", -1), ("id", 2**31)):
            self.value["frames"] = deepcopy(original)
            self.value["frames"][0]["faces"][0][field] = value
            with self.subTest(field=field, value=value[0] if isinstance(value, list) else value):
                self.persist()
                self.reject()


class InputViewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.capture = self.root / "capture"
        self.capture.mkdir()
        (self.capture / "baseline").mkdir()
        self.context = dict(root=self.capture, frames=[])
        self.locked = LockedFiles()
        for index in range(7):
            path = self.capture / f"source-{index}.rgba"
            path.write_bytes(bytes([index, 2, 3, 255]))
            self.locked.read(path=path)
            self.context["frames"].append(dict(input=path))
        self.directory = self.root / "view"

    def test_symlinks_are_hash_locked_and_original_inputs_unchanged(self):
        before = {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in self.capture.glob("*.rgba")}
        context = deepcopy(self.context)
        self.assertEqual(chain.input_view(directory=self.directory, context=self.context, locked=self.locked), self.directory)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        for index, frame in enumerate(self.context["frames"]):
            link = self.directory / f"input-{index:02d}.rgba"
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.readlink(), frame["input"])
            self.assertEqual(self.locked.files[str(link)], self.locked.files[str(frame["input"])])
        self.assertEqual((self.directory / "baseline").readlink(), self.capture / "baseline")
        self.assertEqual(self.context, context)
        self.assertEqual(before, {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in before})
        self.locked.verify()

    def test_existing_view_is_not_overwritten(self):
        self.directory.mkdir()
        sentinel = self.directory / "keep"
        sentinel.write_bytes(b"unchanged")
        with self.assertRaises(FileExistsError):
            chain.input_view(directory=self.directory, context=self.context, locked=self.locked)
        self.assertEqual(sentinel.read_bytes(), b"unchanged")

    def test_source_mutation_and_symlink_retargeting_fail_hash_guard(self):
        source = self.context["frames"][0]["input"]
        source.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            chain.input_view(directory=self.directory, context=self.context, locked=self.locked)
        self.assertEqual(source.read_bytes(), b"changed")

    def test_retargeted_view_fails_finish_verification(self):
        chain.input_view(directory=self.directory, context=self.context, locked=self.locked)
        link = self.directory / "input-00.rgba"
        link.unlink()
        link.symlink_to(self.context["frames"][1]["input"])
        with self.assertRaisesRegex(ValueError, "hash mismatch|changed between reads"):
            self.locked.verify()


class RenderRunTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.capture, self.out = root / "capture", root / "out"
        self.capture.mkdir()
        self.out.mkdir()
        self.path, self.host = root / "replay.json", root / "synthetic-host"
        for path in (self.capture / "report.json", self.path, self.host):
            path.write_bytes(b"synthetic readonly identity")
        self.locked = LockedFiles()
        for path in (self.capture / "report.json", self.path, self.host):
            self.locked.read(path=path)
        self.context = dict(root=self.capture, runtime=root / "runtime", package=root / "package", host=self.host,
                            frames=[dict(input=root / f"input-{index}.rgba", expect_change=True) for index in range(7)])
        self.value, self.payload = {"synthetic": "candidate"}, b"synthetic replay payload"
        self.args = argparse.Namespace(capture=self.capture, candidate=self.path, out=self.out)
        self.addCleanup(patch.stopall)
        patch.object(chain, "LockedFiles", return_value=self.locked).start()
        patch.object(chain.sequence, "fresh_output", return_value=self.out).start()
        patch.object(chain.capture, "load", return_value=self.context).start()
        self.candidate = patch.object(chain, "load_candidate", return_value=(self.value, self.payload)).start()
        self.view = patch.object(chain, "input_view", return_value=self.out / "input-view").start()
        patch.object(chain, "sources", return_value={"synthetic.py": "a" * 64}).start()
        self.host_run = patch.object(chain.render, "render_host").start()
        self.compare = patch.object(chain.render, "compare_outputs").start()
        self.library = patch.object(chain.consumer, "verify_library").start()

    def saved(self):
        return json.loads((self.out / "report.json").read_bytes())

    def assert_dependencies(self, *, report):
        for field in ("native_analysis_bypassed", "independent_inference_verified",
                      "product_parity_verified", "arbitrary_frame_backend_connected"):
            self.assertIs(report[field], False)
        self.assertEqual(report["runtime"], str(self.context["runtime"]))
        self.assertEqual(report["package"], str(self.context["package"]))
        self.assertEqual(report["host_sha256"], sha(data=self.host.read_bytes()))

    def test_success_hands_exact_dependencies_to_mocked_host_without_independence_claim(self):
        report = chain.run(args=self.args)
        self.assertEqual(report, self.saved())
        for field in ("passed", "completed", "pixel_parity_verified", "external_replay_verified"):
            self.assertIs(report[field], True)
        self.assert_dependencies(report=report)
        call = self.host_run.call_args.kwargs
        for key in ("runtime", "package"):
            self.assertEqual(call[key], self.context[key])
        self.assertEqual(call["host_path"], self.host)
        self.assertIs(call["value"], self.value)
        self.assertIs(call["frames"], self.context["frames"])
        self.assertIs(call["locked"], self.locked)
        self.assertEqual((self.out / "replay.bin").read_bytes(), self.payload)
        self.library.assert_called_once_with(runtime=self.context["runtime"])
        self.assertTrue(all("input" not in frame for frame in report["frames"]))
        self.assertEqual(report["warmup_requests_per_host"], 6)
        self.assertEqual(report["seeks_per_request"], 2)

    def test_host_failure_preserves_failed_report_and_native_dependencies(self):
        self.host_run.side_effect = RuntimeError("synthetic host failed")
        with self.assertRaisesRegex(RuntimeError, "synthetic host failed"):
            chain.run(args=self.args)
        report = self.saved()
        for field in ("passed", "completed", "pixel_parity_verified", "external_replay_verified"):
            self.assertIs(report[field], False)
        self.assert_dependencies(report=report)
        self.compare.assert_not_called()
        self.library.assert_not_called()
        self.assertIn("RuntimeError: synthetic host failed", report["failures"])

    def test_pixel_difference_never_promotes_parity_or_product_acceptance(self):
        self.compare.side_effect = ValueError("candidate beauty pixels differ")
        with self.assertRaisesRegex(ValueError, "pixels differ"):
            chain.run(args=self.args)
        report = self.saved()
        for field in ("passed", "completed", "pixel_parity_verified"):
            self.assertIs(report[field], False)
        self.assertIs(report["external_replay_verified"], True)
        self.assert_dependencies(report=report)
        self.library.assert_not_called()

    def test_library_guard_failure_keeps_pixel_parity_false(self):
        self.library.side_effect = ValueError("synthetic runtime changed")
        with self.assertRaisesRegex(ValueError, "runtime changed"):
            chain.run(args=self.args)
        report = self.saved()
        self.assertIs(report["passed"], False)
        self.assertIs(report["pixel_parity_verified"], False)
        self.assert_dependencies(report=report)

    def test_candidate_failure_does_not_start_host_or_write_binary(self):
        self.candidate.side_effect = ValueError("candidate rejected")
        with self.assertRaisesRegex(ValueError, "candidate rejected"):
            chain.run(args=self.args)
        self.assertIs(self.saved()["passed"], False)
        self.host_run.assert_not_called()
        self.view.assert_not_called()
        self.assertFalse((self.out / "replay.bin").exists())

    def test_guard_preserves_original_host_failure_and_records_both(self):
        self.host_run.side_effect = RuntimeError("original host failure")
        with patch.object(self.locked, "verify", side_effect=ValueError("fixture guard failed")):
            with self.assertRaisesRegex(RuntimeError, "original host failure"):
                chain.run(args=self.args)
        report = self.saved()
        self.assertIs(report["passed"], False)
        self.assertIs(report["pixel_parity_verified"], False)
        self.assertEqual(report["failures"], ["RuntimeError: original host failure", "guard ValueError: fixture guard failed"])

    def test_final_fixture_guard_revokes_pixel_parity_and_completion(self):
        with patch.object(self.locked, "verify", side_effect=ValueError("final fixture changed")):
            with self.assertRaisesRegex(ValueError, "final fixture changed"):
                chain.run(args=self.args)
        report = self.saved()
        self.assertIs(report["passed"], False)
        self.assertIn("guard ValueError: final fixture changed", report["failures"])
        self.assertIs(report["pixel_parity_verified"], False)
        self.assertIs(report["completed"], False)


if __name__ == "__main__":
    unittest.main()
