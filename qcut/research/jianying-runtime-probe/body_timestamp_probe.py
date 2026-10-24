"""Run same-source timestamp variants through an unchanged resident Swing host."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

from body_backend_probe import LIBRARY_SHA256, sha256, wait_log
from body_timestamp_contract import CASES, native_microseconds, parameters, source_identity
from run_body_default_profile import PARTS, SOURCES


def run_case(*, output, base, timestamps, source, observed):
    output.mkdir()
    pipe = output / 'input.fifo'
    os.mkfifo(pipe)
    descriptor = os.open(pipe, os.O_RDWR)
    config = {**base, 'output': str(output), 'stdin': str(pipe),
              'stdout': str(output / 'stdout.log'), 'stderr': str(output / 'stderr.log')}
    configuration = output / 'config.json'
    configuration.write_text(json.dumps(config, indent=2) + '\n')
    env = {key: value for key, value in os.environ.items() if not key.startswith(('DYLD_', 'QCUT_AUDIT_'))}
    records, commands = [], []
    values = json.dumps(parameters(parts=PARTS), separators=(',', ':'))
    try:
        with (output / 'lldb.log').open('w') as log, (output / 'stdout.log').open('w') as stdout, (output / 'stderr.log').open('w') as stderr:
            if observed:
                script = 'import sys; sys.path.insert(0, %r); import body_profile_lldb, body_backend_lldb, body_timestamp_lldb; body_timestamp_lldb.run(debugger=lldb.debugger, configuration=%r)' % (str(Path(__file__).resolve().parent), str(configuration))
                process = subprocess.Popen(['xcrun', 'lldb', '-b', '-o', 'script ' + script, '-o', 'quit'], stdout=log, stderr=subprocess.STDOUT, env=env)
            else:
                env.update(dict(item.split('=', 1) for item in config['environment']))
                process = subprocess.Popen([config['host'], *config['arguments']], stdin=descriptor, stdout=stdout, stderr=stderr, env=env)
            try:
                deadline = time.monotonic() + 180
                wait_log(process=process, path=output / 'stdout.log', text='QCUT\tREADY\t1', deadline=deadline)
                for index, timestamp in enumerate(timestamps):
                    # An explicit shared wall delay precedes every request after cold start.
                    if index:
                        time.sleep(.25)
                    result = output / f'frame{index}.rgba'
                    command = '\t'.join(('render', str(index), repr(timestamp), source['path'], str(result), values))
                    commands.append(command)
                    started = time.monotonic_ns()
                    os.write(descriptor, (command + '\n').encode())
                    wait_log(process=process, path=output / 'stdout.log', text=f'QCUT\tRESULT\t{index}\t0', deadline=deadline)
                    records.append({'frame': index, 'timestamp': timestamp, 'nativeMicroseconds': native_microseconds(value=timestamp),
                        'sourceSha256': source['sha256'], 'resultSha256': sha256(path=result), 'durationNs': time.monotonic_ns() - started})
                os.write(descriptor, b'exit\n')
                process.wait(timeout=30)
                if process.returncode:
                    raise RuntimeError('native host failed')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    finally:
        os.close(descriptor)
    (output / 'commands.txt').write_text('\n'.join(commands + ['exit', '']))
    (output / 'frames.json').write_text(json.dumps(records, indent=2) + '\n')
    if observed:
        trace = json.loads((output / 'trace.json').read_text())
        meshes = json.loads((output / 'meshes.json').read_text())
        if trace['errors'] or trace['exitCode'] or len(trace['calls']) != len(timestamps) * 2 or len(meshes) != len(timestamps) * 2:
            raise RuntimeError('incomplete native skeleton/mesh observations: ' + str(trace['errors']))
    print(json.dumps({'case': output.name, 'frames': len(records), 'observed': observed}), flush=True)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--source-provenance', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cases', nargs='+', choices=tuple(CASES), default=list(CASES))
    parser.add_argument('--schedule', choices=('natural', 'wait-after-first-coarse'), default='natural')
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    library = runtime / 'Frameworks/libcccreator.dylib'
    if sha256(path=library) != LIBRARY_SHA256:
        raise ValueError('unsupported native binary; offsets require pinned SHA-256')
    source = source_identity(manifest=json.loads(args.source_provenance.read_text()))
    args.output.mkdir(parents=True, exist_ok=False)
    directory = Path(__file__).resolve().parent
    paths = [directory / name for name in SOURCES]
    host = args.output / 'production-host'
    subprocess.run(['xcrun', 'clang++', '-std=c++20', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
                    *map(str, paths), '-framework', 'AppKit', '-framework', 'CoreVideo', '-framework', 'IOSurface', '-framework', 'OpenGL', '-o', str(host)], check=True)
    package = runtime / 'Cache/effect/7408076932065152296/9c891b188dd6b523a30efa8bfb63602b'
    base = {'host': str(host), 'library': str(library), 'arguments': [str(runtime), str(runtime / 'Models'), str(package)],
            'environment': ['DYLD_LIBRARY_PATH=' + str(runtime / 'Frameworks'), 'QCUT_FRAME_WIDTH=' + str(source['width']), 'QCUT_FRAME_HEIGHT=' + str(source['height'])]}
    if args.schedule == 'wait-after-first-coarse':
        base['waitAfterFirstPoll'] = True
    probe_paths = [*paths, *directory.glob('body_timestamp*.py'), directory / 'body_backend_probe.py', directory / 'body_backend_lldb.py',
                   directory / 'body_profile_lldb.py', directory / 'run_body_default_profile.py']
    snapshot = args.output / 'probe-sources'
    snapshot.mkdir()
    for path in probe_paths:
        (snapshot / path.name).write_bytes(path.read_bytes())
    provenance = {'scope': 'Same original RGBA; unchanged resident Swing host; timestamp interventions only; two renders per request.',
        'source': source, 'librarySha256': LIBRARY_SHA256, 'hostSha256': sha256(path=host),
        'luaSha256': sha256(path=package / 'AmazingFeature/lua/slimbody.lua'),
        'sourceProvenanceSha256': sha256(path=args.source_provenance),
        'sources': {path.name: sha256(path=path) for path in probe_paths}, 'cases': {name: CASES[name] for name in args.cases},
        'wallDelaySecondsAfterFirstRequest': .25, 'controls': parameters(parts=PARTS), 'schedule': args.schedule,
        'scheduleScope': 'Natural actual readiness.' if args.schedule == 'natural' else
            'Explicit diagnostic wait after first coarse readiness latch until both real loader listeners report success; no readiness value or reference route is injected.'}
    (args.output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    for name in args.cases:
        unobserved = None
        if args.schedule == 'natural':
            unobserved = run_case(output=args.output / (name + '-unobserved'), base=base, timestamps=CASES[name], source=source, observed=False)
        observed = run_case(output=args.output / name, base=base, timestamps=CASES[name], source=source, observed=True)
        transparency = [] if unobserved is None else [{'frame': a['frame'], 'exact': a['resultSha256'] == b['resultSha256']} for a, b in zip(observed, unobserved)]
        (args.output / name / 'observation-transparency.json').write_text(json.dumps(transparency, indent=2) + '\n')
        print(json.dumps({'case': name, 'transparentFrames': sum(row['exact'] for row in transparency)}), flush=True)


if __name__ == '__main__':
    main()
