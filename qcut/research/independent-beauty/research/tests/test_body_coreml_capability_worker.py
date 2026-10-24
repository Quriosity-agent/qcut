import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_coreml_capability_worker as worker


class CapabilityWorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.runtime = Path(self.directory.name)
        self.asset = self.runtime / 'research' / worker.ASSET
        self.asset.parent.mkdir(parents=True)
        self.asset.write_bytes(b'original CPU bytes')
        self.receipt = {'identity': {'execution': {'networks': {'cpu': {
            'asset': worker.ASSET,
            'assetSha256': hashlib.sha256(self.asset.read_bytes()).hexdigest(),
        }}}}}
        self.inspect = Mock(return_value=self.receipt)

    def line(self, *, identity='request-1', **extra):
        return (json.dumps({'id': identity, 'report': str(self.runtime / (identity + '.json')),
                            **extra}) + '\n').encode()

    def serve(self, *, lines):
        output = io.StringIO()
        worker.serve(runtime=self.runtime, input_stream=io.BytesIO(lines),
                     output_stream=output, inspect=self.inspect)
        return [json.loads(line) for line in output.getvalue().splitlines()]

    def test_revalidates_each_request_without_accepting_image_state(self):
        replies = self.serve(lines=self.line() + self.line(identity='request-2'))
        self.assertEqual(replies, [{'id': 'request-1', 'ok': True}, {'id': 'request-2', 'ok': True}])
        self.assertEqual(self.inspect.call_count, 2)
        self.assertEqual(json.loads((self.runtime / 'request-1.json').read_text()), self.receipt)
        self.assertEqual(json.loads((self.runtime / 'request-2.json').read_text()), self.receipt)
        self.inspect.assert_called_with(runtime=self.runtime.resolve())

    def test_cpu_cache_cannot_hide_a_same_size_same_mtime_asset_change(self):
        original_stat = self.asset.stat()

        def inspect(*, runtime):
            if self.inspect.call_count == 2:
                self.asset.write_bytes(b'modified CPU bytes')
                os.utime(self.asset, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
                self.assertEqual(self.asset.stat().st_size, original_stat.st_size)
                self.assertEqual(self.asset.stat().st_mtime_ns, original_stat.st_mtime_ns)
            return self.receipt

        self.inspect.side_effect = inspect
        replies = self.serve(lines=self.line() + self.line(identity='changed') + self.line(identity='ignored'))
        self.assertTrue(replies[0]['ok'])
        self.assertFalse(replies[1]['ok'])
        self.assertIn('CPU asset changed', replies[1]['error'])
        self.assertEqual(self.inspect.call_count, 2)
        self.assertFalse((self.runtime / 'changed.json').exists())
        self.assertFalse((self.runtime / 'ignored.json').exists())

    def test_rejects_image_sequence_and_outer_request_diagnostics(self):
        for extra in ({'image': '/source'}, {'sequence': {}}, {'outerRequestId': 'outer'}, {'unknown': 1}):
            with self.subTest(extra=extra):
                replies = self.serve(lines=self.line(**extra))
                self.assertFalse(replies[0]['ok'])
                self.assertIn('only id and report', replies[0]['error'])
        self.inspect.assert_not_called()

    def test_rejects_ambiguous_malformed_or_unbounded_lines(self):
        for line in (b'{"id":"a","id":"b","report":"/a"}\n', b'[]\n', b'{\n',
                     self.line().rstrip(b'\n'), b'x' * (worker.MAX_REQUEST_BYTES + 1)):
            with self.subTest(line=line[:100]):
                self.assertFalse(self.serve(lines=line)[0]['ok'])
        self.inspect.assert_not_called()

    def test_requires_bounded_id_and_absolute_report_path(self):
        for changes in ({'id': ''}, {'id': 'x' * 129}, {'id': '../escape'},
                        {'report': 'relative.json'}, {'report': None}, {'report': '/' + 'x' * 4096}):
            request = {'id': 'one', 'report': str(self.runtime / 'one.json'), **changes}
            with self.subTest(changes=changes):
                self.assertFalse(self.serve(lines=(json.dumps(request) + '\n').encode())[0]['ok'])
        self.inspect.assert_not_called()

    def test_failed_inspection_is_bounded_and_ends_process_contract(self):
        self.inspect.side_effect = RuntimeError('private model mismatch ' + 'x' * 10000)
        replies = self.serve(lines=self.line() + self.line(identity='ignored'))
        self.assertEqual(len(replies), 1)
        self.assertFalse(replies[0]['ok'])
        self.assertEqual(len(replies[0]['error']), worker.MAX_ERROR_CHARACTERS)
        self.inspect.assert_called_once()
        self.assertFalse((self.runtime / 'request-1.json').exists())

    def test_receipt_write_failure_is_not_success(self):
        replies = self.serve(lines=self.line(report=str(self.runtime / 'missing' / 'report.json')))
        self.assertFalse(replies[0]['ok'])
        self.assertIn('FileNotFoundError', replies[0]['error'])

    def test_eof_does_no_work(self):
        self.assertEqual(self.serve(lines=b''), [])
        self.inspect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
