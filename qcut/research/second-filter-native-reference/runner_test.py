import math
from pathlib import Path
import tempfile
import unittest

import runner


class RunnerTests(unittest.TestCase):
    def test_protocol_preserves_time_and_numeric_parameter(self):
        fields = runner.render_command("4", 0.125, "/input file", "/output", 0.37).rstrip("\n").split("\t")
        self.assertEqual(fields, ["render", "4", "0.125", "/input file", "/output", '{"intensity":0.37}'])

    def test_rejects_protocol_injection_and_nonfinite_parameters(self):
        for value in ("", "x\ty", "x\ny", "x\ry", "x\0y"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.render_command(value, 0, "/input", "/output", 1)
        for timestamp in (-1, math.inf, math.nan, 9e12):
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                runner.render_command("1", timestamp, "/input", "/output", 1)
        for strength in (-0.01, 1.01, math.inf, math.nan):
            with self.subTest(strength=strength), self.assertRaises(ValueError):
                runner.render_command("1", 0, "/input", "/output", strength)

    def test_protocol_requires_successful_ordered_complete_results(self):
        ready = "QCUT\tREADY\t1\n[filter] post-frame feature params result = 0\n"
        good = "QCUT\tRESULT\t1\t0\nQCUT\tRESULT\t2\t0\n"
        runner.verify_protocol(ready + good, "", ["1", "2"])
        for bad in ("", good.splitlines()[0], good + good, good.replace("1\t0", "1\t1"),
                    "QCUT\tRESULT\t2\t0\nQCUT\tRESULT\t1\t0\n"):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                runner.verify_protocol(ready + bad, "", ["1", "2"])
        with self.assertRaises(RuntimeError):
            runner.verify_protocol(good, "", ["1", "2"])
        with self.assertRaises(RuntimeError):
            runner.verify_protocol(ready + good, "attempt to perform arithmetic on a string", ["1", "2"])

    def test_fixtures_cover_threshold_and_are_opaque(self):
        data = runner.fixture_bytes("threshold", 8, 2)
        self.assertEqual(data[:32], bytes(sum(([v, v, v, 255] for v in (0, 1, 126, 127, 128, 129, 254, 255)), [])))
        for kind, width, height in runner.FIXTURES:
            data = runner.fixture_bytes(kind, width, height)
            self.assertEqual(len(data), width * height * 4)
            self.assertEqual(set(data[3::4]), {255})
        for kind, width, height in (("wrong", 2, 2), ("chart", 1, 2), ("chart", 4096, 4096)):
            with self.assertRaises(ValueError):
                runner.fixture_bytes(kind, width, height)

    def test_package_identity_is_ordered_content_sensitive_and_rejects_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "b").write_bytes(b"second")
            (root / "a").write_bytes(b"first")
            first = runner.package_identity(root)
            self.assertEqual(list(first["files"]), ["a", "b"])
            (root / "a").write_bytes(b"changed")
            self.assertNotEqual(runner.package_identity(root)["sha256"], first["sha256"])
            try:
                (root / "link").symlink_to(root / "a")
            except OSError:
                return
            with self.assertRaises(ValueError):
                runner.package_identity(root)

    def test_exact_frame_length_rejects_short_or_extra_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "frame.rgba"
            for size in (15, 17):
                path.write_bytes(bytes(size))
                with self.assertRaises(RuntimeError):
                    runner.read_frame(path, 2, 2)
            path.write_bytes(bytes(range(16)))
            self.assertEqual(runner.read_frame(path, 2, 2), bytes(range(16)))

    def test_raw_evidence_cannot_be_written_in_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            runner.run_matrix(Path("/repo"), Path("/runtime"), Path("/package"), "unused", Path("/repo/output"))

    def test_fixed_strengths_reject_all_identity_and_partial_collisions(self):
        runner.verify_fixed_references({0.0: "source", 0.37: "partial", 0.5: "half", 1.0: "full"}, "source")
        for bad in ({strength: "source" for strength in runner.STRENGTHS},
                    {0.0: "source", 0.37: "same", 0.5: "same", 1.0: "full"},
                    {0.0: "source", 0.37: "partial", 1.0: "full"},
                    {0.0: "wrong", 0.37: "partial", 0.5: "half", 1.0: "full"}):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                runner.verify_fixed_references(bad, "source")


if __name__ == "__main__":
    unittest.main()
