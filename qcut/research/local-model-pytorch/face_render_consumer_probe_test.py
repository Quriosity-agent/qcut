"""Contract tests; real native rendering is checked by the private E2E probe."""

import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

import face_render_consumer_probe as probe
import face_render_consumer_e2e as e2e
import numpy as np
import face_render_injection_inventory as inventory


def replay_fixture():
    return {
        "version": 1, "coordinate_space": probe.COORDINATE_SPACE,
        "width": 100, "height": 80, "image_sha256": "a" * 64,
        "frames": [{"timestamp_us": 0,
                    "faces": [{"id": 0, "points": [[0.25, 0.75] for _ in range(106)]}]}],
    }


def encode(*, value):
    return probe.validate_replay(value=value, width=100, height=80, image_hash="a" * 64)


def warmup_log():
    return "QCUT\tREADY\t1\n" + "\n".join(
        f"QCUT\tRESULT\twarmup-{i}\t0" for i in range(probe.WARMUP_COUNT)) + "\n"


class ReplayTests(unittest.TestCase):
    def test_exact_binary_layout(self):
        payload = encode(value=replay_fixture())
        self.assertEqual(len(payload), 20 + 12 + 4 + 848)
        self.assertEqual(struct.unpack_from("<8sIII", payload), (probe.MAGIC, 100, 80, 1))
        self.assertEqual(struct.unpack_from("<qIi2f", payload, 20), (0, 1, 0, 0.25, 0.75))

    def test_float32_roundtrip(self):
        value = replay_fixture()
        original = struct.unpack("<f", struct.pack("<f", 0.412345678))[0]
        value["frames"][0]["faces"][0]["points"][0][0] = original
        reloaded = json.loads(json.dumps(value))
        self.assertEqual(struct.unpack_from("<f", encode(value=reloaded), 36)[0], original)

    def test_multiple_faces_and_empty_frame(self):
        value = replay_fixture()
        second = copy.deepcopy(value["frames"][0]["faces"][0])
        second["id"] = 9
        value["frames"][0]["faces"].append(second)
        value["frames"].append({"timestamp_us": 33_333, "faces": []})
        self.assertEqual(len(encode(value=value)), 20 + 12 + 2 * 852 + 12)

    def test_provenance(self):
        for key, replacement in (
            ("version", 2), ("version", True), ("coordinate_space", "image-pixels"),
            ("width", 101), ("height", 81), ("image_sha256", "b" * 64),
        ):
            with self.subTest(key=key, replacement=replacement):
                value = replay_fixture()
                value[key] = replacement
                with self.assertRaises(ValueError):
                    encode(value=value)

    def test_boolean_dimensions_are_not_integer_dimensions(self):
        value = replay_fixture()
        value["width"] = True
        with self.assertRaises(ValueError):
            probe.validate_replay(value=value, width=1, height=80, image_hash="a" * 64)

    def test_frame_count(self):
        for count in (0, 65):
            value = replay_fixture()
            value["frames"] *= count
            with self.assertRaises(ValueError):
                encode(value=value)

    def test_negative_and_invalid_timestamps(self):
        for timestamp in (-1, 100_001, True, 0.1, None, "0"):
            with self.subTest(timestamp=timestamp):
                value = replay_fixture()
                value["frames"][0]["timestamp_us"] = timestamp
                with self.assertRaises(ValueError):
                    encode(value=value)

    def test_non_monotonic_time(self):
        value = replay_fixture()
        value["frames"][0]["timestamp_us"] = 50
        value["frames"].append({"timestamp_us": 49, "faces": []})
        with self.assertRaises(ValueError):
            encode(value=value)

    def test_duplicate_time_is_two_real_render_passes(self):
        value = replay_fixture()
        value["frames"].append(copy.deepcopy(value["frames"][0]))
        self.assertGreater(len(encode(value=value)), 884)

    def test_track_identity(self):
        for identity in (-1, 2**31, True, 1.5, "0"):
            value = replay_fixture()
            value["frames"][0]["faces"][0]["id"] = identity
            with self.assertRaises(ValueError):
                encode(value=value)

    def test_duplicate_tracks(self):
        value = replay_fixture()
        value["frames"][0]["faces"] *= 2
        with self.assertRaises(ValueError):
            encode(value=value)

    def test_too_many_faces(self):
        value = replay_fixture()
        value["frames"][0]["faces"] *= 11
        with self.assertRaises(ValueError):
            encode(value=value)

    def test_landmark_count(self):
        for count in (0, 105, 107):
            value = replay_fixture()
            value["frames"][0]["faces"][0]["points"] = [[0.1, 0.5]] * count
            with self.assertRaises(ValueError):
                encode(value=value)

    def test_landmark_shape(self):
        for point in ([0.5], [0.5, 0.2, 0.3], None, "xy", {"x": 0.5, "y": 0.2}):
            value = replay_fixture()
            value["frames"][0]["faces"][0]["points"][0] = point
            with self.assertRaises(ValueError):
                encode(value=value)

    def test_invalid_coordinate(self):
        for coordinate in (float("nan"), float("inf"), -0.1, 1.1, True, "0.5", 10**1000):
            value = replay_fixture()
            value["frames"][0]["faces"][0]["points"][0][0] = coordinate
            with self.assertRaises(ValueError):
                encode(value=value)

    def test_wrong_container_types(self):
        for value in ([], None, {"version": 1, "frames": "bad"}):
            with self.assertRaises(ValueError):
                encode(value=value)


