"""Compact identity of the actual owned engine sources used by a video session."""
import hashlib
import json
from pathlib import Path

SOURCE_SUFFIXES = frozenset({'.py', '.swift', '.mm'})
EXCLUDED_DIRECTORIES = frozenset({'tests', '__pycache__', 'body-photo'})


def execution_sources(*, root=None):
    directory = Path(root).resolve(strict=True) if root is not None else Path(__file__).resolve().parent
    if not directory.is_dir():
        raise ValueError('body execution source root must be a directory')
    files = []

    def visit(*, folder, ancestors):
        resolved = folder.resolve(strict=True)
        if resolved in ancestors:
            raise ValueError('body execution source directory contains a symlink cycle')
        for path in sorted(folder.iterdir()):
            if path.name.startswith('.') or path.name in EXCLUDED_DIRECTORIES:
                continue
            target = path.resolve(strict=True)
            if not target.is_relative_to(directory):
                raise ValueError('body execution source symlink escapes its root')
            if path.is_dir():
                visit(folder=path, ancestors=ancestors | {resolved})
                continue
            if path.suffix not in SOURCE_SUFFIXES or path.name.startswith('test_'):
                continue
            if not path.is_file():
                raise ValueError('body execution sources must be regular files')
            data = path.read_bytes()
            files.append({'path': path.relative_to(directory).as_posix(), 'bytes': len(data),
                          'sha256': hashlib.sha256(data).hexdigest()})

    visit(folder=directory, ancestors=set())
    files.sort(key=lambda item: item['path'])
    if not files:
        raise ValueError('body execution source closure is empty')
    encoded = json.dumps(files, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    return {'schemaVersion': 1, 'sha256': hashlib.sha256(encoded).hexdigest(),
            'files': len(files), 'bytes': sum(item['bytes'] for item in files)}
