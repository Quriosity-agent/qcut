"""Exact snapshots of a body-video session, so a seek resumes from a checkpoint.

A snapshot holds the session's history and none of its models: the skeleton's
tracking points, the video face's tracking, recovery and roll state, the
persistent ten-part geometry and the frame clock, about 50 KB for a 1080p
stream. Restoring the snapshot taken after frame n into a session (which keeps
or loads its networks) and processing frame n + 1 gives the bytes that
processing frames 0..n + 1 in one session gives.

Snapshots outlive the worker on disk, so reading one back admits only numpy's
array pieces and classes the engine itself defines; anything else is refused.
"""
import importlib
import importlib.util
import io
from pathlib import Path
import pickle
import sys

from alignment_sequence import Sequence

SNAPSHOT_VERSION = 1
ENGINE_ROOT = Path(__file__).resolve().parent
# Model handles and per-frame diagnostics; everything else an object holds is history.
SKELETON_HANDLES = frozenset({'networks', 'last_debug'})
FACE_HANDLES = frozenset({'root', 'policy', 'detector', 'models', 'assets', 'attempts', 'engine'})
FACE_ENGINE_HANDLES = frozenset({'models'})
NUMPY_PIECES = frozenset({
    ('numpy', 'dtype'), ('numpy', 'ndarray'),
    *((f'numpy.{core}.multiarray', name) for core in ('core', '_core') for name in ('scalar', '_reconstruct')),
    *((f'numpy.{core}.numeric', '_frombuffer') for core in ('core', '_core')),
})


def _engine_module(name):
    """The engine module `name`, imported on demand; a fresh worker holds few of them yet."""
    module = sys.modules.get(name)
    if module is None:
        try:
            origin = getattr(importlib.util.find_spec(name), 'origin', None)
        except (ImportError, ValueError):
            origin = None
        if origin is None or not Path(origin).resolve().is_relative_to(ENGINE_ROOT):
            return None
        module = importlib.import_module(name)
    source = getattr(module, '__file__', None)
    return module if source and Path(source).resolve().is_relative_to(ENGINE_ROOT) else None


class SnapshotUnpickler(pickle.Unpickler):
    """Rebuilds numpy arrays and engine-defined classes; refuses every other global."""

    def find_class(self, module, name):
        if (module, name) in NUMPY_PIECES:
            return super().find_class(module, name)
        owner = _engine_module(module) if '.' not in name else None
        value = getattr(owner, name, None)
        if not isinstance(value, type) or value.__module__ != module:
            raise pickle.UnpicklingError(f'body snapshot refers to {module}.{name}')
        return value


def _history(*, owner, handles):
    return {key: value for key, value in vars(owner).items() if key not in handles}


def _assign(*, owner, state):
    for key, value in state.items():
        setattr(owner, key, value)


def capture(*, session):
    """The session's history as bytes; an incomplete session has none."""
    if session.invalid:
        raise ValueError('an incomplete body session has no snapshot; reset and replay')
    snapshot = {'version': SNAPSHOT_VERSION, 'initialized': session.skeleton is not None,
                'clock': {'stream': session.stream, 'size': session.size,
                          'next_frame': session.next_frame, 'timestamp': session.timestamp}}
    if snapshot['initialized']:
        engine = session.face.engine
        snapshot.update(
            skeleton=_history(owner=session.skeleton, handles=SKELETON_HANDLES),
            face=_history(owner=session.face, handles=FACE_HANDLES),
            face_engine=None if engine is None else _history(owner=engine, handles=FACE_ENGINE_HANDLES),
            composition=_history(owner=session.composition, handles=frozenset()))
    # One pickle keeps references shared between the objects shared after restore.
    return pickle.dumps(snapshot, protocol=pickle.HIGHEST_PROTOCOL)


def restore(*, session, data):
    """Put `session` in the state `capture` recorded, keeping its loaded networks."""
    snapshot = SnapshotUnpickler(io.BytesIO(data)).load()
    if not isinstance(snapshot, dict) or snapshot.get('version') != SNAPSHOT_VERSION:
        raise ValueError('unsupported body session snapshot')
    session.restart()
    if snapshot['initialized']:
        _assign(owner=session.skeleton, state=snapshot['skeleton'])
        _assign(owner=session.face, state=snapshot['face'])
        session.face.engine = None
        if snapshot['face_engine'] is not None:
            engine = Sequence.__new__(Sequence)
            _assign(owner=engine, state=snapshot['face_engine'])
            engine.models = session.face.models.copy()
            session.face.engine = engine
        _assign(owner=session.composition, state=snapshot['composition'])
    clock = snapshot['clock']
    session.stream, session.size = clock['stream'], clock['size']
    session.next_frame, session.timestamp = clock['next_frame'], clock['timestamp']
    return session