class HostContractTests(unittest.TestCase):
    def test_valid_log(self):
        log = warmup_log() + "\n".join(f"QCUT\tRESULT\tframe-{i}\t0" for i in range(4))
        probe.validate_host_log(log=log)

    def test_zero_exit_is_not_success(self):
        for log in ("", "QCUT\tREADY\t1", "QCUT\tREADY\t1\nQCUT\tRESULT\tframe-0\t1\terror"):
            with self.assertRaises(RuntimeError):
                probe.validate_host_log(log=log)

    def test_duplicate_or_wrong_order_results(self):
        for ids in ([0, 0, 2, 3], [1, 0, 2, 3], [0, 1, 2, 3, 4]):
            log = warmup_log() + "\n".join(f"QCUT\tRESULT\tframe-{i}\t0" for i in ids)
            with self.assertRaises(RuntimeError):
                probe.validate_host_log(log=log)

    def test_extra_protocol_fields_are_rejected(self):
        log = warmup_log() + "\n".join(f"QCUT\tRESULT\tframe-{i}\t0" for i in range(4))
        with self.assertRaises(RuntimeError):
            probe.validate_host_log(log=log.replace("frame-0\t0", "frame-0\t0\tunexpected"))

    def test_duplicate_ready_is_rejected(self):
        log = warmup_log() + "\n".join(f"QCUT\tRESULT\tframe-{i}\t0" for i in range(4))
        with self.assertRaises(RuntimeError):
            probe.validate_host_log(log="QCUT\tREADY\t1\n" + log)

    def test_original_uses_only_product_sources(self):
        paths = probe.source_files(original=True)
        self.assertEqual({path.name for path in paths}, set(probe.HOST_SOURCES))
        self.assertTrue(all("jianying-runtime-probe" in str(path) for path in paths))

    def test_bridge_reuses_product_implementation(self):
        paths = probe.source_files(original=False)
        self.assertEqual(paths[0].name, "face_render_consumer_bridge.mm")
        self.assertNotIn("filter-probe.mm", {path.name for path in paths})
        self.assertNotIn("filter-host-main.mm", {path.name for path in paths})

    def test_environment_isolation(self):
        with patch.dict(os.environ, {key: "stale" for key in probe.ENV_KEYS}):
            env = probe.probe_environment(runtime=Path("/runtime"), out=Path("/out"),
                                          width=100, height=80, mode="read", eye_shift=0,
                                          has_replay=False)
        self.assertNotIn("QCUT_FACE_REPLAY", env)
        self.assertNotIn("QCUT_FACE_POINT_SHIFT", env)
        self.assertNotIn("QCUT_TRACE_UPDATES", env)
        self.assertEqual(env["QCUT_CONSUMER_RECORD"], "/out/records.jsonl")

    def test_trace_environment(self):
        env = probe.probe_environment(runtime=Path("/runtime"), out=Path("/out"),
                                      width=100, height=80, mode="trace", eye_shift=-0.01,
                                      has_replay=True)
        self.assertEqual(env["QCUT_FACE_POINT_SHIFT"], "-0.01")
        self.assertEqual(env["QCUT_FACE_REPLAY"], "/out/replay.bin")

    def test_mode_guards(self):
        for mode in ("original", "read", "unknown"):
            with self.assertRaises(ValueError):
                probe.validate_mode(mode=mode, eye_shift=0.01, replay=None)
        with self.assertRaises(ValueError):
            probe.validate_mode(mode="read", eye_shift=0, replay=Path("replay.json"))

    def test_shift_guards(self):
        for shift in (float("nan"), float("inf"), 0.021, -0.021, True):
            with self.assertRaises(ValueError):
                probe.validate_mode(mode="trace", eye_shift=shift, replay=None)

    def test_empty_parameters(self):
        self.assertEqual(probe.parameters_json(text="{}"), "{}")

    def test_parameter_shape(self):
        for text in ("[]", "null", "1", '"key"'):
            with self.assertRaises(ValueError):
                probe.parameters_json(text=text)

    def test_nested_non_finite_parameter(self):
        for text in ('{"v":[{"intensity":NaN}]}', '{"v":Infinity}', '{"v":-Infinity}'):
            with self.assertRaises(ValueError):
                probe.parameters_json(text=text)

    def test_protocol_delimiters(self):
        for delimiter in ("\t", "\n", "\r", "\0"):
            with self.assertRaises(ValueError):
                probe.protocol_path(path=Path("/private/" + delimiter + "name"))

    def test_valid_protocol_path(self):
        path = Path("/private/space in name/frame.rgba")
        self.assertEqual(probe.protocol_path(path=path), path)


