"""Saved-evidence integrity checks; no models, Electron, or inference required."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def fixture(self, *, backend='coreml', frame=0, request_frame=0, journal_frames=None, generation='a' * 64):
        identity = {'profile': 'swing-coreml-v1', 'generation': generation}
        routes = [{'network': 'refine', 'backend': backend}]
        hashes = {'inputRgbaSha256': 'b' * 64, 'outputRgbaSha256': 'c' * 64}
        isolation = {'loaded_images': ['/usr/lib/libSystem.B.dylib'], 'private_native_images': []}
        body = {'executionIdentity': identity, 'executionRoutes': routes, 'frame': frame, **hashes, 'independence': isolation}
        worker = self.root / 'worker.json'
        worker.write_text(json.dumps({'version': 1, 'passed': True, 'outputDimensions': [1080, 1920],
            'nativeGeometryUsed': False, 'nativeInputsUsed': False, 'nativeFallbackUsed': False,
            **hashes, 'independence': isolation,
            'stages': [{'script': 'body_smart_render.py', 'receipt': body, **hashes}]}))
        history = [{'frame': 0, 'input': 'b' * 64, 'routes': routes}] if journal_frames is None else journal_frames
        journal = self.root / 'journal.json'
        journal.write_text(json.dumps({'identity': identity, 'session': identity['generation'], 'frames': history}))
        evidence = self.root / 'execution.json'
        evidence.write_text(json.dumps({'referenceRoutesInjected': False, 'executions': [{
            'file': str(worker), 'sha256': REPORT.file_sha(path=worker), 'frame': frame,
            'profile': identity['profile'], 'generation': identity['generation'],
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

    def test_complete_cpu_sequence_cannot_borrow_partial_coreml_generation(self):
        record = {'referenceRoutesInjected': False, 'executions': [], 'journals': []}
        base = self.root
        for name, backend, generation, frame in [('a0', 'cpu', 'a' * 64, 0), ('a1', 'cpu', 'a' * 64, 1), ('b0', 'coreml', 'b' * 64, 0)]:
            self.root = base / name
            self.root.mkdir()
            history = [{'frame': value, 'input': 'b' * 64, 'routes': [{'network': 'refine', 'backend': backend}]} for value in ([0, 1] if backend == 'cpu' else [0])]
            path = self.fixture(backend=backend, generation=generation, frame=frame, request_frame=frame, journal_frames=history)
            part = json.loads(path.read_text())
            record['executions'].extend(part['executions'])
            record['journals'].extend(part['journals'])
        target = base / 'mixed.json'
        target.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'generation has no CoreML'):
            REPORT.verify_execution(path=target, count=2)

    def test_execution_must_match_export_pixels(self):
        with self.assertRaisesRegex(ValueError, 'matches the exported RGBA'):
            REPORT.verify_execution(path=self.fixture(), count=1, expected_rgba=['d' * 64])
        REPORT.verify_execution(path=self.fixture(), count=1, expected_rgba=['c' * 64])

    def test_legacy_operation_evidence_cannot_claim_acceptance(self):
        (self.root / 'e2e-evidence.json').write_text(json.dumps({'status': 'passed', 'bodyVideoProfile': 'swing-coreml-v1', 'frames': 1}))
        with self.assertRaisesRegex(ValueError, 'schema version 2'):
            REPORT.build_operations(evidence=self.root, output=self.root / 'report', ffmpeg='not-run')

    def test_decoded_video_fps_and_frame_count(self):
        target = self.root / 'video.mp4'
        target.write_bytes(b'synthetic')
        output = '#tb 0: 1/30\n#dimensions 0: 2x3\n0,0,0,1,24,' + 'a' * 32 + '\n'
        with patch.object(REPORT.subprocess, 'run') as run:
            run.return_value.stdout = output
            REPORT.verify_video(path=target, count=1, width=2, height=3, fps=30, ffmpeg='not-run')
            with self.assertRaisesRegex(ValueError, 'frame count'):
                REPORT.verify_video(path=target, count=2, width=2, height=3, fps=30, ffmpeg='not-run')
            with self.assertRaisesRegex(ValueError, 'fps/timestamps'):
                REPORT.verify_video(path=target, count=1, width=2, height=3, fps=25, ffmpeg='not-run')

    def test_restart_requires_same_complete_generation_and_identity(self):
        a = {'verifiedCompleteGenerations': ['a'], 'identities': {'a': {'model': 'original'}}}
        b = {'verifiedCompleteGenerations': ['b'], 'identities': {'b': {'model': 'original'}}}
        changed = {'verifiedCompleteGenerations': ['a'], 'identities': {'a': {'model': 'changed'}}}
        self.assertEqual(REPORT.reused_execution_generations(executions={'initial': a, 'before': a, 'after': a}), ['a'])
        self.assertEqual(REPORT.reused_execution_generations(executions={'initial': a, 'before': a, 'after': b}), [])
        self.assertEqual(REPORT.reused_execution_generations(executions={'initial': a, 'before': a, 'after': changed}), [])


if __name__ == '__main__':
    unittest.main()
