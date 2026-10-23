"""The resident worker's body-video sessions: one engine, many clips' histories.

A session is one clip's frames from its first frame, named by the caller after
everything its pixels depend on. Frame k renders only after frames 0..k-1 of
its session, so the worker keeps each session's history as snapshots
(body_sequence_checkpoint): the newest state of a session the engine leaves,
and one snapshot every CHECKPOINT_INTERVAL frames, held in memory and written
to the session's checkpoint folder so they outlive the process. A frame no
snapshot reaches is answered with SequenceGap, naming the frame to replay from.
"""
from collections import OrderedDict
from contextlib import suppress
import json
import math
import os
from pathlib import Path
import re

from PIL import Image

from body_sequence_checkpoint import capture, restore
from body_smart_render import plain
from body_smart_sequence import BodySmartSequence
from body_execution_profile import (BodyExecutionCheckpointError, WARM_PROFILE, execution_request,
                                    execution_identity, session_execution_request)
from body_execution_journal import ExecutionRouteJournal
from facefitting_image import decode_image
from independent_stage_runner import stage_parameters
from render_resolution import source_edge_limit
from whiten_metal import process_images

SCRIPT = 'body_smart_render.py'
CHECKPOINT_INTERVAL = 12
MEMORY_BYTES = 128 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
SUFFIX = '.snapshot'
SESSION = re.compile(r'[0-9a-f]{64}')


class SequenceGap(ValueError):
    """The session's history does not reach the frame; replay from `restart_from`."""

    def __init__(self, *, restart_from):
        super().__init__(f'body video history resumes at frame {restart_from}')
        self.restart_from = restart_from


def validate_sequence(*, sequence):
    required = {'session', 'frame', 'timestamp', 'checkpoints'}
    optional = {'executionProfile', 'executionGeneration'}
    if not isinstance(sequence, dict) or not required <= set(sequence) <= required | optional:
        raise ValueError('a body video frame requires session, frame, timestamp and checkpoints')
    if not isinstance(sequence['session'], str) or SESSION.fullmatch(sequence['session']) is None:
        raise ValueError('a body video session is a SHA-256 hex digest')
    if type(sequence['frame']) is not int or not 0 <= sequence['frame'] < 2**31:
        raise ValueError('a body video frame index is a nonnegative integer')
    timestamp = sequence['timestamp']
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp < 0:
        raise ValueError('a body video timestamp is a finite nonnegative number')
    folder = sequence['checkpoints']
    if not isinstance(folder, str) or not folder or '\x00' in folder or len(folder) > 8192 or not Path(folder).is_absolute():
        raise ValueError('a body video checkpoint folder is a bounded absolute path')
    if any(name in sequence and not isinstance(sequence[name], str) for name in optional):
        raise ValueError('explicit body execution fields require strings')
    execution_request(execution_profile=sequence.get('executionProfile'),
                      execution_generation=sequence.get('executionGeneration'))
    return sequence


