"""Python/native replay timing contracts using synthetic no-face payloads only.

The native harness calls loadReplay directly, never the renamed render entry
point or a vendor SDK. Compile/link against macOS system frameworks only.
"""
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer

ROOT = Path(__file__).resolve().parent
TIME_LIMIT = 60_000_000
IMAGE_HASH = "a" * 64
TIMING_CASES = (
    ("default zero", [0], None, True),
    ("default endpoint", [100_000], None, True),
    ("default exceeded", [100_001], None, False),
    ("default dynamic denied", [200_000], None, False),
    ("default upper denied", [TIME_LIMIT], None, False),
    ("explicit default", [100_000], 100_000, True),
    ("explicit default exceeded", [100_001], 100_000, False),
    ("intermediate endpoint", [200_000], 200_000, True),
    ("intermediate exceeded", [200_001], 200_000, False),
    ("dynamic zero", [0], TIME_LIMIT, True),
    ("dynamic 200ms", [200_000], TIME_LIMIT, True),
    ("dynamic endpoint", [TIME_LIMIT], TIME_LIMIT, True),
    ("dynamic exceeded", [TIME_LIMIT + 1], TIME_LIMIT, False),
    ("duplicate seeks", [0, 0, 200_000, 200_000, TIME_LIMIT], TIME_LIMIT, True),
    ("default decreasing", [100, 99], None, False),
    ("dynamic decreasing", [200_000, 199_999], TIME_LIMIT, False),
    ("default negative", [-1], None, False),
    ("dynamic negative", [-1], TIME_LIMIT, False),
    ("signed minimum", [-2**63], TIME_LIMIT, False),
    ("signed maximum", [2**63 - 1], TIME_LIMIT, False),
)
INVALID_LIMITS = (True, False, None, -1, 0, 99_999, TIME_LIMIT + 1, 2**63, 10**100,
                  100_000.0, TIME_LIMIT + 0.5, float("nan"), float("inf"), "100000", "", "bad")
INVALID_ENV = ("60000001", "99999", "0", "-1", "100000.0", "60000000.5", "", "18446744073709551616",
               "9" * 200, "bad", "true", "+100000", " 100000", "100000 ", "100000\n", "1e5", "0x186a0",
               "100_000", "100000us", "\uff11\uff10\uff10\uff10\uff10\uff10")
HARNESS = r'''
#define main qcutUnusedFaceConsumerMain
#include "face_render_consumer_bridge.mm"
#undef main

int main(int argc, char* argv[]) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::runtime_error("synthetic payload path required");
      loadReplay(argv[1], 1, 1);
      std::cout << "OK\t" << replay.size();
      for (const auto& frame : replay)
        std::cout << '\t' << frame.timestamp << ':' << frame.faces.size();
      std::cout << '\n';
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 2;
    }
  }
}
'''


def fixture(*, timestamps):
    return dict(version=1, coordinate_space=consumer.COORDINATE_SPACE, width=1, height=1,
                image_sha256=IMAGE_HASH, frames=[dict(timestamp_us=stamp, faces=[]) for stamp in timestamps])


def binary(*, timestamps):
    return struct.pack("<8sIII", consumer.MAGIC, 1, 1, len(timestamps)) + b"".join(
        struct.pack("<qI", stamp, 0) for stamp in timestamps)


def validate(*, timestamps, maximum=None):
    options = {} if maximum is None else dict(maximum_timestamp_us=maximum)
    return consumer.validate_replay(value=fixture(timestamps=timestamps), width=1, height=1,
                                    image_hash=IMAGE_HASH, **options)


def clean_environment(*, maximum=None):
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(("QCUT_", "DYLD_", "MTL_")) and key != "LD_PRELOAD"}
    if maximum is not None:
        environment["QCUT_FACE_REPLAY_MAX_TIME_US"] = str(maximum)
    return environment


