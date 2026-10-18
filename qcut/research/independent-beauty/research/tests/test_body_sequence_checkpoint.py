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
from body_face_slots import FACE_SLOT_COUNT, BodyFaceSlot
from facefitting_image import decode_image

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
VIDEO_ASSETS = ('body-skeleton-v1.npz', 'body-face-video-policy-v1.json', 'face-detector-dynamic.onnx',
                'face-align-120.onnx', 'face-align-160.onnx', 'alignment-assets-v1.npz')
HAS_VIDEO_RUNTIME = all((RUNTIME / 'research' / name).is_file() for name in VIDEO_ASSETS)
# An ordered directory of PNG frames (frame-*.png) of one full-body person.
FRAMES = Path(os.environ.get('QCUT_BODY_VIDEO_FRAMES', '/nonexistent'))
# The native-observed recovery fixture re-enters frame 0 after its twelfth frame.
RECOVERY_FRAMES = Path(os.environ.get('QCUT_BODY_RETAINED_FACE_FRAMES', '/nonexistent'))
MULTI_FACE_FRAMES = Path(os.environ.get('QCUT_BODY_MULTI_FACE_FRAMES', '/nonexistent'))
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
        self.slots = [BodyFaceSlot() for _ in range(FACE_SLOT_COUNT)]
        self.size = None
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



def fake_slot(*, models, frame, identifier):
    slot = BodyFaceSlot()
    slot.active, slot.new = True, identifier > 0
    slot.identifier, slot.persistent_id, slot.age = identifier, identifier + 4096, frame * 3
    slot.index, slot.confidence = frame, np.float32(.75 + identifier / 100)
    slot.face = {'identity': (identifier, 4096, 0), 'mode': 'update', 'mean': np.full(212, frame, np.float32)}
    slot.points, slot.tracked = np.full((106, 2), frame, np.float32), np.full((106, 2), frame + 1, np.float32)
    slot.box = np.asarray([frame, frame + 1, 20, 30], np.float32)
    slot.roll_value = np.float32(frame / 100)
    slot.engine = Sequence.__new__(Sequence)
    slot.engine.models, slot.engine.index = models.copy(), frame - 1
    slot.engine.state, slot.engine.seen = np.full(4, frame, np.float64), {(identifier, 4096, 0)}
    slot.engine.tracking_profile = slot.face
    return slot


