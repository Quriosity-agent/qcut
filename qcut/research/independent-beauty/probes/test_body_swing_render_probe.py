import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np

import body_swing_render_probe as probe


class SourceManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manifest = self.root / 'sources.json'
        self.rgba = np.full((3, 2, 4), 255, np.uint8)
        self.source = self.root / 'original.rgba'
        self.rgba.tofile(self.source)
        self.value = {'width': 2, 'height': 3,
                      'inputs': {'original.rgba': hashlib.sha256(self.rgba.tobytes()).hexdigest()},
                      'timestamps': [0]}

    def write(self):
        self.manifest.write_text(json.dumps(self.value))

    def test_relative_source_paths_resolve_from_manifest(self):
        self.write()
        actual = probe.load_manifest(path=self.manifest)
        self.assertEqual(actual['frames'][0]['path'], str(self.source.resolve()))
        self.assertEqual(actual['frames'][0]['timestamp'], 0)
        self.assertEqual(actual['sourceManifestSha256'], probe.file_sha256(path=self.manifest))

    def test_rejects_empty_and_over_limit_sources(self):
        for count in (0, 33):
            with self.subTest(count=count):
                self.value['inputs'] = {f'{i}.rgba': 'a' * 64 for i in range(count)}
                self.value['timestamps'] = [0] * count
                self.write()
                with self.assertRaisesRegex(ValueError, '1 to 32'):
                    probe.load_manifest(path=self.manifest)

    def test_rejects_bad_dimensions_before_source_read(self):
        for width, height in ((True, 3), (2.0, 3), (0, 3), (4097, 1), (4096, 4096)):
            with self.subTest(width=width, height=height):
                self.value.update(width=width, height=height)
                self.write()
                with self.assertRaisesRegex(ValueError, 'dimensions'):
                    probe.load_manifest(path=self.manifest)

    def test_rejects_hash_mismatch_and_nonopaque_pixels(self):
        self.write()
        self.source.write_bytes(bytes(len(self.rgba.tobytes())))
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            probe.load_manifest(path=self.manifest)
        self.value['inputs']['original.rgba'] = probe.file_sha256(path=self.source)
        self.write()
        with self.assertRaisesRegex(ValueError, 'opaque'):
            probe.load_manifest(path=self.manifest)

    def test_rejects_wrong_size_and_changed_source_after_validation(self):
        self.write()
        manifest = probe.load_manifest(path=self.manifest)
        self.source.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'byte length'):
            probe.load_frame(frame=manifest['frames'][0], width=2, height=3)

    def test_rejects_nonfinite_boolean_or_missing_timestamps(self):
        for timestamps in ([], [True], [-1], [float('inf')], [float('nan')]):
            with self.subTest(timestamps=timestamps):
                self.value['timestamps'] = timestamps
                self.write()
                with self.assertRaises(ValueError):
                    probe.load_manifest(path=self.manifest)

    def test_backward_timestamp_is_allowed_without_omitting_frame_history(self):
        other = self.root / 'second.rgba'
        other.write_bytes(self.source.read_bytes())
        self.value['inputs']['second.rgba'] = probe.file_sha256(path=other)
        self.value['timestamps'] = [1, 0]
        self.write()
        self.assertEqual([row['timestamp'] for row in probe.load_manifest(path=self.manifest)['frames']], [1, 0])

    def test_environment_selection_is_explicit_and_restored_on_error(self):
        name = 'QCUT_BODY_SKELETON_BACKEND'
        with patch.dict(os.environ, {name: 'before'}):
            with self.assertRaisesRegex(RuntimeError, 'sentinel'):
                with probe.execution_environment(model_root=self.root, cpu_backend='onnx-exact'):
                    self.assertEqual(os.environ[name], 'onnx-exact')
                    raise RuntimeError('sentinel')
            self.assertEqual(os.environ[name], 'before')

    def test_reference_opens_after_owned_replay_and_recovery_are_saved(self):
        other = self.root / 'second.rgba'
        other.write_bytes(self.source.read_bytes())
        self.value['inputs']['second.rgba'] = probe.file_sha256(path=other)
        self.value['timestamps'] = [0, 1]
        self.write()
        output = self.root / 'output'

        class SyntheticSession:
            def __init__(self, **_):
                self.routes = []
                self.execution_identity = {'synthetic': True}

            def process(self, **kwargs):
                route = {'network': 'refine', 'backend': 'cpu'}
                self.routes.append(route)
                return kwargs['rgba'].copy(), {'executionRoutes': [route]}

            def capture_execution_state(self):
                return {'routes': self.routes.copy()}

            def apply_execution_replay(self, **_):
                pass

            def close(self):
                pass

        def compare(**kwargs):
            for name in ('owned-0.rgba', 'owned-1.rgba', 'replay-0.rgba', 'replay-1.rgba',
                         'recovered-1.rgba', 'checkpoint.bin', 'owned-report.json'):
                self.assertTrue((output / name).is_file(), name)
            return {'scope': 'synthetic reference boundary check'}

        modules = {'body_smart_sequence': types.SimpleNamespace(BodySmartSequence=SyntheticSession),
                   'body_sequence_checkpoint': types.SimpleNamespace(capture=lambda **_: b'own checkpoint', restore=lambda **_: None)}
        options = argparse.Namespace(source_manifest=self.manifest, output=output, runtime=self.root,
                                     model_root=self.root, cpu_backend='numpy', native_reference=self.root / 'never-read')
        with patch.dict('sys.modules', modules), patch.object(probe, 'compare_reference', side_effect=compare) as comparison:
            result = probe.run(options=options)
        comparison.assert_called_once()
        self.assertTrue(result['ownedVerificationPassed'])
        self.assertFalse(result['nativeProductParityVerified'])


if __name__ == '__main__':
    unittest.main()