class ProvenanceTests(unittest.TestCase):
    def test_wrong_platform_never_reads_libraries(self):
        with patch.object(probe.platform, "system", return_value="Linux"), patch.object(Path, "read_bytes") as read:
            with self.assertRaises(ValueError):
                probe.verify_library(runtime=Path("/runtime"))
            read.assert_not_called()

    def test_core_and_graphics_are_both_verified(self):
        data = b"synthetic library"
        digest = hashlib.sha256(data).hexdigest()
        uuids = [f"{inventory.UUID} (arm64)", f"{probe.GRAPHICS_UUID} (arm64)"]
        with patch.object(probe.platform, "system", return_value="Darwin"), patch.object(
                probe.platform, "machine", return_value="arm64"), patch.object(
                inventory, "LIBRARY_SHA256", digest), patch.object(probe, "GRAPHICS_SHA256", digest), patch.object(
                Path, "read_bytes", return_value=data), patch.object(
                probe.subprocess, "check_output", side_effect=uuids) as execute:
            probe.verify_library(runtime=Path("/runtime"))
        self.assertEqual([call.args[0][-1] for call in execute.call_args_list],
                         ["/runtime/Frameworks/libcccreator.dylib", "/runtime/Frameworks/libAGFX.dylib"])

    def test_graphics_hash_mismatch_is_rejected(self):
        data = b"synthetic core"
        with patch.object(probe.platform, "system", return_value="Darwin"), patch.object(
                probe.platform, "machine", return_value="arm64"), patch.object(
                inventory, "LIBRARY_SHA256", hashlib.sha256(data).hexdigest()), patch.object(
                Path, "read_bytes", side_effect=[data, b"wrong graphics"]), patch.object(
                probe.subprocess, "check_output", return_value=f"{inventory.UUID} (arm64)"):
            with self.assertRaisesRegex(ValueError, "libAGFX.*SHA256"):
                probe.verify_library(runtime=Path("/runtime"))

    def test_graphics_uuid_mismatch_is_rejected(self):
        data = b"synthetic library"
        digest = hashlib.sha256(data).hexdigest()
        with patch.object(probe.platform, "system", return_value="Darwin"), patch.object(
                probe.platform, "machine", return_value="arm64"), patch.object(
                inventory, "LIBRARY_SHA256", digest), patch.object(probe, "GRAPHICS_SHA256", digest), patch.object(
                Path, "read_bytes", return_value=data), patch.object(
                probe.subprocess, "check_output", side_effect=[f"{inventory.UUID} (arm64)", "wrong (arm64)"]):
            with self.assertRaisesRegex(ValueError, "libAGFX.*UUID"):
                probe.verify_library(runtime=Path("/runtime"))

    def test_source_changes_cannot_be_reported_as_verified(self):
        with patch.object(probe, "source_snapshot", return_value={"file": "new"}):
            with self.assertRaisesRegex(RuntimeError, "sources changed"):
                probe.verify_sources(original=False, expected={"file": "old"})

    def test_matching_source_snapshot(self):
        with patch.object(probe, "source_snapshot", return_value={"file": "same"}):
            probe.verify_sources(original=False, expected={"file": "same"})


