"""Exercise the independent temporal crop stream without a vendor runtime."""
import argparse
import json
import queue
import subprocess
import threading
import unittest

PARSER = argparse.ArgumentParser()
PARSER.add_argument('--executable', required=True)
ARGS, TEST_ARGS = PARSER.parse_known_args()


class StreamTests(unittest.TestCase):
    def run_cli(self, data):
        return subprocess.run([ARGS.executable], input=data, text=True, capture_output=True, timeout=20)

    def test_sequence_and_reset(self):
        first = '10 12 100 60 320 180 -1 -1\n'
        second = '13 19 99 61 320 180 -1 -1\n'
        completed = self.run_cli(first + second + 'reset\n' + first)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        records = [json.loads(line) for line in completed.stdout.split('\n') if line]
        self.assertEqual(records[0], records[3])
        self.assertEqual(records[1]['rectangle'], [10, 13, 98, 60])
        self.assertEqual(records[1]['frame'], 2)
        self.assertEqual(records[2], {'reset': True})

    def test_invalid_input_preserves_successful_prefix(self):
        first = '10 12 100 60 320 180 -1 -1\n'
        for invalid in ['bad\n', '1 2 3\n', '0 0 1 2 320 180 -1 -1\n',
                        '0 0 2 2 320 180 nan 0\n', '0 0 2 2 320 180 2 0\n',
                        '0 0 2 2 320 180 -1 -1 trailing\n']:
            with self.subTest(invalid=invalid):
                completed = self.run_cli(first + invalid + first)
                self.assertNotEqual(completed.returncode, 0)
                records = [json.loads(line) for line in completed.stdout.split('\n') if line]
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]['frame'], 1)
                self.assertIn('state was not advanced', completed.stderr)

    def test_output_flushed_before_input_eof(self):
        process = subprocess.Popen([ARGS.executable], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        output = queue.Queue()
        reader = threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True)
        reader.start()
        try:
            process.stdin.write('10 12 100 60 320 180 -1 -1\n')
            process.stdin.flush()
            record = json.loads(output.get(timeout=20))
            self.assertEqual(record['rectangle'], [10, 12, 100, 60])
            self.assertIsNone(process.poll())
            process.stdin.close()
            self.assertEqual(process.wait(timeout=20), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=20)
            reader.join(timeout=20)
            process.stdout.close()
            process.stderr.close()
            if not process.stdin.closed:
                process.stdin.close()


if __name__ == '__main__':
    unittest.main(argv=['temporal_crop_cli_test.py', *TEST_ARGS])
