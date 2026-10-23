"""Serial JSONL renderer retaining imports, stateless CPU model sessions and body-video histories.

A request with `sequence` renders frame `frame` of a body-video session
(independent_sequence_sessions). When the session's history does not reach that frame the
reply is not ok and names the frame to replay from; the worker itself stays usable.
"""
import argparse
from collections import OrderedDict
from contextlib import contextmanager, redirect_stdout
import json
import os
from pathlib import Path
import re
import sys

from PIL import Image

from independent_pipeline import clean_environment, parse_json, run
from independent_sequence_sessions import SequenceGap, SequenceSessions, validate_sequence
from independent_session_cache import SessionCache, reuse_sessions
from independent_stage_runner import run_stage
from render_resolution import RESOLUTION_ENV, resolution_mode


MAX_REQUEST_BYTES = 64 * 1024
MAX_ERROR_CHARACTERS = 4096
REQUEST_PATHS = ('image', 'request', 'output', 'report')


def validate_request(*, request):
    if (not isinstance(request, dict)
            or not {'id', *REQUEST_PATHS} <= set(request) <= {'id', *REQUEST_PATHS, 'resolution', 'source_evidence',
                                                             'sequence', 'outerRequestId'}):
        raise ValueError('resident request requires id and four explicit paths')
    identifier = request['id']
    if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128 or any(ord(char) < 32 for char in identifier):
        raise ValueError('bounded printable request id required')
    if 'outerRequestId' in request:
        outer = request['outerRequestId']
        if not isinstance(outer, str) or re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', outer) is None:
            raise ValueError('bounded outer request identity required')
    for name in (*REQUEST_PATHS, *(['source_evidence'] if 'source_evidence' in request else [])):
        value = request[name]
        if not isinstance(value, str) or not value or '\x00' in value or len(value) > 8192 or not Path(value).is_absolute():
            raise ValueError('bounded absolute resident paths required')
    if 'resolution' in request:
        resolution_mode(mode=request['resolution'])
    if 'sequence' in request:
        validate_sequence(sequence=request['sequence'])
    return request


def request_resolution(*, request):
    if 'resolution' in request:
        return resolution_mode(mode=request['resolution'])
    with Image.open(request['image']) as source:
        return 'original' if max(source.size) > 1280 else 'preview'


@contextmanager
def owned_sequence_sessions(*, sessions):
    try:
        yield
    finally:
        close = getattr(sessions, 'close', None)
        if callable(close):
            close()


def serve(*, runtime, input_stream, output_stream, render=run, sessions=SequenceSessions):
    runtime = Path(runtime).resolve(strict=True)
    if not runtime.is_dir():
        raise ValueError('runtime directory required')
    environment = clean_environment(runtime=runtime)
    os.environ.clear()
    os.environ.update(environment)
    cache = SessionCache()
    sessions = sessions(runtime=runtime)
    plans = OrderedDict()
    completed = 0
    with reuse_sessions(cache=cache), owned_sequence_sessions(sessions=sessions):
        while True:
            line = input_stream.readline(MAX_REQUEST_BYTES + 1)
            if not line:
                return
            request = {}
            try:
                if len(line) > MAX_REQUEST_BYTES or not line.endswith(b'\n'):
                    raise ValueError('resident request exceeds its complete JSONL line budget')
                request = validate_request(request=parse_json(data=line, limit=MAX_REQUEST_BYTES))
                mode = request_resolution(request=request)
                os.environ[RESOLUTION_ENV] = mode
                sequence, stage_runner = request.get('sequence'), run_stage
                if sequence is not None:
                    execution = {}
                    if 'executionProfile' in sequence or 'executionGeneration' in sequence:
                        execution = {'execution_profile': sequence.get('executionProfile'),
                                     'execution_generation': sequence.get('executionGeneration')}
                    resumed = sessions.prepare(session=sequence['session'], frame=sequence['frame'],
                                               checkpoints=sequence['checkpoints'], **execution)
                    stage_runner = sessions.stage_runner(sequence=sequence, resumed=resumed, fallback=run_stage)
                with redirect_stdout(sys.stderr):
                    render(image=request['image'], request=request['request'], runtime=runtime,
                           output=request['output'], report=request['report'], resolution=mode,
                           stage_runner=stage_runner, plan_cache=plans,
                           **({'source_evidence': Path(request['source_evidence'])} if 'source_evidence' in request else {}),
                           runtime_receipt=lambda: {'pid': os.getpid(), 'completedJobsBefore': completed,
                                                    'sessionCache': cache.snapshot(), 'plansRemembered': len(plans),
                                                    'bodySessions': sessions.snapshot()})
                if sequence is not None and not stage_runner.rendered:
                    raise ValueError('a body video frame requires the smart-body stage')
                completed += 1
                response = {'id': request['id'], 'ok': True}
                if sequence is not None:
                    response['sequence'] = {'nextFrame': sessions.engine.next_frame, 'resumed': resumed}
            except SequenceGap as gap:
                response = {'id': request['id'], 'ok': False, 'error': f'SequenceGap: {gap}',
                            'gap': {'restartFrom': gap.restart_from}}
            except (Exception, SystemExit) as error:
                identifier = request.get('id') if isinstance(request, dict) else None
                if not isinstance(identifier, str) or len(identifier) > 128:
                    identifier = None
                response = {'id': identifier, 'ok': False,
                            'error': f'{type(error).__name__}: {error}'[:MAX_ERROR_CHARACTERS]}
            output_stream.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + '\n')
            output_stream.flush()
            if len(line) > MAX_REQUEST_BYTES or not line.endswith(b'\n'):
                return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    arguments = parser.parse_args()
    serve(runtime=arguments.runtime, input_stream=sys.stdin.buffer, output_stream=sys.stdout)


if __name__ == '__main__':
    main()
