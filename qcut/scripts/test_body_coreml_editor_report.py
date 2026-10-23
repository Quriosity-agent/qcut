"""Saved-evidence integrity checks; no models, Electron, or inference required."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location('editor_report', Path(__file__).with_name('body-coreml-editor-report.py'))
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


class EvidenceContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def fixture(self, *, backend='coreml', frame=0, request_frame=0, journal_frames=None):
        identity = {'profile': 'swing-coreml-v1', 'generation': 'a' * 64}
        routes = [{'network': 'refine', 'backend': backend}]
        body = {'executionIdentity': identity, 'executionRoutes': routes, 'frame': frame}
        worker = self.root / 'worker.json'
        worker.write_text(json.dumps({'stages': [{'script': 'body_smart_render.py', 'receipt': body}]}))
        history = [{'frame': 0, 'input': 'b' * 64, 'routes': routes}] if journal_frames is None else journal_frames
        journal = self.root / 'journal.json'
        journal.write_text(json.dumps({'identity': identity, 'session': identity['generation'], 'frames': history}))
        evidence = self.root / 'execution.json'
        evidence.write_text(json.dumps({'referenceRoutesInjected': False, 'executions': [{
            'file': str(worker), 'sha256': REPORT.file_sha(path=worker), 'frame': frame,
            'routes': routes, 'sequence': {'frame': request_frame, 'session': identity['generation'],
                'executionProfile': identity['profile'], 'executionGeneration': identity['generation']}}],
            'journals': [{'file': str(journal), 'sha256': REPORT.file_sha(path=journal), 'frames': history}]}))
        return evidence

    def test_actual_coreml_with_complete_journal(self):
        result = REPORT.verify_execution(path=self.fixture(), count=1)
        self.assertEqual(result['coremlPassesInObservedReports'], 1)

    def test_cpu_only_cannot_claim_coreml(self):
        with self.assertRaisesRegex(ValueError, 'does not cover'):
            REPORT.verify_execution(path=self.fixture(backend='cpu'), count=1)

    def test_request_frame_must_match_actual_frame(self):
        with self.assertRaisesRegex(ValueError, 'request frame'):
            REPORT.verify_execution(path=self.fixture(request_frame=1), count=1)

    def test_missing_journal_frame_rejected(self):
        with self.assertRaisesRegex(ValueError, 'complete route journal'):
            REPORT.verify_execution(path=self.fixture(journal_frames=[]), count=1)

    def test_tampered_report_rejected(self):
        evidence = self.fixture()
        (self.root / 'worker.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            REPORT.verify_execution(path=evidence, count=1)

    def test_rgba_shape_and_content_checks(self):
        pixels = np.full((3, 2, 4), 127, dtype=np.uint8)
        target = self.root / 'frame.png'
        Image.fromarray(pixels).save(target)
        digest = hashlib.sha256(pixels.tobytes()).hexdigest()
        self.assertTrue(np.array_equal(REPORT.checked_rgba(path=target, width=2, height=3, expected=digest), pixels))
        with self.assertRaisesRegex(ValueError, 'dimensions differ'):
            REPORT.checked_rgba(path=target, width=3, height=2, expected=digest)
        with self.assertRaisesRegex(ValueError, 'RGBA differs'):
            REPORT.checked_rgba(path=target, width=2, height=3, expected='0' * 64)


if __name__ == '__main__':
    unittest.main()
