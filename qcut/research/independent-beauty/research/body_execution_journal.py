"""Completed-frame backend choices for replaying one opt-in execution generation."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import uuid

from body_execution_profile import BodyExecutionCheckpointError, MAX_STATE_BYTES, execution_json

MAX_ROUTES_PER_FRAME = 8
JOURNAL_NAME = 'execution-routes-v1.json'


def _encoded(*, value):
    return execution_json(value=value, max_bytes=MAX_STATE_BYTES).encode('ascii')


def _validate_routes(*, routes):
    if not isinstance(routes, list):
        raise BodyExecutionCheckpointError('body execution routes require a list')
    for route in routes:
        if (not isinstance(route, dict) or route.get('network') not in ('coarse', 'refine')
                or route.get('backend') not in ('cpu', 'coreml')):
            raise BodyExecutionCheckpointError('body execution route requires a known network and backend')
        execution_json(value=route)


class ExecutionRouteJournal:
    def __init__(self, *, session, checkpoints, identity):
        self.path = Path(checkpoints) / JOURNAL_NAME
        self.header = {'version': 1, 'session': session, 'identity': json.loads(execution_json(value=identity))}
        data = self._read()
        self.expected = data
        self.frames = []
        if data is None:
            return
        try:
            saved = json.loads(data)
            if not isinstance(saved, dict) or set(saved) != {*self.header, 'frames'}:
                raise ValueError('invalid journal envelope')
            if any(saved[key] != value for key, value in self.header.items()):
                raise ValueError('journal belongs to another session or execution identity')
            if not isinstance(saved['frames'], list):
                raise ValueError('journal frames require a list')
            for index, frame in enumerate(saved['frames']):
                if (not isinstance(frame, dict) or set(frame) != {'frame', 'input', 'routes'}
                        or type(frame['frame']) is not int or frame['frame'] != index):
                    raise ValueError('journal frame order is invalid')
                if not isinstance(frame['input'], str) or len(frame['input']) != 64 or any(c not in '0123456789abcdef' for c in frame['input']):
                    raise ValueError('journal input requires a SHA-256 digest')
                _validate_routes(routes=frame['routes'])
                if not 1 <= len(frame['routes']) <= MAX_ROUTES_PER_FRAME:
                    raise ValueError('journal frame route count is outside its bound')
            self.frames = saved['frames']
        except (ValueError, TypeError) as error:
            raise BodyExecutionCheckpointError(f'body execution journal is invalid: {error}') from error

    def _read(self):
        try:
            with self.path.open('rb') as source:
                data = source.read(MAX_STATE_BYTES + 1)
        except FileNotFoundError:
            return None
        if len(data) > MAX_STATE_BYTES:
            raise BodyExecutionCheckpointError('body execution journal exceeds its byte budget')
        return data

    def routes(self):
        return json.loads(_encoded(value=[route for frame in self.frames for route in frame['routes']]))

    def frame_input(self, *, frame, rgba, controls, timestamp):
        if type(frame) is not int or not 0 <= frame <= len(self.frames):
            raise BodyExecutionCheckpointError('body execution journal requires contiguous frame history')
        value = {'rgba': hashlib.sha256(rgba.tobytes()).hexdigest(), 'shape': list(rgba.shape),
                 'controls': controls, 'timestamp': timestamp}
        identity = hashlib.sha256(execution_json(value=value).encode('ascii')).hexdigest()
        if frame < len(self.frames) and identity != self.frames[frame]['input']:
            raise BodyExecutionCheckpointError('body execution journal input conflicts with recorded history')
        return identity

    @contextmanager
    def _locked(self):
        import fcntl

        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix('.lock').open('a+b') as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BodyExecutionCheckpointError('body execution journal has another writer') from error
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def commit(self, *, frame, input_identity, routes):
        _validate_routes(routes=routes)
        if (not isinstance(input_identity, str) or len(input_identity) != 64
                or any(character not in '0123456789abcdef' for character in input_identity)):
            raise BodyExecutionCheckpointError('body execution journal input requires a SHA-256 digest')
        if type(frame) is not int or not 0 <= frame <= len(self.frames):
            raise BodyExecutionCheckpointError('body execution journal commit is not contiguous')
        previous = [route for entry in self.frames[:frame] for route in entry['routes']]
        if routes[:len(previous)] != previous:
            raise BodyExecutionCheckpointError('body execution journal route prefix conflicts with recorded history')
        current = routes[len(previous):]
        if not 1 <= len(current) <= MAX_ROUTES_PER_FRAME:
            raise BodyExecutionCheckpointError('body execution frame route count is outside its bound')
        record = {'frame': frame, 'input': input_identity, 'routes': current}
        if frame < len(self.frames):
            if record != self.frames[frame]:
                raise BodyExecutionCheckpointError('body execution replay conflicts with its recorded frame')
            return
        frames = [*self.frames, record]
        data = _encoded(value={**self.header, 'frames': frames})
        temporary = self.path.with_name(f'.{self.path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp')
        try:
            with self._locked():
                if self._read() != self.expected:
                    raise BodyExecutionCheckpointError('body execution journal changed under this writer')
                temporary.write_bytes(data)
                os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
        self.frames, self.expected = json.loads(data)['frames'], data