def advance(session, *, frame):
    """Give every part history as though `frame` frames had been processed."""
    if session.skeleton is None:
        session._initialize()
    session.skeleton.points = np.arange(36, dtype=np.float32).reshape(18, 2) + frame
    session.skeleton.size, session.skeleton.iterations, session.skeleton.frame = (640, 360), frame - 1, frame
    session.skeleton.last_debug = {'input': Mock()}
    face = session.face
    face.slots = [BodyFaceSlot() for _ in range(FACE_SLOT_COUNT)]
    face.slots[0] = fake_slot(models=face.models, frame=frame, identifier=0)
    face.size, face.relaxed = (640, 360), True
    face.recovery = VideoFaceRecovery(active=True, counter=frame)
    face.attempts = [{'size': 120, 'accepted': True}]
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
        self.assertEqual(session.face.slots[0].index, 5)
        engine = session.face.slots[0].engine
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
        np.testing.assert_array_equal(session.face.slots[0].face['mean'], np.full(212, 3, np.float32))

    def test_references_shared_in_the_session_stay_shared(self):
        session = fake_session()
        advance(session, frame=2)
        checkpoint.restore(session=session, data=checkpoint.capture(session=session))
        self.assertIs(session.composition.left, session.composition.right)

    def test_multiple_face_slots_keep_order_metadata_and_independent_histories(self):
        source = fake_session()
        advance(source, frame=7)
        source.face.slots[3] = fake_slot(models=source.face.models, frame=2, identifier=3)
        source.face.slots[1].persistent_id = 4097
        source.face.slots[1].age = 11
        source.face.slots[0].roll.pose.current = np.asarray([0, 0, 35], np.float32)
        source.face.slots[3].roll.pose.current = np.asarray([0, 0, -12], np.float32)
        source.face.slots[3].roll.pose.delta = np.asarray([0, 0, 2], np.float32)
        target = fake_session()
        advance(target, frame=19)
        models = target.face.models
        checkpoint.restore(session=target, data=checkpoint.capture(session=source))
        self.assertEqual(len(target.face.slots), FACE_SLOT_COUNT)
        self.assertEqual([slot.active for slot in target.face.slots], [True, False, False, True, False])
        self.assertEqual([slot.identifier for slot in target.face.slots], [0, -1, -1, 3, -1])
        self.assertEqual([slot.persistent_id for slot in target.face.slots], [4096, 4097, -1, 4099, -1])
        self.assertEqual(target.face.slots[1].age, 11)
        self.assertIsNone(target.face.slots[1].engine)
        for position, frame in ((0, 7), (3, 2)):
            with self.subTest(slot=position):
                slot = target.face.slots[position]
                self.assertEqual((slot.index, slot.age, slot.new), (frame, frame * 3, position > 0))
                self.assertEqual(slot.confidence, np.float32(.75 + position / 100))
                self.assertEqual(slot.roll_value, np.float32(frame / 100))
                np.testing.assert_array_equal(slot.box, [frame, frame + 1, 20, 30])
                np.testing.assert_array_equal(slot.points, np.full((106, 2), frame, np.float32))
                np.testing.assert_array_equal(slot.tracked, np.full((106, 2), frame + 1, np.float32))
                np.testing.assert_array_equal(slot.engine.state, np.full(4, frame, np.float64))
                self.assertEqual(slot.engine.index, frame - 1)
                self.assertIs(slot.engine.models[120], models[120])
                self.assertIs(slot.engine.models[160], models[160])
                self.assertIsNot(slot.engine.models, models)
                self.assertIs(slot.engine.tracking_profile, slot.face)
        first, fourth = target.face.slots[0], target.face.slots[3]
        np.testing.assert_array_equal(first.roll.pose.current, [0, 0, 35])
        np.testing.assert_array_equal(fourth.roll.pose.current, [0, 0, -12])
        np.testing.assert_array_equal(fourth.roll.pose.delta, [0, 0, 2])
        self.assertIsNot(first.roll, fourth.roll)
        self.assertIsNot(first.engine.models, fourth.engine.models)

    def test_shared_slot_and_engine_references_survive_without_model_handles(self):
        session = fake_session()
        advance(session, frame=4)
        session.face.slots[4] = fake_slot(models=session.face.models, frame=2, identifier=4)
        shared = session.face.slots[0].face['mean']
        session.face.slots[4].face['mean'] = shared
        session.face.models = {120: lambda: None, 160: lambda: None}
        for slot in session.face.slots:
            if slot.engine is not None:
                slot.engine.models = session.face.models.copy()
        data = checkpoint.capture(session=session)
        target = fake_session()
        checkpoint.restore(session=target, data=data)
        first, fifth = target.face.slots[0], target.face.slots[4]
        self.assertIs(first.face['mean'], fifth.face['mean'])
        self.assertIs(first.engine.tracking_profile, first.face)
        self.assertIs(fifth.engine.tracking_profile, fifth.face)
        self.assertIs(first.engine.models[120], target.face.models[120])
        self.assertIs(fifth.engine.models[160], target.face.models[160])

    def test_incomplete_slot_vectors_are_refused(self):
        session = fake_session()
        advance(session, frame=3)
        valid = pickle.loads(checkpoint.capture(session=session))
        session.face.slots.pop()
        with self.assertRaisesRegex(ValueError, 'five face slots'):
            checkpoint.capture(session=session)
        for slots in (None, [], valid['face_slots'][:4], valid['face_slots'] + valid['face_slots'][:1]):
            target = fake_session()
            with self.subTest(length=None if slots is None else len(slots)), self.assertRaisesRegex(ValueError, 'five face slots'):
                checkpoint.restore(session=target, data=pickle.dumps({**valid, 'face_slots': slots}))
            target._initialize.assert_not_called()

    def test_a_session_without_active_face_slots_restores_empty_slots(self):
        session = fake_session()
        advance(session, frame=2)
        session.face.slots = [BodyFaceSlot() for _ in range(FACE_SLOT_COUNT)]
        data = checkpoint.capture(session=session)
        advance(session, frame=4)
        checkpoint.restore(session=session, data=data)
        self.assertEqual(len(session.face.slots), FACE_SLOT_COUNT)
        self.assertTrue(all(not slot.active and slot.engine is None for slot in session.face.slots))

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

    def test_legacy_and_unknown_versions_are_refused_before_session_restart(self):
        for version in (0, 1, 3):
            session = fake_session()
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, 'unsupported'):
                checkpoint.restore(session=session, data=pickle.dumps({'version': version}))
            session._initialize.assert_not_called()

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


    @unittest.skipUnless(len(list(RECOVERY_FRAMES.glob('frame-*.png'))) >= 12,
                         'retained recovery needs QCUT_BODY_RETAINED_FACE_FRAMES (the native-observed 12-frame fixture)')
    def test_checkpoint_preserves_retained_face_recovery_history(self):
        rgbas = [decode_image(image=path, max_edge=4096)['rgba'] for path in sorted(RECOVERY_FRAMES.glob('frame-*.png'))[:12]]

        def render(session, *, frame):
            return session.process(rgba=rgbas[frame % 12], controls=CONTROLS, stream='recovery-clip',
                                   frame=frame, timestamp=frame / 24)

        with patch.dict(os.environ, {'BEAUTY_RENDER_RESOLUTION': 'original'}):
            continuous = module.BodySmartSequence(runtime=RUNTIME)
            for frame in range(14):
                render(continuous, frame=frame)
            self.assertTrue(continuous.face.recovery.active)
            self.assertTrue(any(slot.active and slot.engine is not None for slot in continuous.face.slots))
            self.assertEqual(continuous.face.recovery.counter, 1)
            data = checkpoint.capture(session=continuous)
            expected = [render(continuous, frame=frame) for frame in (14, 15)]
            resumed = module.BodySmartSequence(runtime=RUNTIME)
            checkpoint.restore(session=resumed, data=data)
            self.assertEqual(resumed.face.recovery.snapshot(), {'active': True, 'counter': 1})
            self.assertTrue(any(slot.active and slot.engine is not None for slot in resumed.face.slots))
            observed = [render(resumed, frame=frame) for frame in (14, 15)]
        for (pixels, receipt), (expected_pixels, expected_receipt) in zip(observed, expected, strict=True):
            np.testing.assert_array_equal(pixels, expected_pixels)
            self.assertEqual(receipt['meshSha256'], expected_receipt['meshSha256'])
            self.assertEqual(receipt['face'], expected_receipt['face'])
            self.assertEqual(receipt['face']['status'], 'recovery-retained')
            self.assertNotIn('retainedFaceDropped', receipt['face'])
        self.assertEqual(observed[0][1]['face']['recovery'], {'active': True, 'counter': 2})
        self.assertEqual(observed[1][1]['face']['recovery'], {'active': True, 'counter': 3})


