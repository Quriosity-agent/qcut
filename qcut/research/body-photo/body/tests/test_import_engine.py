"""The delivered source/model bundle rejects drift before it can render."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import import_engine


@unittest.skipUnless(
    all((import_engine.BODY_ROOT.parent / "runtime" / "body" / name).is_file()
        for name in import_engine.ASSETS),
    "legacy Mac importer tests require all five original data assets; portable inference excludes the skeleton NPZ",
)
class BundleVerification(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='body-bundle-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'body'
        self.root.mkdir()
        shutil.copytree(import_engine.BODY_ROOT / 'engine', self.root / 'engine')
        for name in ('engine-source-manifest.json', 'asset-manifest.json'):
            shutil.copyfile(import_engine.BODY_ROOT / name, self.root / name)
        self.runtime = self.root.parent / 'runtime' / 'body'
        for name in import_engine.ASSETS:
            target = self.runtime / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(import_engine.BODY_ROOT.parent / 'runtime' / 'body' / name, target)

    def test_complete_bundle_has_only_the_pinned_five_data_assets(self):
        result = import_engine.verify_bundle(body_root=self.root)
        self.assertTrue(result['verified'])
        self.assertEqual(result['sourceCommit'], import_engine.SOURCE_COMMIT)
        self.assertEqual((result['assets'], result['assetBytes']), (5, 7_431_877))

    def test_changed_model_is_rejected(self):
        model = self.runtime / 'research/body-skeleton-v1.npz'
        data = bytearray(model.read_bytes())
        data[-1] ^= 1
        model.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'asset identity mismatch'):
            import_engine.verify_bundle(body_root=self.root)

    def test_modified_source_and_unlisted_source_are_rejected(self):
        source = self.root / 'engine/research/body_smart_render.py'
        original = source.read_bytes()
        source.write_bytes(original + b'\n')
        with self.assertRaisesRegex(ValueError, 'source identity mismatch'):
            import_engine.verify_source(body_root=self.root)
        source.write_bytes(original)
        (source.parent / 'unlisted.py').write_text('raise RuntimeError()\n')
        with self.assertRaisesRegex(ValueError, 'unexpected or missing'):
            import_engine.verify_source(body_root=self.root)

    def test_vendor_library_or_symlink_in_runtime_is_rejected(self):
        injected = self.runtime / 'research/libcccreator.dylib'
        injected.write_bytes(b'not an allowed model')
        with self.assertRaisesRegex(ValueError, 'unexpected private body runtime'):
            import_engine.verify_assets(body_root=self.root)
        injected.unlink()
        model = self.runtime / 'research/body-skeleton-v1.npz'
        saved = self.runtime.parent / 'outside.npz'
        model.rename(saved)
        model.symlink_to(saved)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            import_engine.verify_assets(body_root=self.root)

    def test_asset_manifest_cannot_repin_changed_models(self):
        path = self.root / 'asset-manifest.json'
        manifest = json.loads(path.read_text())
        manifest['files']['research/body-skeleton-v1.npz']['sha256'] = '0' * 64
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'exact five-file'):
            import_engine.verify_assets(body_root=self.root)

    def test_source_manifest_traversal_is_rejected(self):
        path = self.root / 'engine-source-manifest.json'
        manifest = json.loads(path.read_text())
        manifest['files']['engine/research/../escape.py'] = {'bytes': 1, 'sha256': '0' * 64}
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'safe relative'):
            import_engine.verify_source(body_root=self.root)

    def test_import_never_overwrites_an_existing_engine(self):
        before = (self.root / 'engine-source-manifest.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'must be fresh'):
            import_engine.import_engine(repository=Path('/absent'), source_runtime=Path('/absent'),
                                        body_root=self.root)
        self.assertEqual((self.root / 'engine-source-manifest.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
