"""Pinned private body CoreML identities; model payloads are supplied externally."""
import hashlib
import copy
import io
import json
from pathlib import Path
import tempfile
import zipfile

SOURCE_MODEL_SHA256 = '734f9e41b6fd4b3ffbe5485b4ec592835e5b4cc18cd7dc8f33047fd486e41ff1'
COMMON_FILES = {'model/coremldata.bin': 'f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b'}
MODELS = {
    'coarse': {
        'archive_end': 1824696,
        'prefix': 'skeleton_bottom_up_224x128_coreml_v3_multiori_ubody_quant.mlmodelc/',
        'sidecar_sha256': 'd77e265e4e35c81d17761bfbc47c7fae3d45141b55fe63a407e4bf92d69ffbb3',
        'input': 'input', 'sizes': ((224, 128), (224, 176), (128, 224), (176, 224)),
        'outputs': {'heatmap_output_0': 19, 'vectormap_output_0': 38},
        'files': {
            **COMMON_FILES,
            'model.espresso.shape': 'b952ee6473f5f365697fe7b57d6cd5afc161c1cde61e7450708205e56a978dc7',
            'model.espresso.net': 'd6d8badc508642d25683604b7b6a7e50744d9d849b696bceefd4b717fd11a79d',
            'metadata.json': 'fec1c129e3c21ae857b0a3b82589af4873789edf2ccf678409bd915d96ffa323',
            'model.espresso.weights': 'adb71ee3d6acda39459116b393290bec81919e4d757ca310b32d6b02061a88a5',
            'neural_network_optionals/coremldata.bin': '688036e1ee283707d2c5b3924b402c633145662025c4930e62eb97cb95dd6efd',
            'coremldata.bin': '74b9f6a81861346a17d146794e25651ef4f83d5c28eb2f832f77321eb01ec529',
            'analytics/coremldata.bin': 'd88ba6d14ab96332d98bec2d8ead0a8145be0a9a9b1bcbbea112d347d89947d8',
        },
    },
    'refine': {
        'archive_end': 3002351,
        'prefix': 'skeleton_192x144_coreml_v3_bedlam_resizeto18kpts-quant.mlmodelc/',
        'sidecar_sha256': 'd77e265e4e35c81d17761bfbc47c7fae3d45141b55fe63a407e4bf92d69ffbb3',
        'input': 'x_1', 'sizes': ((192, 144),), 'outputs': {'output_0': 34},
        'files': {
            **COMMON_FILES,
            'model.espresso.shape': '0145e36df3267a921ac1be0ed5a796ff3a81be028efb5f941378d333a583e8d8',
            'model.espresso.net': 'af1e958bafc21c65485403339cb1c0fad673247266f5d2efe2ab9f25c5ecdd39',
            'metadata.json': '86df5c58b551defcdb8c688ab455ae887337faf3592f5c94fb27ae078ed52082',
            'model.espresso.weights': '78daddc29e40bd0ccd78b08197cc4399de2f28193c3b807a91ffda28c138f058',
            'neural_network_optionals/coremldata.bin': '5931bd536c4550294a212c6fc8d3c1bee75da817980ba0b671c8603dafb36238',
            'coremldata.bin': '46343b0db35ab941893150b19f188078d7010d124d071a752068eb8b1871393f',
            'analytics/coremldata.bin': '782697cf03e7dd81109b41d4b0ecd2b27534d07c641169067732a5df9939727f',
        },
    },
}


def digest(*, path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def model_spec(*, network):
    if network not in MODELS:
        raise ValueError('body CoreML network must be coarse or refine')
    return copy.deepcopy(MODELS[network])


def model_identity(*, network):
    spec = model_spec(network=network)
    payload = json.dumps(spec['files'], sort_keys=True, separators=(',', ':')).encode()
    return {'sourceModelSha256': SOURCE_MODEL_SHA256, 'compiledPayloadSha256': hashlib.sha256(payload).hexdigest(),
            'network': network, 'inputName': spec['input'], 'inputSizes': [list(size) for size in spec['sizes']],
            'outputChannels': dict(spec['outputs']), 'inputEncoding': 'float32-nhwc',
            'outputEncoding': 'float32-nhwc-physical-values', 'computeUnits': 'All'}


def verify_model(*, directory, network):
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('external compiled model directory required')
    spec = model_spec(network=network)
    actual = {str(path.relative_to(root)) for path in root.rglob('*') if path.is_file()}
    if actual != set(spec['files']):
        raise ValueError('compiled model members differ from the pinned private payload')
    for name, expected in spec['files'].items():
        path = root / name
        if not path.resolve(strict=True).is_relative_to(root) or digest(path=path) != expected:
            raise ValueError(f'compiled model identity mismatch: {name}')
    return {**model_identity(network=network), 'modelDirectory': str(root), 'validated': True}


def extract_models(*, source, destination):
    """Explicit local preparation from the pinned package; never download or replace assets."""
    source, destination = Path(source), Path(destination)
    if source.stat().st_size > 8 * 1024 * 1024 or digest(path=source) != SOURCE_MODEL_SHA256:
        raise ValueError('source is not the pinned private body model')
    if destination.exists():
        raise FileExistsError('model destination already exists')
    data = source.read_bytes()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='body-coreml-extract-', dir=destination.parent) as temporary:
        stage = Path(temporary) / 'models'
        stage.mkdir()
        for network, spec in MODELS.items():
            root = stage / (network + '.mlmodelc')
            root.mkdir()
            # The source contains two ZIPs. Reading only its last central directory loses coarse.
            with zipfile.ZipFile(io.BytesIO(data[:spec['archive_end']])) as archive:
                members = [info for info in archive.infolist() if not info.is_dir()]
                expected_names = {spec['prefix'] + name for name in spec['files']}
                if spec.get('sidecar_sha256'):
                    sidecar = '__MACOSX/' + spec['prefix'] + '._metadata.json'
                    expected_names.add(sidecar)
                    if hashlib.sha256(archive.read(sidecar)).hexdigest() != spec['sidecar_sha256']:
                        raise ValueError('embedded model sidecar identity mismatch')
                if len(members) != len(expected_names) or {info.filename for info in members} != expected_names:
                    raise ValueError('unexpected embedded model members')
                for name, expected in spec['files'].items():
                    content = archive.read(spec['prefix'] + name)
                    if hashlib.sha256(content).hexdigest() != expected:
                        raise ValueError('embedded model member identity mismatch')
                    target = root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
            verify_model(directory=root, network=network)
        stage.rename(destination)
    return {network: destination / (network + '.mlmodelc') for network in MODELS}
