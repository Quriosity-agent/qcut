"""A body-video snapshot resumes a session exactly and admits only engine classes."""
import os
from pathlib import Path
import pickle
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_sequence_checkpoint as checkpoint
import body_smart_sequence as module
from alignment_sequence import Sequence
from body_face_recovery import VideoFaceRecovery
from facefitting_image import decode_image

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
VIDEO_ASSETS = ('body-skeleton-v1.npz', 'body-face-video-policy-v1.json', 'face-detector-dynamic.onnx',
                'face-align-120.onnx', 'face-align-160.onnx', 'alignment-assets-v1.npz')
HAS_VIDEO_RUNTIME = all((RUNTIME / 'research' / name).is_file() for name in VIDEO_ASSETS)
# An ordered directory of PNG frames (frame-*.png) of one full-body person.
FRAMES = Path(os.environ.get('QCUT_BODY_VIDEO_FRAMES', '/nonexistent'))
CONTROLS = {name: 25 for name in ('SmallHead', 'SwanNeck', 'SlimArm', 'OrthoShoulder', 'WidenShoulderTest',
                                  'SlimBody', 'SlimWaist', 'StretchLeg', 'SlimBreast', 'SlimHip')}


class FakeSkeleton:
    def __init__(self):
        self.networks = Mock()
        self.reset()

    def reset(self):
        self.points, self.size, self.iterations, self.frame, self.last_debug = None, None, 0, 0, None


class FakeFace:
    def __init__(self):
        self.root = self.policy = self.detector = self.assets = Mock()
        self.models = {120: Mock(), 160: Mock()}
        self.reset()

    def reset(self):
        self.engine, self.face, self.index, self.size = None, None, 0, None
        self.relaxed, self.recovery, self.attempts = False, VideoFaceRecovery(), []


class FakeComposition:
    def __init__(self):
        self.reset()

    def reset(self):
        self.states, self.frame, self.left, self.right = None, 0, None, None


def fake_session():
    session = module.BodySmartSequence(runtime=Path('/unused-runtime'))

    def initialize():
        session.skeleton, session.face, session.composition = FakeSkeleton(), FakeFace(), FakeComposition()

    session._initialize = Mock(side_effect=initialize)
    return session


def advance(session, *, frame):
    """Give every part history as though `frame` frames had been processed."""
    if session.skeleton is None:
        session._initialize()
    session.skeleton.points = np.arange(36, dtype=np.float32).reshape(18, 2) + frame
    session.skeleton.size, session.skeleton.iterations, session.skeleton.frame = (640, 360), frame - 1, frame
    session.skeleton.last_debug = {'input': Mock()}
    face = session.face
    face.face = {'identity': (0, 4096, 0), 'mode': 'update', 'mean': np.full(212, frame, np.float32)}
    face.index, face.size, face.relaxed = frame, (640, 360), True
    face.recovery = VideoFaceRecovery(active=True, counter=frame)
    face.attempts = [{'size': 120, 'accepted': True}]
    face.engine = Sequence.__new__(Sequence)
    face.engine.models, face.engine.index = face.models.copy(), frame - 1
    face.engine.state, face.engine.seen = np.full(4, frame, np.float64), {(0, 4096, 0)}
    shared = [frame, np.float32(frame / 2)]
    session.composition.states = {'SlimArm': {'intensity': np.float32(frame / 10)}}
    session.composition.frame = frame
    session.composition.left = session.composition.right = shared
    session.stream, session.size = 'clip', (360, 640)
    session.next_frame, session.timestamp = frame, (frame - 1) / 24


