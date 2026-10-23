"""External model extraction/identity tests contain synthetic ZIP payloads only."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_coreml_assets as assets
from body_coreml_build import _cached_host, prepare_host, system_environment


class CoreMLAssetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.specs = copy.deepcopy(assets.MODELS)
        self.package = b'owned synthetic header'
        for network, spec in self.specs.items():
            payload = (network + ' synthetic payload').encode()
            spec['files'] = {'model/data.bin': hashlib.sha256(payload).hexdigest()}
            sidecar = b'synthetic resource fork'
            spec['sidecar_sha256'] = hashlib.sha256(sidecar).hexdigest()
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr(spec['prefix'] + 'model/data.bin', payload)
                archive.writestr('__MACOSX/' + spec['prefix'] + '._metadata.json', sidecar)
            self.package += stream.getvalue()
            spec['archive_end'] = len(self.package)
        self.source = self.root / 'synthetic.model'
        self.source.write_bytes(self.package)
        self.source_hash = hashlib.sha256(self.package).hexdigest()
        self.destination = self.root / 'models'
        patch.object(assets, 'MODELS', self.specs).start()
        patch.object(assets, 'SOURCE_MODEL_SHA256', self.source_hash).start()

    def tearDown(self):
        patch.stopall()
        self.temporary.cleanup()

    def extract(self):
        return assets.extract_models(source=self.source, destination=self.destination)

    def test_extracts_both_embedded_archives_and_verifies_separately(self):
        results = self.extract()
        self.assertEqual(set(results), {'coarse','refine'})
        for network, directory in results.items():
            identity = assets.verify_model(directory=directory, network=network)
            self.assertEqual(identity['sourceModelSha256'], self.source_hash)
            self.assertTrue(identity['validated'])
            self.assertEqual((directory / 'model/data.bin').read_bytes(), (network + ' synthetic payload').encode())
        self.assertNotEqual(assets.model_identity(network='coarse')['compiledPayloadSha256'],
                            assets.model_identity(network='refine')['compiledPayloadSha256'])

    def test_rejects_wrong_source_before_creating_destination(self):
        self.source.write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'pinned private'):
            self.extract()
        self.assertFalse(self.destination.exists())

    def test_refuses_existing_destination_without_replacement(self):
        self.destination.mkdir()
        sentinel = self.destination / 'keep'
        sentinel.write_text('keep')
        with self.assertRaises(FileExistsError):
            self.extract()
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_member_hash_error_leaves_no_partial_model_directory(self):
        self.specs['refine']['files']['model/data.bin'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            self.extract()
        self.assertFalse(self.destination.exists())

    def test_modified_missing_extra_and_symlink_members_rejected(self):
        root = self.extract()['refine']
        member = root / 'model/data.bin'
        original = member.read_bytes()
        member.write_bytes(b'modified')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            assets.verify_model(directory=root, network='refine')
        member.unlink()
        with self.assertRaisesRegex(ValueError, 'members differ'):
            assets.verify_model(directory=root, network='refine')
        member.write_bytes(original)
        extra = root / 'extra'
        extra.write_text('extra')
        with self.assertRaisesRegex(ValueError, 'members differ'):
            assets.verify_model(directory=root, network='refine')
        extra.unlink()
        outside = self.root / 'outside'
        outside.write_bytes(original)
        member.unlink()
        member.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            assets.verify_model(directory=root, network='refine')

    def test_network_identity_does_not_accept_unknown_names(self):
        with self.assertRaises(ValueError):
            assets.model_identity(network='unknown')

    def test_cached_binary_hash_and_source_identity_must_match(self):
        binary, receipt = self.root / 'host', self.root / 'build.json'
        binary.write_bytes(b'owned executable')
        binary.chmod(0o700)
        value = {'sourceSha256':'source', 'binarySha256':assets.digest(path=binary)}
        receipt.write_text(json.dumps(value))
        self.assertEqual(_cached_host(binary=binary, receipt=receipt, source_hash='source'), value)
        self.assertIsNone(_cached_host(binary=binary, receipt=receipt, source_hash='other'))
        binary.write_bytes(b'tampered')
        self.assertIsNone(_cached_host(binary=binary, receipt=receipt, source_hash='source'))
        receipt.write_text('[]')
        self.assertIsNone(_cached_host(binary=binary, receipt=receipt, source_hash='source'))

    def test_non_macos_fails_before_spawning_a_process(self):
        with patch('body_coreml_build.platform.system', return_value='Linux'), patch('subprocess.Popen') as spawn:
            with self.assertRaisesRegex(RuntimeError, 'requires macOS'):
                prepare_host(cache_directory=self.root, cancelled=lambda: False, register_process=lambda process: None)
            spawn.assert_not_called()

    def test_loader_injection_environment_is_removed(self):
        with patch.dict('os.environ', {'DYLD_INSERT_LIBRARIES':'private', 'LD_PRELOAD':'private', 'BODY_TEST':'keep'}):
            environment = system_environment()
        self.assertNotIn('DYLD_INSERT_LIBRARIES', environment)
        self.assertNotIn('LD_PRELOAD', environment)
        self.assertEqual(environment['BODY_TEST'], 'keep')


if __name__ == '__main__':
    unittest.main()
