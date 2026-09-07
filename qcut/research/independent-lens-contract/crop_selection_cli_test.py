"""Exercise the owned crop-selection stream as an external consumer."""

import argparse
import json
import subprocess
import threading
import unittest


class CropSelectionCli(unittest.TestCase):
    executable = ""

    def run_commands(self, commands):
        return subprocess.run(
            [self.executable], input=commands, text=True, capture_output=True, timeout=10, check=False
        )

    def test_lifecycle_and_output(self):
        result = self.run_commands(
            "init 80 40 .8 .5 .5\nmissing\nbox 10 5 74 38\nmissing\n"
            "init 80 40 .8 0 1\nmissing\nreset\ninit 80 40 .8 .5 .5\nmissing\n"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[1]["bounds"], [2, 1, 78, 39])
        self.assertEqual(rows[3]["adjusted_detection"], rows[2]["adjusted_detection"])
        self.assertEqual(rows[5]["frame"], 1)
        self.assertEqual(rows[5]["adjusted_detection"], rows[2]["adjusted_detection"])
        self.assertEqual(rows[8], rows[1])

    def test_rejections(self):
        for command in (
            "missing\n", "init 15 40 .8 .5 .5\n", "init 80 40 .8 .5 .5 extra\n",
            "init 80 40 .8 .5 .5\nbox 1 2 3\n", "init 80 40 .8 .5 .5\nbox 4 2 3 8\n",
            "init 80 40 .8 .5 .5\nreset\nmissing\n", "unknown\n",
        ):
            with self.subTest(command=command):
                result = self.run_commands(command)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("state was not advanced", result.stderr)

    def test_flush_before_eof(self):
        process = subprocess.Popen(
            [self.executable], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        lines = []
        try:
            process.stdin.write("init 80 40 .8 .5 .5\nmissing\n")
            process.stdin.flush()
            reader = threading.Thread(target=lambda: lines.extend([process.stdout.readline(), process.stdout.readline()]), daemon=True)
            reader.start()
            reader.join(timeout=10)
            self.assertFalse(reader.is_alive(), "CLI waited for EOF instead of flushing each command")
            self.assertEqual(json.loads(lines[1])["bounds"], [2, 1, 78, 39])
            process.stdin.close()
            self.assertEqual(process.wait(timeout=10), 0)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", required=True)
    arguments = parser.parse_args()
    CropSelectionCli.executable = arguments.executable
    unittest.main(argv=[__file__])
