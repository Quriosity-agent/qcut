"""Exact snapshots of a body-video session, so a seek resumes from a checkpoint.

A snapshot holds the session's history and none of its models: the skeleton's
tracking points, each video face slot's tracking and roll, recovery state, the
persistent ten-part geometry, vertex-history caches and the frame clock.
Restoring the snapshot taken after frame n into a session (which keeps
or loads its networks) and processing frame n + 1 gives the bytes that
processing frames 0..n + 1 in one session gives.

Snapshots outlive the worker on disk, so reading one back admits only numpy's
array pieces and classes the engine itself defines; anything else is refused.
"""
import importlib
import importlib.util
import io
import json
from pathlib import Path
import pickle
import sys

from alignment_sequence import Sequence
from body_face_slots import FACE_SLOT_COUNT, BodyFaceSlot
from body_execution_profile import (BodyExecutionCheckpointError, MAX_STATE_BYTES, WARM_PROFILE, execution_identity,
                                    execution_json, session_execution_request)

# Earlier snapshots lack the native seed policy and retained segmentation state.
SNAPSHOT_VERSION = 5
EXECUTION_SNAPSHOT_VERSION = 6
ENGINE_ROOT = Path(__file__).resolve().parent
# Model handles and per-frame diagnostics; everything else an object holds is history.
SKELETON_HANDLES = frozenset({'networks', 'last_debug'})
FACE_HANDLES = frozenset({'root', 'policy', 'detector', 'models', 'assets', 'attempts', 'engine', 'slots'})
FACE_SLOT_HANDLES = frozenset({'engine'})
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


def _skeleton_handles(*, skeleton):
    extra = getattr(skeleton, 'checkpoint_handles', frozenset())
    if not isinstance(extra, frozenset) or any(not isinstance(name, str) for name in extra):
        raise ValueError('body skeleton checkpoint handles require a frozenset of names')
    return SKELETON_HANDLES | extra | {'checkpoint_handles'}


def _validate_execution(*, session, snapshot):
    requested = session_execution_request(session=session)
    version = snapshot.get('version')
    if version == SNAPSHOT_VERSION and requested['profile'] == WARM_PROFILE:
        return
    if version not in (SNAPSHOT_VERSION, EXECUTION_SNAPSHOT_VERSION):
        raise ValueError('unsupported body session snapshot')
    if version != EXECUTION_SNAPSHOT_VERSION or requested['profile'] == WARM_PROFILE:
        raise BodyExecutionCheckpointError('unsupported body checkpoint execution profile for the requested session')
    try:
        expected = execution_identity(session=session)
        if execution_json(value=snapshot.get('execution_identity')) != execution_json(value=expected):
            raise ValueError('body checkpoint execution identity does not match the requested session')
        state = json.loads(execution_json(value=snapshot['execution_state'], max_bytes=MAX_STATE_BYTES))
        session.validate_execution_state(state=state)
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise BodyExecutionCheckpointError(str(error)) from error


def _assign(*, owner, state):
    for key, value in state.items():
        setattr(owner, key, value)


def _capture_slot(*, slot):
    return {'history': _history(owner=slot, handles=FACE_SLOT_HANDLES),
            'engine': None if slot.engine is None else _history(owner=slot.engine, handles=FACE_ENGINE_HANDLES)}


def _restore_slot(*, state, models):
    slot = BodyFaceSlot.__new__(BodyFaceSlot)
    _assign(owner=slot, state=state['history'])
    slot.engine = None
    if state['engine'] is not None:
        engine = Sequence.__new__(Sequence)
        _assign(owner=engine, state=state['engine'])
        engine.models = models.copy()
        slot.engine = engine
    return slot


def capture(*, session):
    """The session's history as bytes; an incomplete session has none."""
    if session.invalid:
        raise ValueError('an incomplete body session has no snapshot; reset and replay')
    snapshot = {'version': SNAPSHOT_VERSION, 'initialized': session.skeleton is not None,
                'clock': {'stream': session.stream, 'size': session.size,
                          'next_frame': session.next_frame, 'timestamp': session.timestamp}}
    if session_execution_request(session=session)['profile'] != WARM_PROFILE:
        state = json.loads(execution_json(value=session.capture_execution_state(), max_bytes=MAX_STATE_BYTES))
        session.validate_execution_state(state=state)
        snapshot.update(version=EXECUTION_SNAPSHOT_VERSION,
                        execution_identity=execution_identity(session=session), execution_state=state)
    if snapshot['initialized']:
        if len(session.face.slots) != FACE_SLOT_COUNT:
            raise ValueError('five face slots required for a body snapshot')
        snapshot.update(
            skeleton=_history(owner=session.skeleton, handles=_skeleton_handles(skeleton=session.skeleton)),
            face=_history(owner=session.face, handles=FACE_HANDLES),
            face_slots=[_capture_slot(slot=slot) for slot in session.face.slots],
            composition=_history(owner=session.composition, handles=frozenset()))
    # One pickle keeps references shared between the objects shared after restore.
    return pickle.dumps(snapshot, protocol=pickle.HIGHEST_PROTOCOL)


def restore(*, session, data):
    """Put `session` in the state `capture` recorded, keeping its loaded networks."""
    snapshot = SnapshotUnpickler(io.BytesIO(data)).load()
    if not isinstance(snapshot, dict):
        raise ValueError('unsupported body session snapshot')
    _validate_execution(session=session, snapshot=snapshot)
    if snapshot.get('initialized'):
        slots = snapshot.get('face_slots')
        if not isinstance(slots, list) or len(slots) != FACE_SLOT_COUNT:
            raise ValueError('five face slots required for a body snapshot')
    session.restart()
    if snapshot['initialized']:
        _assign(owner=session.skeleton, state=snapshot['skeleton'])
        _assign(owner=session.face, state=snapshot['face'])
        session.face.slots = [_restore_slot(state=state, models=session.face.models)
                              for state in snapshot['face_slots']]
        _assign(owner=session.composition, state=snapshot['composition'])
    clock = snapshot['clock']
    session.stream, session.size = clock['stream'], clock['size']
    session.next_frame, session.timestamp = clock['next_frame'], clock['timestamp']
    if snapshot['version'] == EXECUTION_SNAPSHOT_VERSION:
        session.restore_execution_state(state=snapshot['execution_state'])
    return session
