"""Portable command protocol tests; no vendor library or assets required."""
import argparse
import json
import subprocess
import unittest

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--executable", required=True)
OPTIONS, REMAINDER = PARSER.parse_known_args()


class MotionProtocol(unittest.TestCase):
    def invoke(self, data):
        return subprocess.run([OPTIONS.executable], input=data, text=True,
                              capture_output=True, check=False, timeout=10)

    def test_real_output_and_order_independence(self):
        command = "run 100 100 50 50 .2 100 -100 0 .5\n"
        alternate = "run 100 100 50 50 .2 0 0 0 1\n"
        result = self.invoke(command + alternate + command)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = [json.loads(line) for line in result.stdout.split("\n") if line]
        self.assertEqual(values, [{"translation": [24.5, -25], "degrees": 0, "scale": .5},
                                 {"translation": [0, 0], "degrees": 0, "scale": 1},
                                 {"translation": [24.5, -25], "degrees": 0, "scale": .5}])

    def test_invalid_lines_produce_no_result(self):
        for line in ["", "run", "run 0 100 0 50 .2 0 0 0 1",
                     "run 100 100 50 50 .2 nan 0 0 1",
                     "run 100 100 50 50 .2 0 0 181 1",
                     "run 100 100 50 50 .2 0 0 0 1 trailing"]:
            with self.subTest(line=line):
                result = self.invoke(line + "\n")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")

    def test_complete_final_line_without_newline(self):
        result = self.invoke("run 1 4 .5 2 .2 4 8 45 0")
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["translation"], [4, 8])
        self.assertEqual(value["degrees"], 45)
        self.assertAlmostEqual(value["scale"], .2)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *REMAINDER])
