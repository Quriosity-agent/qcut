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
    if not isinstance(sequence, dict) or set(sequence) != {'session', 'frame', 'timestamp', 'checkpoints'}:
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
    return sequence


class SequenceSessions:
    def __init__(self, *, runtime, engine=None, interval=CHECKPOINT_INTERVAL, memory_bytes=MEMORY_BYTES):
        self.runtime = Path(runtime)
        self.engine = engine if engine is not None else BodySmartSequence(runtime=self.runtime)
        self.interval, self.memory_bytes = interval, memory_bytes
        self.active = None
        self.snapshots = OrderedDict()
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

    def prepare(self, *, session, frame, checkpoints):
        """Bring the engine to `frame` of `session` and say how, or raise SequenceGap."""
        if self._live(session) and self.engine.next_frame == frame:
            return 'continued'
        if frame == 0:
            self._park()
            self.active = None
            self.engine.restart()
            self.active = session
            return 'restarted'
        data = self._load(session=session, frame=frame, checkpoints=checkpoints)
        if data is None:
            raise SequenceGap(restart_from=self._nearest(session=session, frame=frame, checkpoints=checkpoints))
        self._park()
        self.active = None
        try:
            restore(session=self.engine, data=data)
            if self.engine.stream != session or self.engine.next_frame != frame:
                raise ValueError('body snapshot belongs to another session or frame')
        except Exception:
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

    def render(self, *, session, frame, timestamp, checkpoints, rgba, controls):
        """Frame `frame` of a prepared session; every CHECKPOINT_INTERVAL frames leaves a snapshot."""
        if not self._live(session) or self.engine.next_frame != frame:
            raise ValueError('prepare the body video session before rendering its frame')
        result, receipt = self.engine.process(rgba=rgba, controls=controls, stream=session,
                                              frame=frame, timestamp=timestamp)
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
                                          rgba=rgba, controls=controls)
            receipt.update(resumed=resumed, independence=process_images())
            Image.fromarray(result).save(output)
            report.write_text(json.dumps(plain(receipt), allow_nan=False) + '\n')
            run.rendered = True

        run.rendered = False
        return run