class SequenceSessions:
    def __init__(self, *, runtime, engine=None, interval=CHECKPOINT_INTERVAL, memory_bytes=MEMORY_BYTES,
                 engine_factory=None):
        self.runtime = Path(runtime)
        self.engine_factory = engine_factory or BodySmartSequence
        self.engine = engine if engine is not None else self.engine_factory(runtime=self.runtime)
        self.execution_request = session_execution_request(session=self.engine)
        self.journal = None
        self.interval, self.memory_bytes = interval, memory_bytes
        self.active = None
        self.snapshots = OrderedDict()
        self.bytes = 0
        self.closed = False

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            close = getattr(self.engine, 'close', None)
            if callable(close):
                close()
        finally:
            self.active, self.journal = None, None
            self.snapshots.clear()
            self.bytes = 0

    def snapshot(self):
        return {'active': self.active is not None, 'nextFrame': self.engine.next_frame,
                'memorySnapshots': len(self.snapshots), 'memoryBytes': self.bytes}

    def _live(self, session):
        return self.active == session and not self.engine.invalid

    def _remember(self, *, session, frame, data):
        key = (session, frame)
        if key in self.snapshots:
            self.bytes -= len(self.snapshots.pop(key))
        self.snapshots[key] = data
        self.bytes += len(data)
        while self.bytes > self.memory_bytes and len(self.snapshots) > 1:
            _, evicted = self.snapshots.popitem(last=False)
            self.bytes -= len(evicted)

    @staticmethod
    def _path(*, checkpoints, frame):
        return Path(checkpoints) / f'{frame:010d}{SUFFIX}'

    def _stored(self, *, session, checkpoints):
        frames = {frame for owner, frame in self.snapshots if owner == session}
        folder = Path(checkpoints)
        if folder.is_dir():
            frames.update(int(path.name.removesuffix(SUFFIX)) for path in folder.iterdir()
                          if re.fullmatch(r'\d{10}' + re.escape(SUFFIX), path.name))
        return frames

    def _nearest(self, *, session, frame, checkpoints):
        frames = {stored for stored in self._stored(session=session, checkpoints=checkpoints) if stored <= frame}
        if self._live(session) and self.engine.next_frame <= frame:
            frames.add(self.engine.next_frame)
        return max(frames, default=0)

    def _load(self, *, session, frame, checkpoints):
        data = self.snapshots.get((session, frame))
        if data is not None:
            self.snapshots.move_to_end((session, frame))
            return data
        path = self._path(checkpoints=checkpoints, frame=frame)
        try:
            if path.stat().st_size <= MAX_SNAPSHOT_BYTES:
                return path.read_bytes()
        except FileNotFoundError:
            return None
        path.unlink(missing_ok=True)
        return None

    def _discard(self, *, session, frame, checkpoints):
        data = self.snapshots.pop((session, frame), None)
        self.bytes -= len(data or b'')
        self._path(checkpoints=checkpoints, frame=frame).unlink(missing_ok=True)

    def _park(self):
        """Keep the newest state of the session the engine is about to leave."""
        if self.active is not None and not self.engine.invalid and self.engine.next_frame > 0:
            self._remember(session=self.active, frame=self.engine.next_frame, data=capture(session=self.engine))

    def _select_execution(self, *, execution_profile, execution_generation):
        requested = execution_request(execution_profile=execution_profile,
                                      execution_generation=execution_generation)
        if requested == self.execution_request:
            return
        self._park()
        engine = self.engine_factory(runtime=self.runtime, execution_profile=requested['profile'],
                                     execution_generation=requested.get('generation'))
        previous = self.engine
        self.engine, self.active, self.execution_request = engine, None, requested
        self.journal = None
        close = getattr(previous, 'close', None)
        if callable(close):
            close()

    def _execution_journal(self, *, session, checkpoints):
        if self.execution_request['profile'] == WARM_PROFILE:
            return None
        identity = execution_identity(session=self.engine)
        if (self.journal is None or self.journal.path.parent != Path(checkpoints)
                or self.journal.header['session'] != session or self.journal.header['identity'] != identity):
            return ExecutionRouteJournal(session=session, checkpoints=checkpoints, identity=identity)
        return self.journal

    def _apply_execution_replay(self, *, replace_context=False):
        if self.journal is not None:
            self.engine.apply_execution_replay(routes=self.journal.routes(), replace_context=replace_context)

    def prepare(self, *, session, frame, checkpoints, execution_profile=None, execution_generation=None):
        """Bring the engine to `frame` of `session` and say how, or raise SequenceGap."""
        if self.closed:
            raise ValueError('body video sessions are closed')
        self._select_execution(execution_profile=execution_profile, execution_generation=execution_generation)
        journal = self._execution_journal(session=session, checkpoints=checkpoints)
        if self._live(session) and self.engine.next_frame == frame:
            self.journal = journal
            self._apply_execution_replay()
            return 'continued'
        if frame == 0:
            self._park()
            self.active = None
            self.engine.restart()
            self.journal = journal
            self._apply_execution_replay()
            self.active = session
            return 'restarted'
        data = self._load(session=session, frame=frame, checkpoints=checkpoints)
        if data is None:
            raise SequenceGap(restart_from=self._nearest(session=session, frame=frame, checkpoints=checkpoints))
        self._park()
        self.active = None
        self.journal = journal
        self._apply_execution_replay(replace_context=True)
        try:
            restore(session=self.engine, data=data)
            if self.engine.stream != session or self.engine.next_frame != frame:
                raise ValueError('body snapshot belongs to another session or frame')
            self._apply_execution_replay()
        except BodyExecutionCheckpointError:
            raise
        except Exception as error:
            if self.execution_request['profile'] != WARM_PROFILE:
                raise BodyExecutionCheckpointError('Swing body checkpoint cannot restore its exact execution history') from error
            # An unreadable snapshot is only a lost checkpoint: drop it and replay from an earlier one.
            self._discard(session=session, frame=frame, checkpoints=checkpoints)
            raise SequenceGap(restart_from=self._nearest(session=session, frame=frame, checkpoints=checkpoints))
        self.active = session
        return 'restored'

    def _checkpoint(self, *, session, checkpoints):
        frame, data = self.engine.next_frame, capture(session=self.engine)
        self._remember(session=session, frame=frame, data=data)
        path = self._path(checkpoints=checkpoints, frame=frame)
        temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(data)
            os.replace(temporary, path)
        except OSError as error:
            with suppress(OSError):
                temporary.unlink()
            return {'frame': frame, 'stored': False, 'error': f'{type(error).__name__}: {error}'}
        return {'frame': frame, 'stored': True}

    def render(self, *, session, frame, timestamp, checkpoints, rgba, controls,
               execution_profile=None, execution_generation=None):
        """Frame `frame` of a prepared session; every CHECKPOINT_INTERVAL frames leaves a snapshot."""
        requested = execution_request(execution_profile=execution_profile, execution_generation=execution_generation)
        if requested != self.execution_request or not self._live(session) or self.engine.next_frame != frame:
            raise ValueError('prepare the body video session before rendering its frame')
        input_identity = None
        if self.journal is not None:
            input_identity = self.journal.frame_input(frame=frame, rgba=rgba, controls=controls, timestamp=timestamp)
        try:
            result, receipt = self.engine.process(rgba=rgba, controls=controls, stream=session,
                                                  frame=frame, timestamp=timestamp)
            if self.journal is not None:
                self.journal.commit(frame=frame, input_identity=input_identity,
                                    routes=self.engine.capture_execution_state()['routes'])
                self._apply_execution_replay()
        except BaseException:
            self.engine.invalid = True
            raise
        if self.engine.next_frame % self.interval == 0:
            receipt['checkpoint'] = self._checkpoint(session=session, checkpoints=checkpoints)
        return result, receipt

    def stage_runner(self, *, sequence, resumed, fallback):
        """A pipeline stage runner rendering the smart-body stage from this request's session."""
        def run(*, stage, source, image, runtime, output, report, **arguments):
            if stage['script'] != SCRIPT:
                return fallback(stage=stage, source=source, image=image, runtime=runtime,
                                output=output, report=report, **arguments)
            if arguments:
                raise ValueError('the body video stage takes no face reference or source evidence')
            if Path(source).resolve() != Path(__file__).with_name(SCRIPT).resolve():
                raise ValueError('body video stage does not match its verified source')
            if Path(runtime).resolve() != self.runtime.resolve():
                raise ValueError('body video sessions are bound to one runtime')
            controls = stage_parameters(script=SCRIPT, parameters=stage['parameters'])['controls']
            rgba = decode_image(image=image, max_edge=source_edge_limit())['rgba']
            result, receipt = self.render(session=sequence['session'], frame=sequence['frame'],
                                          timestamp=sequence['timestamp'], checkpoints=sequence['checkpoints'],
                                          rgba=rgba, controls=controls,
                                          execution_profile=sequence.get('executionProfile'),
                                          execution_generation=sequence.get('executionGeneration'))
            receipt.update(resumed=resumed, independence=process_images())
            Image.fromarray(result).save(output)
            report.write_text(json.dumps(plain(receipt), allow_nan=False) + '\n')
            run.rendered = True

        run.rendered = False
        return run
