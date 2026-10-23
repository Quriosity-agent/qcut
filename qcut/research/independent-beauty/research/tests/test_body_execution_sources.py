"""Source identity changes with runtime code and paths, never private/test artifacts."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_execution_sources import execution_sources


class ExecutionSources(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='body-execution-sources-')
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name)
        self.root = self.parent / 'engine'
        self.root.mkdir()

    def write(self, *, name, data='owned source', root=None):
        target = (root or self.root) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data)
        return target

    def test_relative_names_contents_and_membership_all_bind_identity(self):
        helper = self.write(name='body_execution_sources.py')
        before = execution_sources(root=self.root)
        self.assertEqual(before['files'], 1)
        helper.write_text('different helper')
        changed = execution_sources(root=self.root)
        self.assertNotEqual(changed, before)
        for name in ('nested/preprocess.py', 'renderer.swift', 'resident.mm'):
            with self.subTest(name=name):
                path = self.write(name=name)
                added = execution_sources(root=self.root)
                self.assertNotEqual(added['sha256'], changed['sha256'])
                renamed = path.with_name('renamed' + path.suffix)
                path.rename(renamed)
                self.assertNotEqual(execution_sources(root=self.root)['sha256'], added['sha256'])
                renamed.unlink()
                self.assertEqual(execution_sources(root=self.root), changed)

    def test_order_and_absolute_location_do_not_change_identity(self):
        names = ('z.swift', 'body_execution_sources.py', 'nested/a.mm', 'nested/b.py')
        for name in names:
            self.write(name=name, data=name)
        other = self.parent / 'copy'
        for name in reversed(names):
            self.write(name=name, data=name, root=other)
        self.assertEqual(execution_sources(root=self.root), execution_sources(root=other))

    def test_tests_frozen_photo_environment_and_binary_artifacts_are_excluded(self):
        self.write(name='engine.py')
        before = execution_sources(root=self.root)
        for name in ('tests/test_engine.py', 'test_local.py', 'body-photo/frozen.py',
                     '__pycache__/cached.py', '.cache/generated.mm', 'model.npz', 'compiled-host'):
            self.write(name=name)
        outside = self.parent / 'private-environment'
        self.write(name='site.py', root=outside)
        (self.root / '.venv').symlink_to(outside, target_is_directory=True)
        self.assertEqual(execution_sources(root=self.root), before)

    def test_source_file_and_directory_symlinks_cannot_escape(self):
        self.write(name='engine.py')
        outside = self.parent / 'outside'
        source = self.write(name='source.py', root=outside)
        for target, name in ((source, 'escape.py'), (outside, 'external')):
            with self.subTest(name=name):
                link = self.root / name
                link.symlink_to(target, target_is_directory=target.is_dir())
                with self.assertRaisesRegex(ValueError, 'escapes'):
                    execution_sources(root=self.root)
                link.unlink()

    def test_internal_alias_is_named_and_directory_cycles_are_rejected(self):
        source = self.write(name='engine.py')
        before = execution_sources(root=self.root)
        alias = self.root / 'alias.py'
        alias.symlink_to(source)
        self.assertNotEqual(execution_sources(root=self.root)['sha256'], before['sha256'])
        self.assertEqual(execution_sources(root=self.root)['files'], 2)
        alias.unlink()
        (self.root / 'loop').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'cycle'):
            execution_sources(root=self.root)

    def test_current_engine_closure_includes_helper_and_metadata_stays_small(self):
        identity = execution_sources()
        self.assertGreater(identity['files'], 100)
        self.assertLess(len(json.dumps(identity)), 256)
        self.assertEqual(len(identity['sha256']), 64)
        with self.assertRaisesRegex(ValueError, 'empty'):
            execution_sources(root=self.root)


if __name__ == '__main__':
    unittest.main()
