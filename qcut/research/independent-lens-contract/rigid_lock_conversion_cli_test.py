"""Portable command protocol tests; no vendor library or assets required."""
import argparse
import json
import subprocess
import unittest

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--executable", required=True)
OPTIONS, REMAINDER = PARSER.parse_known_args()


class RigidLockProtocol(unittest.TestCase):
    def invoke(self, data):
        return subprocess.run([OPTIONS.executable], input=data, text=True,
                              capture_output=True, check=False, timeout=10)

    def test_real_output_and_order_independence(self):
        forward = "to-lock 1920 1080 960 540 .25 -.5 0 .5\n"
        reverse = "to-rigid 1920 1080 960 540 .25 -.5 0 .5\n"
        result = self.invoke(forward + reverse + forward)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = [json.loads(line) for line in result.stdout.split("\n") if line]
        self.assertEqual(values[0], {"translation": [-480, 540], "degrees": 0, "scale": 2})
        self.assertEqual(values[2], values[0])
        self.assertEqual(values[1]["degrees"], 0)
        self.assertEqual(values[1]["scale"], 2)
        self.assertNotEqual(values[1]["translation"], values[0]["translation"])

    def test_the_pair_is_not_a_round_trip(self):
        result = self.invoke("to-lock 1920 1080 960 540 0 0 45 1\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        locked = json.loads(result.stdout)
        self.assertAlmostEqual(locked["degrees"], 42.1861, places=3)
        line = "to-rigid 1920 1080 960 540 {} {} {} {}\n".format(
            locked["translation"][0], locked["translation"][1], locked["degrees"], locked["scale"])
        returned = json.loads(self.invoke(line).stdout)
        self.assertAlmostEqual(returned["degrees"], 39.6338615, places=3)

    def test_invalid_lines_produce_no_result(self):
        for line in ["", "to-lock", "roundtrip 1920 1080 960 540 0 0 0 1",
                     "to-lock 0 1080 0 540 0 0 0 1",
                     "to-rigid 1920 1080 960 540 0 0 0 0",
                     "to-lock 1920 1080 960 540 nan 0 0 1",
                     "to-lock 1920 1080 960 540 0 0 361 1",
                     "to-rigid 1920 1080 960 540 0 0 0 1 trailing"]:
            with self.subTest(line=line):
                result = self.invoke(line + "\n")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")

    def test_complete_final_line_without_newline(self):
        result = self.invoke("to-lock 1 1 .5 .5 0 0 0 2")
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["translation"], [0, 0])
        self.assertEqual(value["degrees"], 0)
        self.assertEqual(value["scale"], .5)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *REMAINDER])