@unittest.skipUnless(HAS_VIDEO_RUNTIME and all((MULTI_FACE_FRAMES / f'frame{i}.rgba').is_file() for i in range(40)),
                     'multi-slot checkpoints need QCUT_BODY_MULTI_FACE_FRAMES (40 composited 1080x1920 RGBA frames)')
class RealMultiSlotSnapshot(unittest.TestCase):
    def test_multiple_slot_loss_and_reentry_continue_exactly_after_restore(self):
        def process(session, *, frame):
            rgba = np.fromfile(MULTI_FACE_FRAMES / f'frame{frame}.rgba', np.uint8).reshape(1920, 1080, 4)
            _, receipt = session.process(rgba=rgba, controls=CONTROLS, stream='multi-slot-fixture',
                                         frame=frame, timestamp=frame / 24)
            points = [None if slot.points is None else slot.points.copy() for slot in session.face.slots]
            return receipt, points

        expected, snapshots = {}, {}
        with patch.dict(os.environ, {'BEAUTY_RENDER_RESOLUTION': 'original'}):
            continuous = module.BodySmartSequence(runtime=RUNTIME)
            for frame in range(40):
                expected[frame] = process(continuous, frame=frame)
                count = sum(slot.active for slot in continuous.face.slots)
                key = 'three' if count >= 3 else 'two' if count >= 2 else 'lost' if count == 0 and snapshots else None
                if key is not None and key not in snapshots and frame < 38:
                    snapshots[key] = frame, checkpoint.capture(session=continuous)
            self.assertEqual(set(snapshots), {'two', 'three', 'lost'})
            for label, (frame, data) in snapshots.items():
                resumed = module.BodySmartSequence(runtime=RUNTIME)
                checkpoint.restore(session=resumed, data=data)
                self.assertLess(len(data), 1024 * 1024)
                for following in (frame + 1, frame + 2):
                    with self.subTest(snapshot=label, frame=following):
                        receipt, points = process(resumed, frame=following)
                        prior, prior_points = expected[following]
                        self.assertEqual(receipt['outputRgbaSha256'], prior['outputRgbaSha256'])
                        self.assertEqual(receipt.get('meshSha256'), prior.get('meshSha256'))
                        self.assertEqual(receipt['face'], prior['face'])
                        for actual, reference in zip(points, prior_points, strict=True):
                            if reference is None:
                                self.assertIsNone(actual)
                            else:
                                np.testing.assert_array_equal(actual, reference)


if __name__ == '__main__':
    unittest.main()
