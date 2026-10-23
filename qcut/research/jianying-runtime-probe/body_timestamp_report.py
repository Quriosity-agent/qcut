"""Recompute bounded same-source history comparisons from stored private captures."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from body_timestamp_contract import CASES


def read_json(path):
    return json.loads(path.read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verified_bytes(*, root, value):
    data = (root / value['file']).read_bytes()
    if len(data) != value['bytes'] or digest(data) != value['sha256']:
        raise ValueError('captured array differs from receipt')
    return data


def frame_record(*, root, value, pixels):
    data = (root / f"frame{value['frame']}.rgba").read_bytes()
    if len(data) != pixels * 4 or digest(data) != value['resultSha256']:
        raise ValueError('captured pixels differ from receipt')
    return data


def difference(*, actual, expected):
    import numpy as np
    a, b = np.frombuffer(actual, np.uint8).reshape(-1, 4), np.frombuffer(expected, np.uint8).reshape(-1, 4)
    delta = np.abs(a.astype(np.int16) - b.astype(np.int16))
    return {'exact': actual == expected, 'rgbMeanAbsoluteError': float(delta[:, :3].mean()),
            'maximumChannelError': int(delta.max()), 'differentPixels': int(np.any(delta != 0, axis=1).sum())}


def native_case(*, root, pixels):
    trace, meshes, events = [read_json(root / name) for name in ('trace.json', 'meshes.json', 'backend-events.json')]
    frames = read_json(root / 'frames.json')
    if trace['errors'] or trace['exitCode'] or len(trace['calls']) != len(frames) * 2 or len(meshes) != len(frames) * 2:
        raise ValueError('incomplete native capture')
    for index, call in enumerate(trace['calls']):
        if call['index'] != index:
            raise ValueError('native skeleton calls are out of order')
        verified_bytes(root=root, value={'file': call['algorithmFile'], 'sha256': call['algorithmSha256'],
                                        'bytes': call['stride'] * call['height']})
        for inference in call['passes']:
            for kind in ('inputTensors', 'outputTensors'):
                for tensor in inference[kind]:
                    length = 1
                    for dimension in tensor['shape']:
                        length *= dimension
                    verified_bytes(root=root, value={**tensor, 'bytes': length * tensor['storage']})
    for mesh in meshes:
        for stage in ('before', 'after'):
            for name in ('base', 'positions', 'uv'):
                verified_bytes(root=root, value=mesh[stage][name])
            for part in mesh[stage]['parts']:
                verified_bytes(root=root, value=part['rawState'])
    rows, previous = [], None
    for index, frame in enumerate(frames):
        data = frame_record(root=root, value=frame, pixels=pixels)
        calls = trace['calls'][index * 2:index * 2 + 2]
        routes = []
        for call in calls:
            dispatch = [event['event'] for event in events if event['call'] == call['index'] and event['event'] in ('cpu', 'coreml')]
            if len(dispatch) != len(call['passes']):
                raise ValueError('native inference dispatch is incomplete')
            routes.extend({'network': item['network'], 'backend': route} for item, route in zip(call['passes'], dispatch))
        row = {**frame, 'routes': routes, 'skeletonCalls': [call['index'] for call in calls],
               'publicHashes': [digest(b''.join(struct.pack('<fffi', *point) for person in call['public'] for point in person)) for call in calls],
               'meshes': [{'skeletonCall': mesh['skeletonCall'], 'argument1': mesh['argument1'], 'argument2': mesh['argument2'],
                          'partInputModes': {part['name']: part['inputMode'] for part in mesh['after']['parts']},
                          'positionsSha256': mesh['after']['positions']['sha256']} for mesh in meshes[index * 2:index * 2 + 2]]}
        if previous is not None:
            row['adjacentPixels'] = difference(actual=data, expected=previous)
        previous = data
        rows.append(row)
    transparency = read_json(root / 'observation-transparency.json')
    if transparency:
        plain_root = root.with_name(root.name + '-unobserved')
        plain_frames = read_json(plain_root / 'frames.json')
        recomputed = [{'frame': frame['frame'], 'exact': frame_record(root=root, value=frame, pixels=pixels)
                      == frame_record(root=plain_root, value=plain, pixels=pixels)} for frame, plain in zip(frames, plain_frames)]
        if len(plain_frames) != len(frames) or recomputed != transparency:
            raise ValueError('native observation transparency receipt differs from stored pixels')
    return {'frames': rows, 'transparency': transparency}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--owned', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    provenance = read_json(args.native / 'provenance.json')
    source = provenance['source']
    pixels = source['width'] * source['height']
    cases = {name: native_case(root=args.native / name, pixels=pixels) for name in provenance['cases']}
    report = {'scope': 'Stored original-host timestamp interventions; identical source, fresh resident host per case, shared first three requests. No QCut source-window wrapper.',
        'schedule': provenance.get('schedule', 'natural'), 'scheduleScope': provenance.get('scheduleScope', 'Natural actual readiness.'),
        'source': source, 'native': cases, 'commonPrefix': [], 'crossCases': [], 'sources': {}}
    baseline = next(iter(cases))
    for name, case in cases.items():
        for index in range(3):
            a, b = case['frames'][index], cases[baseline]['frames'][index]
            report['commonPrefix'].append({'case': name, 'frame': index, 'pixelsExact': a['resultSha256'] == b['resultSha256'],
                'publicExact': a['publicHashes'] == b['publicHashes'], 'meshExact': a['meshes'] == b['meshes'], 'routesExact': a['routes'] == b['routes']})
    for first, second in (('same', 'forward'), ('forward', 'backward'), ('forward', 'jump')):
        if first not in cases or second not in cases:
            continue
        for index in range(6):
            a, b = cases[first]['frames'][index], cases[second]['frames'][index]
            report['crossCases'].append({'first': first, 'second': second, 'frame': index,
                'pixels': difference(actual=frame_record(root=args.native / first, value=a, pixels=pixels),
                                     expected=frame_record(root=args.native / second, value=b, pixels=pixels)),
                'publicExact': a['publicHashes'] == b['publicHashes'], 'routesExact': a['routes'] == b['routes'],
                'meshExact': [m['positionsSha256'] for m in a['meshes']] == [m['positionsSha256'] for m in b['meshes']]})
    if args.owned is not None:
        owned = read_json(args.owned / 'provenance.json')
        if owned['source'] != source or owned['cases'] != provenance['cases']:
            raise ValueError('owned inputs differ from native experiment contract')
        report['ownedComparisons'] = []
        report['ownedCrossCases'] = []
        for name in cases:
            own_frames = read_json(args.owned / name / 'frames.json')
            graphs = read_json(args.owned / name / 'graphs.json')
            own_routes, native_routes = [], []
            for index, own in enumerate(own_frames):
                native = cases[name]['frames'][index]
                own_routes.extend(own['routes'])
                native_routes.extend(native['routes'])
                actual = frame_record(root=args.owned / name, value=own, pixels=pixels)
                expected = frame_record(root=args.native / name, value=native, pixels=pixels)
                graph = graphs[index * 2:index * 2 + 2]
                for item in graph:
                    verified_bytes(root=args.owned / name, value=item['positions'])
                report['ownedComparisons'].append({'case': name, 'frame': index, 'pixels': difference(actual=actual, expected=expected),
                    'routesExact': own['routes'] == native['routes'], 'routePrefixExact': own_routes == native_routes,
                    'ownedModes': [item['inputMode'] for item in graph],
                    'nativeModes': [list(set(mesh['partInputModes'].values())) for mesh in native['meshes']],
                    'meshExact': [item['positions']['sha256'] for item in graph] == [mesh['positionsSha256'] for mesh in native['meshes']]})
        for first, second in (('same', 'forward'), ('forward', 'backward'), ('forward', 'jump')):
            if first not in cases or second not in cases:
                continue
            left, right = [read_json(args.owned / name / 'frames.json') for name in (first, second)]
            for index, (a, b) in enumerate(zip(left, right)):
                report['ownedCrossCases'].append({'first': first, 'second': second, 'frame': index,
                    'pixels': difference(actual=frame_record(root=args.owned / first, value=a, pixels=pixels),
                                         expected=frame_record(root=args.owned / second, value=b, pixels=pixels)),
                    'routesExact': a['routes'] == b['routes']})
    for root in (args.native, args.owned):
        if root is not None:
            for path in sorted(root.rglob('*.json')):
                report['sources'][str(path)] = digest(path.read_bytes())
    report['reportSourceSha256'] = digest(Path(__file__).read_bytes())
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'commonPrefixExact': all(all(row[key] for key in ('pixelsExact', 'publicExact', 'meshExact', 'routesExact')) for row in report['commonPrefix']),
        'transparentFrames': sum(row['exact'] for case in cases.values() for row in case['transparency']), 'ownedComparisons': len(report.get('ownedComparisons', []))}))


if __name__ == '__main__':
    main()