class PythonTimingTests(unittest.TestCase):
    def test_exported_upper_bound_and_shared_timing_matrix(self):
        self.assertEqual(consumer.REPLAY_TIME_LIMIT_US, TIME_LIMIT)
        for name, timestamps, maximum, accepted in TIMING_CASES:
            with self.subTest(case=name):
                if accepted:
                    self.assertEqual(validate(timestamps=timestamps, maximum=maximum), binary(timestamps=timestamps))
                else:
                    with self.assertRaisesRegex(ValueError, "timing"):
                        validate(timestamps=timestamps, maximum=maximum)

    def test_limit_requires_bounded_integer_not_boolean_or_coercible_value(self):
        for maximum in INVALID_LIMITS:
            with self.subTest(maximum=maximum), self.assertRaisesRegex(ValueError, "typed replay time limit"):
                consumer.validate_replay(value=fixture(timestamps=[0]), width=1, height=1, image_hash=IMAGE_HASH,
                                         maximum_timestamp_us=maximum)

    def test_invalid_timestamp_types_and_frame_counts_still_fail(self):
        for stamp in (True, False, None, "0", 0.5, float("nan"), float("inf"), 10**100):
            with self.subTest(timestamp=stamp), self.assertRaisesRegex(ValueError, "timing"):
                validate(timestamps=[stamp], maximum=TIME_LIMIT)
        for count in (0, 65):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "1-64"):
                validate(timestamps=[0] * count, maximum=TIME_LIMIT)

    def test_owned_capture_preserves_default_and_forwards_dynamic_limit(self):
        events = [dict(event="owned_face_conversion", timestamp_us=stamp, faces_before=[])
                  for stamp in (0, 200_000, TIME_LIMIT)]
        options = dict(events=events, width=1, height=1, image_hash=IMAGE_HASH)
        with self.assertRaisesRegex(ValueError, "timing"):
            owned.capture_replay(**options)
        self.assertEqual(owned.capture_replay(**options, maximum_timestamp_us=TIME_LIMIT),
                         fixture(timestamps=[0, 200_000, TIME_LIMIT]))
        for maximum in (True, 99_999, TIME_LIMIT + 1):
            with self.subTest(maximum=maximum), self.assertRaisesRegex(ValueError, "typed replay time limit"):
                owned.capture_replay(**options, maximum_timestamp_us=maximum)

    def test_python_limit_does_not_inherit_native_environment_override(self):
        with patch.dict(os.environ, {"QCUT_FACE_REPLAY_MAX_TIME_US": str(TIME_LIMIT)}):
            with self.assertRaisesRegex(ValueError, "timing"):
                validate(timestamps=[200_000])


