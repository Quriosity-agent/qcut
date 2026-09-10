"""Portable command protocol tests; no vendor library or assets required."""
import argparse
import json
import subprocess
import unittest

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--executable", required=True)
OPTIONS, REMAINDER = PARSER.parse_known_args()


class MergeUtilProtocol(unittest.TestCase):
    def invoke(self, data):
        return subprocess.run([OPTIONS.executable], input=data, text=True,
                              capture_output=True, check=False, timeout=10)

    def test_real_output_and_order_independence(self):
        unit = "merge 1 1 .8 1 0 0 0 0 0 1 1\n"
        scaled = "merge 1920 1080 .8 2 0 .25 -.5 0 0 1920 1080\n"
        result = self.invoke(unit + scaled + unit)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = [json.loads(line) for line in result.stdout.split("\n") if line]
        self.assertEqual(values[0]["vector"], [1, 0, 0, 0])
        self.assertEqual(values[2], values[0])
        self.assertEqual(values[1]["scale"], 2)
        self.assertEqual(values[1]["translation"], [.25, -.5])

    def test_only_the_box_midpoints_reach_the_result(self):
        whole = "merge 1920 1080 .8 1 30 .1 -.2 0 0 1920 1080\n"
        halved = "merge 1920 1080 .8 1 30 .1 -.2 480 270 1440 810\n"
        moved = "merge 1920 1080 .8 1 30 .1 -.2 0 0 1900 1080\n"
        result = self.invoke(whole + halved + moved)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = [json.loads(line) for line in result.stdout.split("\n") if line]
        self.assertEqual(values[1], values[0])
        self.assertNotEqual(values[2], values[0])

    def test_the_discarded_setting_field_never_moves_the_result(self):
        base = "merge 1920 1080 .8 1 30 .1 -.2 100 80 1000 700\n"
        poisoned = "merge 1920 1080 -1e30 1 30 .1 -.2 100 80 1000 700\n"
        result = self.invoke(base + poisoned)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = [json.loads(line) for line in result.stdout.split("\n") if line]
        self.assertEqual(values[1], values[0])

    def test_invalid_lines_produce_no_result(self):
        for line in ["", "merge", "chain 1920 1080 .8 1 0 0 0 0 0 1920 1080",
                     "merge 0 1080 .8 1 0 0 0 0 0 1920 1080",
                     "merge 1920 1080 .8 0 0 0 0 0 0 1920 1080",
                     "merge 1920 1080 .8 1 0 nan 0 0 0 1920 1080",
                     "merge 1920 1080 .8 1 0 0 0 -4000 0 -4000 0",
                     "merge 1920 1080 .8 1 0 0 0 0 0 1920 1080 trailing"]:
            with self.subTest(line=line):
                result = self.invoke(line + "\n")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")

    def test_complete_final_line_without_newline(self):
        result = self.invoke("merge 1 1 .8 1 0 0 0 0 0 1 1")
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["vector"], [1, 0, 0, 0])


if __name__ == "__main__":
    unittest.main(argv=[__file__, *REMAINDER])