class SnapshotContract(unittest.TestCase):
    def test_restore_brings_back_history_and_keeps_the_loaded_models(self):
        session = fake_session()
        advance(session, frame=5)
        networks, models = session.skeleton.networks, session.face.models
        data = checkpoint.capture(session=session)
        self.assertLess(len(data), 64 * 1024)
        advance(session, frame=9)
        session.invalid = True
        checkpoint.restore(session=session, data=data)
        self.assertEqual(session._initialize.call_count, 1)
        self.assertIs(session.skeleton.networks, networks)
        self.assertIs(session.face.models, models)
        np.testing.assert_array_equal(session.skeleton.points, np.arange(36, dtype=np.float32).reshape(18, 2) + 5)
        self.assertEqual((session.skeleton.iterations, session.skeleton.frame), (4, 5))
        self.assertIsNone(session.skeleton.last_debug)
        self.assertEqual(session.face.recovery, VideoFaceRecovery(active=True, counter=5))
        self.assertEqual(session.face.attempts, [])
        self.assertEqual(session.face.index, 5)
        engine = session.face.engine
        self.assertEqual(engine.index, 4)
        self.assertEqual(engine.seen, {(0, 4096, 0)})
        self.assertIs(engine.models[120], models[120])
        self.assertIsNot(engine.models, models)
        self.assertEqual(session.composition.states['SlimArm']['intensity'], np.float32(.5))
        self.assertEqual((session.stream, session.size, session.next_frame), ('clip', (360, 640), 5))
        self.assertEqual(session.timestamp, 4 / 24)
        self.assertFalse(session.invalid)

    def test_restore_into_a_fresh_session_loads_its_models_once(self):
        source = fake_session()
        advance(source, frame=3)
        session = fake_session()
        checkpoint.restore(session=session, data=checkpoint.capture(session=source))
        self.assertEqual(session._initialize.call_count, 1)
        self.assertEqual(session.next_frame, 3)
        np.testing.assert_array_equal(session.face.face['mean'], np.full(212, 3, np.float32))

    def test_references_shared_in_the_session_stay_shared(self):
        session = fake_session()
        advance(session, frame=2)
        checkpoint.restore(session=session, data=checkpoint.capture(session=session))
        self.assertIs(session.composition.left, session.composition.right)

    def test_a_session_without_a_face_engine_restores_none(self):
        session = fake_session()
        advance(session, frame=2)
        session.face.engine = None
        data = checkpoint.capture(session=session)
        advance(session, frame=4)
        checkpoint.restore(session=session, data=data)
        self.assertIsNone(session.face.engine)

    def test_an_unstarted_session_restores_to_frame_zero(self):
        session = fake_session()
        data = checkpoint.capture(session=session)
        advance(session, frame=6)
        checkpoint.restore(session=session, data=data)
        self.assertEqual((session.next_frame, session.stream, session.timestamp), (0, None, None))
        self.assertIsNone(session.skeleton.points)

    def test_an_incomplete_session_has_no_snapshot(self):
        session = fake_session()
        advance(session, frame=2)
        session.invalid = True
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            checkpoint.capture(session=session)

    def test_unknown_versions_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            checkpoint.restore(session=fake_session(), data=pickle.dumps({'version': 2}))

    def test_engine_classes_are_imported_on_demand_in_a_fresh_process(self):
        session = fake_session()
        advance(session, frame=2)
        data = checkpoint.capture(session=session)
        # A worker that has rendered nothing yet has not imported the recovery module.
        module = sys.modules.pop('body_face_recovery')
        try:
            checkpoint.restore(session=fake_session(), data=data)
            self.assertIn('body_face_recovery', sys.modules)
        finally:
            sys.modules['body_face_recovery'] = module

    def test_only_numpy_pieces_and_engine_classes_are_admitted(self):
        refused = [pickle.dumps({'version': 1, 'call': os.system}),
                   # A class an engine module only imports, an engine function, a dotted attribute.
                   b'cbody_sequence_checkpoint\nPath\n.', b'cbody_sequence_checkpoint\ncapture\n.',
                   b'calignment_sequence\nSequence.process\n.', b'cnot_an_imported_module\nThing\n.',
                   # Importable, but not an engine module.
                   b'cjson.decoder\nJSONDecoder\n.', b'cunittest.mock\nMock\n.']
        for data in refused:
            with self.subTest(data=data[:48]), self.assertRaises(pickle.UnpicklingError):
                checkpoint.restore(session=fake_session(), data=data)


@unittest.skipUnless(HAS_VIDEO_RUNTIME and len(list(FRAMES.glob('frame-*.png'))) >= 8,
                     'private video runtime or QCUT_BODY_VIDEO_FRAMES (8+ frames of one person) missing')
class RealSnapshot(unittest.TestCase):
    def test_a_restored_session_continues_byte_identically(self):
        rgbas = [decode_image(image=path, max_edge=4096)['rgba'] for path in sorted(FRAMES.glob('frame-*.png'))[:8]]

        def render(session, frames):
            return [session.process(rgba=rgbas[frame], controls=CONTROLS, stream='clip', frame=frame,
                                    timestamp=frame / 24)[0] for frame in frames]

        with patch.dict(os.environ, {'BEAUTY_RENDER_RESOLUTION': 'original'}):
            expected = render(module.BodySmartSequence(runtime=RUNTIME), range(8))
            first = module.BodySmartSequence(runtime=RUNTIME)
            render(first, range(4))
            data = checkpoint.capture(session=first)
            resumed = module.BodySmartSequence(runtime=RUNTIME)
            checkpoint.restore(session=resumed, data=data)
            continued = render(resumed, range(4, 8))
            render(first, range(4, 7))
            checkpoint.restore(session=first, data=data)
            sought = render(first, range(4, 8))
        self.assertLess(len(data), 1024 * 1024)
        self.assertTrue(any(not np.array_equal(frame, rgbas[index]) for index, frame in enumerate(expected)))
        for index in range(4):
            with self.subTest(frame=index + 4):
                np.testing.assert_array_equal(continued[index], expected[index + 4])
                np.testing.assert_array_equal(sought[index], expected[index + 4])


if __name__ == '__main__':
    unittest.main()
