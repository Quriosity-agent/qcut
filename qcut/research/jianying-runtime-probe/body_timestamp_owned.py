"""Original-source automatic Swing runs; native captures are never opened here."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from body_timestamp_contract import CASES, source_identity

ENGINE = Path(__file__).resolve().parents[1] / 'independent-beauty/research'


def save_json(*, path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--source-provenance', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cases', nargs='+', choices=tuple(CASES), default=list(CASES))
    args = parser.parse_args()
    source = source_identity(manifest=json.loads(args.source_provenance.read_text()))
    args.output.mkdir(parents=True, exist_ok=False)
    os.environ.update(QCUT_BODY_COREML_MODEL_ROOT=str(args.model_root.resolve()),
                      QCUT_BODY_SKELETON_BACKEND='onnx-exact', BEAUTY_RENDER_RESOLUTION='original')
    sys.path.insert(0, str(ENGINE))
    import numpy as np
    from body_execution_sources import execution_sources, EXCLUDED_DIRECTORIES, SOURCE_SUFFIXES
    from body_smart_sequence import BodySmartSequence

    closure = execution_sources()
    snapshot = args.output / 'engine-sources'
    hashes = {}
    for path in sorted(ENGINE.rglob('*')):
        relative = path.relative_to(ENGINE)
        if (path.is_file() and path.suffix in SOURCE_SUFFIXES and not path.name.startswith('test_')
                and not any(part.startswith('.') or part in EXCLUDED_DIRECTORIES for part in relative.parts)):
            data = path.read_bytes()
            target = snapshot / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            hashes[str(relative)] = hashlib.sha256(data).hexdigest()
    save_json(path=args.output / 'provenance.json', value={'scope': 'Independent original-pixel automatic backend runs; no native data loaded.',
        'source': source, 'closure': closure, 'engineSources': hashes, 'cases': {name: CASES[name] for name in args.cases},
        'probeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'contractSha256': hashlib.sha256(Path(__file__).with_name('body_timestamp_contract.py').read_bytes()).hexdigest()})
    rgba = np.fromfile(source['path'], np.uint8).reshape(source['height'], source['width'], 4)
    for name in args.cases:
        output = args.output / name
        output.mkdir()
        session = BodySmartSequence(runtime=args.runtime, execution_profile='swing-coreml-v1', execution_generation='timestamp-' + name)
        graphs, frames = [], []
        original_advance = session._advance

        def observed_advance(**kwargs):
            mesh, details = original_advance(**kwargs)
            index = len(graphs)
            data = np.ascontiguousarray(mesh['positions']).tobytes()
            filename = f'mesh-{index:03d}.f32'
            (output / filename).write_bytes(data)
            graphs.append({'index': index, 'timestamp': kwargs['update'].timestamp,
                           'inputMode': session.composition._mode, 'positions': {'file': filename,
                           'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, 'details': details})
            return mesh, details

        session._advance = observed_advance
        try:
            for index, timestamp in enumerate(CASES[name]):
                if index:
                    time.sleep(.25)
                result, receipt = session.process(rgba=rgba, controls={'SlimBody': 40, 'StretchLeg': 30},
                                                  stream='timestamp-original', frame=index, timestamp=timestamp)
                data = result.tobytes()
                (output / f'frame{index}.rgba').write_bytes(data)
                save_json(path=output / f'frame{index}.json', value=receipt)
                frames.append({'frame': index, 'timestamp': timestamp, 'sourceSha256': source['sha256'],
                               'resultSha256': hashlib.sha256(data).hexdigest(), 'routes': receipt['executionRoutes']})
            save_json(path=output / 'frames.json', value=frames)
            save_json(path=output / 'graphs.json', value=graphs)
            save_json(path=output / 'identity.json', value=session.execution_identity)
        finally:
            session.close()
        if execution_sources() != closure:
            raise RuntimeError('owned source closure changed during execution')
        print(json.dumps({'case': name, 'frames': len(frames), 'graphs': len(graphs)}), flush=True)


if __name__ == '__main__':
    main()
