"""Bounded original-pixel rendering, own-route replay and checkpoint acceptance."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time

import numpy as np
from PIL import Image

ENGINE = Path(__file__).resolve().parents[1] / 'research'
MAX_FRAMES = 32
CONTROLS = {'SlimBody': 40.0, 'StretchLeg': 30.0}


def file_sha256(*, path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(*, path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def load_frame(*, frame, width, height):
    path = Path(frame['path'])
    if path.stat().st_size != width * height * 4:
        raise ValueError('source RGBA byte length differs from manifest dimensions')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != frame['sha256']:
        raise ValueError('source RGBA SHA-256 differs from manifest')
    rgba = np.frombuffer(data, np.uint8).reshape(height, width, 4)
    if np.any(rgba[..., 3] != 255):
        raise ValueError('opaque source RGBA required')
    return rgba


def load_manifest(*, path):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('source manifest exceeds one MiB')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('source manifest must be an object')
    width, height = value.get('width'), value.get('height')
    if (type(width) is not int or type(height) is not int or min(width, height) < 1
            or max(width, height) > 4096 or width * height > 3840 * 2160):
        raise ValueError('bounded positive integer source dimensions required')
    inputs, timestamps = value.get('inputs'), value.get('timestamps')
    if not isinstance(inputs, dict) or not 1 <= len(inputs) <= MAX_FRAMES:
        raise ValueError('source manifest requires 1 to 32 ordered input paths and hashes')
    if not isinstance(timestamps, list) or len(timestamps) != len(inputs):
        raise ValueError('one timestamp per source input required')
    frames = []
    for (name, digest), timestamp in zip(inputs.items(), timestamps):
        if not isinstance(name, str) or not name or not isinstance(digest, str) or not re.fullmatch('[0-9a-fA-F]{64}', digest):
            raise ValueError('each source requires a path and SHA-256')
        if type(timestamp) not in (int, float) or not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError('finite nonnegative timestamps required')
        source = Path(name)
        source = source if source.is_absolute() else path.parent / source
        frame = {'path': str(source.resolve()), 'sha256': digest.lower(), 'timestamp': timestamp}
        load_frame(frame=frame, width=width, height=height)
        frames.append(frame)
    return {'width': width, 'height': height, 'frames': frames, 'sourceManifestSha256': file_sha256(path=path)}


@contextmanager
def execution_environment(*, model_root, cpu_backend):
    settings = {'QCUT_BODY_COREML_MODEL_ROOT': str(model_root),
                'QCUT_BODY_SKELETON_BACKEND': cpu_backend, 'BEAUTY_RENDER_RESOLUTION': 'original'}
    previous = {name: os.environ.get(name) for name in settings}
    os.environ.update(settings)
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def metrics(*, actual, expected):
    if actual.shape != expected.shape or actual.dtype != np.uint8 or expected.dtype != np.uint8:
        raise ValueError('matching uint8 RGBA arrays required')
    delta = np.abs(actual.astype(np.int16) - expected.astype(np.int16))
    return {'exact': actual.tobytes() == expected.tobytes(), 'differentScalars': int(np.count_nonzero(delta)),
            'meanAbsoluteError': float(delta.mean()), 'maximumAbsoluteError': int(delta.max()),
            'differentPixels': int(np.count_nonzero(np.any(delta != 0, axis=-1)))}


def save_frame(*, output, prefix, index, rgba, receipt):
    raw = output / f'{prefix}-{index}.rgba'
    rgba.tofile(raw)
    Image.fromarray(rgba).save(output / f'{prefix}-{index}.png')
    save_json(path=output / f'{prefix}-{index}.json', value=receipt)
    return {'file': raw.name, 'sha256': file_sha256(path=raw), 'receiptSha256': file_sha256(path=output / f'{prefix}-{index}.json')}


def read_output(*, output, prefix, index, manifest):
    raw = output / f'{prefix}-{index}.rgba'
    expected_bytes = manifest['height'] * manifest['width'] * 4
    if raw.stat().st_size != expected_bytes:
        raise ValueError('rendered RGBA byte length differs from source')
    return np.fromfile(raw, np.uint8).reshape(manifest['height'], manifest['width'], 4)


def render_frame(*, session, index, manifest):
    frame = manifest['frames'][index]
    rgba = load_frame(frame=frame, width=manifest['width'], height=manifest['height'])
    return session.process(rgba=rgba, controls=CONTROLS, stream='probe-original-source',
                           frame=index, timestamp=frame['timestamp'])


def reference_routes(*, directory, manifest):
    needed = [directory / name for name in ('trace.json', 'backend-events.json', 'frames.json')]
    if not all(path.is_file() for path in needed):
        return {'status': 'unavailable', 'routes': None, 'sourceHashesMatch': None}
    trace, events, frames = [json.loads(path.read_text()) for path in needed]
    if trace['errors'] or trace['exitCode'] != 0 or len(trace['calls']) != len(manifest['frames']) * 2:
        raise ValueError('native trace is not a successful two-update capture')
    if len(frames) != len(manifest['frames']):
        raise ValueError('native source receipt count differs')
    if [frame['frame'] for frame in frames] != list(range(len(frames))):
        raise ValueError('native frame receipt order differs')
    routes = []
    for call in trace['calls']:
        dispatch = [event['event'] for event in events if event['call'] == call['index'] and event['event'] in ('cpu', 'coreml')]
        if len(dispatch) != len(call['passes']):
            raise ValueError('native dispatch and inference counts differ')
        routes.extend({'network': item['network'], 'backend': backend} for item, backend in zip(call['passes'], dispatch))
    return {'status': 'observed', 'routes': routes,
            'sourceHashesMatch': all(frame['sourceSha256'] == source['sha256'] for frame, source in zip(frames, manifest['frames'])),
            'outputHashes': [frame['resultSha256'] for frame in frames],
            'sourceFiles': {path.name: file_sha256(path=path) for path in needed}}


def compare_reference(*, directory, output, manifest, rows, routes):
    evidence = reference_routes(directory=directory, manifest=manifest)
    evidence['routesMatch'] = None if evidence['routes'] is None else evidence['routes'] == routes
    for index, row in enumerate(rows):
        native_path = directory / f'frame{index}.rgba'
        if native_path.stat().st_size != manifest['width'] * manifest['height'] * 4:
            raise ValueError('diagnostic reference RGBA length differs')
        native = np.fromfile(native_path, np.uint8).reshape(manifest['height'], manifest['width'], 4)
        actual = read_output(output=output, prefix='owned', index=index, manifest=manifest)
        native_hash = file_sha256(path=native_path)
        if evidence.get('outputHashes') is not None and native_hash != evidence['outputHashes'][index]:
            raise ValueError('native output differs from its captured route receipt')
        row['diagnosticNativeReference'] = {**metrics(actual=actual, expected=native), 'sha256': native_hash}
        Image.fromarray(native).save(output / f'native-{index}.png')
        difference = np.minimum(np.abs(actual[..., :3].astype(np.int16) - native[..., :3].astype(np.int16)) * 8, 255).astype(np.uint8)
        Image.fromarray(difference).save(output / f'difference-{index}.png')
    return {'directory': str(directory), 'scope': 'Explicit user-selected diagnostic reference; pixel metrics alone do not establish matching scheduling or product parity.',
            'openedAfterAllOwnedReplayRecoveryOutputs': True, 'routeEvidence': evidence,
            'nativeProductParityVerified': False}


def run(*, options):
    manifest = load_manifest(path=options.source_manifest)
    options.output.mkdir(parents=True, exist_ok=False)
    sys.path.insert(0, str(ENGINE))
    from body_smart_sequence import BodySmartSequence
    from body_sequence_checkpoint import capture, restore

    generation = 'source-manifest-' + manifest['sourceManifestSha256'][:24]
    configuration = {'manifest': manifest, 'runtime': str(options.runtime.resolve()),
                     'modelRoot': str(options.model_root.resolve()), 'cpuBackend': options.cpu_backend,
                     'controls': CONTROLS, 'profile': 'swing-coreml-v1', 'generation': generation,
                     'probeSha256': file_sha256(path=Path(__file__))}
    save_json(path=options.output / 'provenance.json', value=configuration)
    started = time.monotonic()
    count = len(manifest['frames'])
    checkpoint_after = max(0, count // 2 - 1) if count > 1 else None
    rows = []

    def engine():
        return BodySmartSequence(runtime=options.runtime, execution_profile='swing-coreml-v1', execution_generation=generation)

    with execution_environment(model_root=options.model_root.resolve(), cpu_backend=options.cpu_backend):
        first = engine()
        try:
            for index in range(count):
                rgba, receipt = render_frame(session=first, index=index, manifest=manifest)
                saved = save_frame(output=options.output, prefix='owned', index=index, rgba=rgba, receipt=receipt)
                original = load_frame(frame=manifest['frames'][index], width=manifest['width'], height=manifest['height'])
                Image.fromarray(original).save(options.output / f'original-{index}.png')
                rows.append({'frame': index, 'routes': receipt['executionRoutes'], 'owned': saved,
                             'effectVsOriginal': metrics(actual=rgba, expected=original)})
                # Register only completed own routes so a checkpoint cannot import reference timing.
                first.apply_execution_replay(routes=first.capture_execution_state()['routes'])
                if index == checkpoint_after:
                    (options.output / 'checkpoint.bin').write_bytes(capture(session=first))
                print(json.dumps({'phase': 'owned', 'frame': index, 'routes': receipt['executionRoutes']}), flush=True)
            routes, identity = first.capture_execution_state()['routes'], first.execution_identity
            save_json(path=options.output / 'owned-routes.json', value=routes)
        finally:
            first.close()
        replay = engine()
        try:
            replay.apply_execution_replay(routes=routes)
            for index in range(count):
                rgba, receipt = render_frame(session=replay, index=index, manifest=manifest)
                saved = save_frame(output=options.output, prefix='replay', index=index, rgba=rgba, receipt=receipt)
                expected = read_output(output=options.output, prefix='owned', index=index, manifest=manifest)
                rows[index]['fullReplay'] = {**metrics(actual=rgba, expected=expected), **saved}
        finally:
            replay.close()
        if checkpoint_after is not None:
            resumed = engine()
            try:
                resumed.apply_execution_replay(routes=routes)
                restore(session=resumed, data=(options.output / 'checkpoint.bin').read_bytes())
                for index in range(checkpoint_after + 1, count):
                    rgba, receipt = render_frame(session=resumed, index=index, manifest=manifest)
                    saved = save_frame(output=options.output, prefix='recovered', index=index, rgba=rgba, receipt=receipt)
                    expected = read_output(output=options.output, prefix='owned', index=index, manifest=manifest)
                    rows[index]['checkpointRecovery'] = {**metrics(actual=rgba, expected=expected), **saved}
            finally:
                resumed.close()
    receipt = {'scope': 'Bounded original-source rendering with automatic per-detector readiness; fresh-session replay of its own routes and own checkpoint recovery.',
               'sourceFrames': count, 'uniqueSourceHashes': len({frame['sha256'] for frame in manifest['frames']}),
               'width': manifest['width'], 'height': manifest['height'], 'identity': identity, 'routes': routes, 'rows': rows,
               'checkpointAfterFrame': checkpoint_after, 'checkpointSha256': file_sha256(path=options.output / 'checkpoint.bin') if checkpoint_after is not None else None,
               'externalPrivateModelRequired': True, 'nativeProductParityVerified': False}
    receipt['ownedVerificationPassed'] = all(row['fullReplay']['exact'] and row.get('checkpointRecovery', {'exact': True})['exact'] for row in rows)
    save_json(path=options.output / 'owned-report.json', value=receipt)
    # No reference directory, metadata or pixel file is opened before this boundary.
    if options.native_reference is not None:
        receipt['nativeReference'] = compare_reference(directory=options.native_reference, output=options.output, manifest=manifest, rows=rows, routes=routes)
    receipt['elapsedSeconds'] = time.monotonic() - started
    save_json(path=options.output / 'report.json', value=receipt)
    if not receipt['ownedVerificationPassed']:
        raise RuntimeError('owned replay or checkpoint recovery diverged; inspect saved outputs')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cpu-backend', choices=('numpy', 'onnx-exact'), required=True)
    parser.add_argument('--native-reference', type=Path)
    result = run(options=parser.parse_args())
    print(json.dumps({'ownedVerificationPassed': result['ownedVerificationPassed'], 'frames': result['sourceFrames'], 'routes': result['routes']}))


if __name__ == '__main__':
    main()
