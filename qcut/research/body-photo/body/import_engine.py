"""Import a pinned, data-only QCut body engine without changing its checkout."""
import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile


SOURCE_COMMIT = '7bd5ceacc996b924c25563f430651dd1046d6ce0'
SOURCE_PREFIX = 'qcut/research/independent-beauty/research/'
if __package__:
    from .runtime_paths import runtime_root
else:
    from runtime_paths import runtime_root

BODY_ROOT = Path(__file__).resolve().parent
ASSETS = {
    'research/body-skeleton-v1.npz': (767518, '92ee99023a1d900f1a4810d21dd49aee3ad98baa2cbe62680a88635b669cdee5'),
    'research/face-detector-dynamic.onnx': (1749659, '4733751ec48c8dc5f8ca3fe3fbbfaa87c7f1393be5fba1d02320e4e71faa749a'),
    'research/face-align-120.onnx': (2460958, '26b5c79a46478896bb91d9693dd114c2374d7b64b0e0b64245f77cf6289d5364'),
    'research/face-align-160.onnx': (2451456, '45e3499295914247ab3a74fc080cf82c9cdecc82592224580a775838a5410174'),
    'research/alignment-assets-v1.npz': (2286, '383a85b488649789968bdb46df581ceea86d27532d7a915f604fe5deb2459a21'),
}
RESOURCE_SUFFIXES = {'.swift', '.metal', '.json'}
CACHE_PATTERN = re.compile(r'research/body-mesh-metal-[0-9a-f]{64}')