@unittest.skipUnless(sys.platform == "darwin", "native loader harness requires macOS system frameworks")
class NativeTimingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("xcrun"):
            raise RuntimeError("native timing tests require the macOS compiler")
        temporary = tempfile.TemporaryDirectory(prefix="qcut-replay-timing-")
        cls.addClassCleanup(temporary.cleanup)
        cls.directory = Path(temporary.name).resolve()
        harness = cls.directory / "timing-harness.mm"
        harness.write_text(HARNESS)
        cls.executable = cls.directory / "timing-harness"
        support = [path for path in consumer.source_files(original=False) if path.name != "face_render_consumer_bridge.mm"]
        command = ["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-g", "-O1", "-Wall", "-Wextra", "-Werror",
                   "-Wno-deprecated-declarations", "-I", str(ROOT), str(harness), *map(str, support)]
        for framework in ("AppKit", "CoreVideo", "IOSurface", "OpenGL", "Foundation", "Metal", "QuartzCore"):
            command.extend(["-framework", framework])
        result = subprocess.run([*command, "-o", str(cls.executable)], env=clean_environment(),
                                capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError("synthetic loader harness compilation failed:\n" + result.stderr.decode("utf-8", errors="replace"))

    def native(self, *, payload, maximum=None):
        temporary = tempfile.TemporaryDirectory(dir=self.directory)
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "synthetic-replay.bin"
        path.write_bytes(payload)
        return subprocess.run([str(self.executable), str(path)], env=clean_environment(maximum=maximum),
                              capture_output=True, timeout=10)

    def assert_loaded(self, *, result, timestamps):
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = "OK\t" + str(len(timestamps)) + "".join(f"\t{stamp}:0" for stamp in timestamps) + "\n"
        self.assertEqual(result.stdout, expected.encode("ascii"))
        self.assertEqual(result.stderr, b"")

    def assert_rejected(self, *, result, message):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, b"")
        self.assertIn(message.encode("ascii"), result.stderr)

    def test_native_and_python_share_timing_and_binary_matrix(self):
        for name, timestamps, maximum, accepted in TIMING_CASES:
            with self.subTest(case=name):
                payload = binary(timestamps=timestamps)
                result = self.native(payload=payload, maximum=maximum)
                if accepted:
                    self.assertEqual(validate(timestamps=timestamps, maximum=maximum), payload)
                    self.assert_loaded(result=result, timestamps=timestamps)
                else:
                    self.assert_rejected(result=result, message="timestamp or face count")
                    with self.assertRaisesRegex(ValueError, "timing"):
                        validate(timestamps=timestamps, maximum=maximum)

    def test_malformed_native_environment_rejects_even_zero_timestamp(self):
        for maximum in INVALID_ENV:
            with self.subTest(environment=maximum):
                self.assert_rejected(result=self.native(payload=binary(timestamps=[0]), maximum=maximum), message="time limit")

    def test_digits_only_environment_accepts_leading_zeroes_and_exact_bounds(self):
        for maximum, stamp in (("000100000", 100_000), ("00060000000", TIME_LIMIT), ("100001", 100_001)):
            with self.subTest(environment=maximum):
                self.assert_loaded(result=self.native(payload=binary(timestamps=[stamp]), maximum=maximum), timestamps=[stamp])

    def test_trailing_and_truncated_payloads_remain_rejected_under_both_limits(self):
        payload = binary(timestamps=[0])
        for maximum in (None, TIME_LIMIT):
            for suffix in (b"\0", b"trailing", struct.pack("<qI", 1, 0)):
                with self.subTest(maximum=maximum, suffix=suffix):
                    self.assert_rejected(result=self.native(payload=payload + suffix, maximum=maximum), message="trailing replay")
            for truncated in (b"", payload[:19], payload[:-1]):
                with self.subTest(maximum=maximum, truncated=len(truncated)):
                    self.assert_rejected(result=self.native(payload=truncated, maximum=maximum), message="truncated replay")

    def test_zero_and_excess_frame_count_still_rejected(self):
        for count in (0, 65):
            with self.subTest(count=count):
                self.assert_rejected(result=self.native(payload=binary(timestamps=[0] * count), maximum=TIME_LIMIT),
                                     message="frame count")

    def test_ambient_replay_and_library_injection_environment_is_removed(self):
        ambient = {"QCUT_FACE_REPLAY_MAX_TIME_US": str(TIME_LIMIT), "QCUT_FACE_REPLAY": "/never/open/vendor",
                   "DYLD_INSERT_LIBRARIES": "/never/load/vendor", "DYLD_LIBRARY_PATH": "/never/load/vendor",
                   "LD_PRELOAD": "/never/load/vendor", "MTL_CAPTURE_ENABLED": "1"}
        with patch.dict(os.environ, ambient):
            environment = clean_environment()
            self.assertFalse(any(key.startswith(("QCUT_", "DYLD_", "MTL_")) or key == "LD_PRELOAD" for key in environment))
            self.assert_loaded(result=self.native(payload=binary(timestamps=[100_000])), timestamps=[100_000])
            self.assert_rejected(result=self.native(payload=binary(timestamps=[100_001])), message="timestamp or face count")


if __name__ == "__main__":
    unittest.main()