class PixelEvidenceTests(unittest.TestCase):
    def test_control_failure_is_not_a_success_flag(self):
        controls = {"same-replay": [{"changed_pixels": 0}, {"changed_pixels": 1}]}
        self.assertEqual(e2e.control_failures(controls=controls), ["control pixels changed: same-replay"])

    def test_matching_controls_have_no_failure(self):
        self.assertEqual(e2e.control_failures(controls={"repeat": [{"changed_pixels": 0}]}), [])

    def test_signal_abort_is_not_a_valid_rejection(self):
        with patch.object(Path, "mkdir"), patch.object(Path, "write_bytes"), patch.object(
                Path, "write_text"), patch.object(e2e.subprocess, "run") as execute:
            execute.return_value.returncode = -6
            execute.return_value.stdout = ""
            execute.return_value.stderr = "[research-error] wrong"
            with self.assertRaisesRegex(RuntimeError, "did not reject"):
                e2e.native_rejects(root=Path("/out"), host=Path("/host"), runtime=Path("/runtime"),
                    package=Path("/package"), width=100, height=80, payload=b"x", label="bad")

    def test_identical_pixels(self):
        pixels = np.zeros((8, 10, 4), dtype=np.uint8)
        result = e2e.difference(original=pixels, changed=pixels.copy())
        self.assertEqual(result["changed_pixels"], 0)
        self.assertIsNone(result["bbox"])

    def test_bbox_and_signed_subtraction(self):
        original = np.full((8, 10, 4), 255, dtype=np.uint8)
        changed = original.copy()
        changed[2:5, 3:7, :3] = 0
        result = e2e.difference(original=original, changed=changed)
        self.assertEqual(result["changed_pixels"], 12)
        self.assertEqual(result["max_channel_error"], 255)
        self.assertEqual(result["bbox"], [3, 2, 6, 4])

    def test_alpha_is_not_ignored(self):
        original = np.zeros((8, 10, 4), dtype=np.uint8)
        changed = original.copy()
        changed[0, 0, 3] = 1
        self.assertEqual(e2e.difference(original=original, changed=changed)["changed_pixels"], 1)

    def test_mismatched_image_dimensions(self):
        with self.assertRaises(ValueError):
            e2e.difference(original=np.zeros((8, 10, 4)), changed=np.zeros((8, 11, 4)))

    def test_wrong_channel_count(self):
        pixels = np.zeros((8, 10, 3))
        with self.assertRaises(ValueError):
            e2e.difference(original=pixels, changed=pixels)

    def test_equal_control_is_strict(self):
        zero = np.zeros((8, 10, 4), dtype=np.uint8)
        changed = zero.copy()
        changed[0, 0, 0] = 1
        with patch.object(e2e, "frame", side_effect=[zero, changed, zero, zero, zero, zero, zero, zero]):
            with self.assertRaisesRegex(RuntimeError, "control pixels changed"):
                e2e.equal_frames(baseline=Path("baseline"), candidate=Path("candidate"))


if __name__ == "__main__":
    unittest.main()