def identity(*, data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def relative_name(*, name):
    if (not isinstance(name, str) or not name or '\\' in name or '\0' in name
            or PurePosixPath(name).is_absolute() or any(part in ('', '.', '..') for part in name.split('/'))):
        raise ValueError('safe relative bundle path required')
    return name


def regular_bytes(*, root, name):
    parts = PurePosixPath(relative_name(name=name)).parts
    path = root.joinpath(*parts)
    if root.is_symlink() or any(root.joinpath(*parts[:index]).is_symlink() for index in range(1, len(parts) + 1)):
        raise ValueError('bundle files cannot be symlinks: ' + name)
    if not path.is_file() or not 0 < path.stat().st_size <= 64 * 1024**2:
        raise ValueError('bounded regular bundle file required: ' + name)
    return path.read_bytes()


def _manifest(*, body_root, name):
    data = regular_bytes(root=body_root, name=name)
    value = json.loads(data)
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or not isinstance(value.get('files'), dict):
        raise ValueError('supported bundle manifest required: ' + name)
    return value, identity(data=data)['sha256']


def verify_source(*, body_root=BODY_ROOT):
    manifest, digest = _manifest(body_root=body_root, name='engine-source-manifest.json')
    if (manifest.get('sourceCommit') != SOURCE_COMMIT or manifest.get('sourcePrefix') != SOURCE_PREFIX
            or manifest.get('sourceBytesModified') is not False or not manifest['files']):
        raise ValueError('pinned unmodified QCut engine required')
    for name, expected in manifest['files'].items():
        if not name.startswith('engine/research/'):
            raise ValueError('engine manifest contains a non-engine path')
        if identity(data=regular_bytes(root=body_root, name=name)) != expected:
            raise ValueError('engine source identity mismatch: ' + name)
    actual = set()
    for path in (body_root / 'engine').rglob('*'):
        if path.is_symlink():
            raise ValueError('symlink in engine source bundle')
        if path.is_file():
            actual.add(path.relative_to(body_root).as_posix())
    if actual != set(manifest['files']):
        raise ValueError('unexpected or missing engine source files')
    return {'sourceFiles': len(actual), 'sourceCommit': SOURCE_COMMIT, 'sourceManifestSha256': digest}


def verify_assets(*, body_root=BODY_ROOT, runtime=None):
    runtime = runtime_root(body_root=body_root) / 'body' if runtime is None else Path(runtime)
    manifest, digest = _manifest(body_root=body_root, name='asset-manifest.json')
    expected = {name: {'bytes': size, 'sha256': sha} for name, (size, sha) in ASSETS.items()}
    if manifest['files'] != expected or manifest.get('nativeLibrariesIncluded') is not False:
        raise ValueError('exact five-file private body data manifest required')
    for name, pin in expected.items():
        if identity(data=regular_bytes(root=runtime, name=name)) != pin:
            raise ValueError('body asset identity mismatch: ' + name)
    for path in runtime.rglob('*'):
        if path.is_symlink():
            raise ValueError('symlink in private body asset bundle')
        if not path.is_file():
            continue
        name = path.relative_to(runtime).as_posix()
        if name not in expected and CACHE_PATTERN.fullmatch(name) is None:
            raise ValueError('unexpected private body runtime file: ' + name)
    return {'assets': len(expected), 'assetBytes': sum(size for size, _ in ASSETS.values()),
            'assetManifestSha256': digest}


def verify_bundle(*, body_root=BODY_ROOT, runtime=None):
    return {'verified': True, **verify_source(body_root=body_root),
            **verify_assets(body_root=body_root, runtime=runtime)}


def _git(*, repository, arguments):
    return subprocess.check_output(['git', '-C', str(repository), *arguments], timeout=30)


def source_closure(*, repository):
    listing = _git(repository=repository, arguments=['ls-tree', '-r', '--name-only', SOURCE_COMMIT, '--', SOURCE_PREFIX])
    available = {name[len(SOURCE_PREFIX):] for name in listing.decode().splitlines() if name.startswith(SOURCE_PREFIX)}
    cache = {}

    def read(*, name):
        if name not in cache:
            cache[name] = _git(repository=repository, arguments=['show', SOURCE_COMMIT + ':' + SOURCE_PREFIX + name])
        return cache[name]

    def resolve(*, module, source, level=0):
        parent = list(PurePosixPath(source).parent.parts) if level else []
        if level > 1:
            parent = parent[:-(level - 1)]
        key = '/'.join(parent + (module.split('.') if module else []))
        for candidate in (key + '.py', key + '/__init__.py'):
            if candidate in available:
                return candidate
        # The upstream preprocessing helper adds its adjacent vendor directory.
        if not level and '/' not in key:
            matches = [name for name in available if name.endswith('/' + key + '.py')]
            if len(matches) == 1:
                return matches[0]
        return None

    selected, pending = set(), ['body_smart_render.py']
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        selected.add(name)
        tree = ast.parse(read(name=name))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [(item.name, 0) for item in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [(node.module or '', node.level)] + [
                    (((node.module + '.') if node.module else '') + item.name, node.level) for item in node.names]
            else:
                modules = []
            for module, level in modules:
                dependency = resolve(module=module, source=name, level=level)
                if dependency is not None:
                    pending.append(dependency)
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                value = node.value
                if PurePosixPath(value).name == value and PurePosixPath(value).suffix in RESOURCE_SUFFIXES:
                    resource = str(PurePosixPath(name).parent / value)
                    if resource in available:
                        selected.add(resource)
        adjacent = str(PurePosixPath(name).with_suffix('.swift'))
        if adjacent in available:
            selected.add(adjacent)
    selected.add('vendor/LICENSE.opencv-svd.txt')
    return {name: read(name=name) for name in sorted(selected)}


def import_engine(*, repository, source_runtime, body_root=BODY_ROOT):
    repository, source_runtime = Path(repository).resolve(), Path(source_runtime).resolve()
    runtime = runtime_root(body_root=body_root) / 'body'
    targets = [body_root / 'engine', runtime, body_root / 'engine-source-manifest.json', body_root / 'asset-manifest.json']
    if any(path.exists() or path.is_symlink() for path in targets):
        raise ValueError('engine, manifests and runtime/body must be fresh')
    sources = source_closure(repository=repository)
    assets = {name: regular_bytes(root=source_runtime, name=name) for name in ASSETS}
    for name, data in assets.items():
        size, sha = ASSETS[name]
        if identity(data=data) != {'bytes': size, 'sha256': sha}:
            raise ValueError('source body model mismatch: ' + name)
    source_manifest = {'schemaVersion': 1, 'sourceCommit': SOURCE_COMMIT, 'sourcePrefix': SOURCE_PREFIX,
                       'sourceBytesModified': False, 'entrypoint': 'engine/research/body_smart_render.py',
                       'scope': 'canonical static photo renderer; no video or native SDK',
                       'files': {'engine/research/' + name: identity(data=data) for name, data in sources.items()}}
    asset_manifest = {'schemaVersion': 1, 'nativeLibrariesIncluded': False,
                      'weightsOrigin': 'extracted original private model data; not independently trained',
                      'files': {name: identity(data=data) for name, data in assets.items()}}
    body_root.mkdir(parents=True, exist_ok=True)
    runtime.parent.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        with tempfile.TemporaryDirectory(prefix='.body-import-', dir=body_root) as temporary:
            staged = Path(temporary)
            for name, data in sources.items():
                destination = staged / 'engine' / 'research' / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
            for name, data in assets.items():
                destination = staged / 'runtime' / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
            (staged / 'engine').rename(body_root / 'engine')
            created.append(body_root / 'engine')
            (staged / 'runtime').rename(runtime)
            created.append(runtime)
            for name, value in [('engine-source-manifest.json', source_manifest), ('asset-manifest.json', asset_manifest)]:
                destination = body_root / name
                with destination.open('x', encoding='utf-8') as stream:
                    json.dump(value, stream, ensure_ascii=False, indent=2)
                    stream.write('\n')
                created.append(destination)
        return verify_bundle(body_root=body_root, runtime=runtime)
    except BaseException:
        for path in reversed(created):
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qcut-repository', type=Path, required=True)
    parser.add_argument('--qcut-runtime', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(import_engine(repository=args.qcut_repository, source_runtime=args.qcut_runtime), indent=2))


if __name__ == '__main__':
    main()
