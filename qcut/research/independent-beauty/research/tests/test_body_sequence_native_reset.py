"""Native effect-clock transitions survive snapshots without rewinding frame order."""
from pathlib import Path
import pickle
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_sequence_checkpoint as checkpoint
import body_smart_sequence as sequence
from body_composition.native_video import NativeVideoBody
from body_control_events import resolve_control_events
from test_body_composition import synthetic_inputs
import test_body_sequence_checkpoint as fixtures


RESET = {'type': 'reset_params'}
SET_HEAD = {'type': 'set_control', 'name': 'SmallHead', 'value': 25}
CONTROLS = {'SmallHead': 25, 'SlimHip': 25, 'SlimArm': 25, 'StretchLeg': 25}


class SyntheticSkeleton(fixtures.FakeSkeleton):
    def update(self, *, algorithm):
        self.frame += 1
        supplied = synthetic_inputs()
        self.points = supplied['coords']
        self.last_debug = {'network': 'refine', 'plan': {'mode': 1}, 'state': {'objects': 1}}
        return {name: supplied[name] for name in ('coords', 'visibility')}


class SyntheticFace(fixtures.FakeFace):
    def reset(self):
        super().reset()
        self.frame = 0

    def update(self, *, algorithm):
        self.frame += 1
        supplied = synthetic_inputs()
        return {name: supplied[name] for name in ('faces', 'rectangles', 'rolls')}, {'status': 'synthetic'}


@unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
class NativeResetSnapshots(unittest.TestCase):
    assert_history_equal = fixtures.AbsentBodySnapshot.assert_history_equal

    def new_session(self):
        return fixtures.AbsentBodySnapshot.new_session(self, composition_factory=NativeVideoBody)

    def advance(self, *, session, frame, timestamp, controls, events=(), present=True):
        supplied = synthetic_inputs()
        supplied['coords'] = supplied['coords'] + np.float32(frame * .0007)
        if not present:
            supplied.update(coords=np.zeros((18, 2), np.float32), visibility=np.zeros(18, np.uint8),
                            faces=None, rectangles=None, rolls=None, body_present=False)
        resolved = resolve_control_events(controls=controls, control_events=events)
        session.composition.configure_controls(controls=resolved.values, reapply=resolved.force_reapply)
        session.composition.configure_frame(timestamp=timestamp, reset_clock=resolved.reset_clock)
        mesh = session.composition.update(**supplied, targets=resolved.targets)
        session.stream, session.size = 'native-clock', (supplied['height'], supplied['width'])
        session.next_frame, session.timestamp = frame + 1, timestamp
        return mesh

    def test_jump_reverse_repeat_and_ordered_events_resume_from_each_side_of_a_reset(self):
        rows = [
            {'timestamp': 0}, {'timestamp': .033}, {'timestamp': .066}, {'timestamp': .099},
            {'timestamp': .75, 'present': False}, {'timestamp': .75, 'present': False},
            {'timestamp': .70}, {'timestamp': .70, 'events': [RESET], 'present': False},
            {'timestamp': .703, 'controls': {}, 'present': False},
            {'timestamp': .9, 'controls': {}, 'present': False},
            {'timestamp': .2, 'events': [RESET, SET_HEAD]},
            {'timestamp': .2, 'controls': {'SmallHead': 25}},
            {'timestamp': .21, 'controls': {'SmallHead': 25}},
            {'timestamp': .243, 'controls': {'SmallHead': 25}},
        ]
        session = self.new_session()
        expected, snapshots = {}, {}
        for frame, row in enumerate(rows):
            if frame == 4:
                retained = {name: history.values.copy()
                            for name, history in session.composition.vertex_history.items()}
            mesh = self.advance(session=session, frame=frame, **{'controls': CONTROLS, **row})
            self.assertEqual(session.next_frame, frame + 1)
            self.assertEqual(session.composition._effect_time, row['timestamp'])
            if frame == 4:
                for name, values in retained.items():
                    history = session.composition.vertex_history[name]
                    self.assertFalse(history.initialized)
                    self.assertTrue(np.any(values))
                    np.testing.assert_array_equal(history.values, values)
            data = checkpoint.capture(session=session)
            expected[frame] = mesh['positions'].copy(), data
            if frame in (3, 4, 7, 10):
                snapshots[frame] = data
        for saved_frame, data in snapshots.items():
            resumed = self.new_session()
            networks, models = resumed.skeleton.networks, resumed.face.models
            checkpoint.restore(session=resumed, data=data)
            self.assertIs(resumed.skeleton.networks, networks)
            self.assertIs(resumed.face.models, models)
            for frame in range(saved_frame + 1, len(rows)):
                with self.subTest(snapshot=saved_frame, frame=frame):
                    mesh = self.advance(session=resumed, frame=frame, **{'controls': CONTROLS, **rows[frame]})
                    positions, state = expected[frame]
                    np.testing.assert_array_equal(mesh['positions'], positions)
                    self.assert_history_equal(pickle.loads(checkpoint.capture(session=resumed)),
                                              pickle.loads(state))

    def test_reset_at_repeated_timestamp_uses_its_effect_clock_without_rewinding_submission(self):
        session = self.new_session()
        for frame, timestamp in enumerate((0, .03, .06, .09)):
            self.advance(session=session, frame=frame, timestamp=timestamp, controls=CONTROLS)
        self.advance(session=session, frame=4, timestamp=.09, controls=CONTROLS,
                     events=[RESET, SET_HEAD])
        self.assertEqual(session.composition.mode, 1)
        self.assertEqual((session.next_frame, session.timestamp, session.composition._effect_time), (5, .09, .09))
        resumed = self.new_session()
        checkpoint.restore(session=resumed, data=checkpoint.capture(session=session))
        self.assertEqual(resumed.composition._effect_time, .09)
        expected = self.advance(session=session, frame=5, timestamp=.09, controls={'SmallHead': 25})
        actual = self.advance(session=resumed, frame=5, timestamp=.09, controls={'SmallHead': 25})
        self.assertEqual(resumed.composition.mode, 2)
        self.assertEqual(resumed.next_frame, 6)
        np.testing.assert_array_equal(actual['positions'], expected['positions'])
        self.assert_history_equal(pickle.loads(checkpoint.capture(session=resumed)),
                                  pickle.loads(checkpoint.capture(session=session)))

    def test_cancelled_or_failed_real_warm_reset_restores_and_replays_exactly_once(self):
        rgba = np.full((128, 72, 4), 255, np.uint8)

        def create_session():
            session = fixtures.fake_session()
            def initialize():
                session.skeleton, session.face = SyntheticSkeleton(), SyntheticFace()
                session.composition = NativeVideoBody()
            session._initialize.side_effect = initialize
            return session

        def frame(*, session, index, timestamp, cancelled=None, events=()):
            return session.process(rgba=rgba, controls=CONTROLS, stream='warm-reset', frame=index,
                                   timestamp=timestamp, control_events=events, cancelled=cancelled)

        for failure in ('cancel', 'gpu'):
            with self.subTest(failure=failure), patch.object(sequence, 'algorithm_image', return_value=(rgba, {})), \
                    patch.object(sequence, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}), \
                    patch.object(sequence, 'draw_mesh', return_value=(rgba.copy(), {})) as draw:
                session = create_session()
                for index, timestamp in enumerate((0, .033, .066)):
                    frame(session=session, index=index, timestamp=timestamp)
                saved = checkpoint.capture(session=session)
                models, networks = session.face.models, session.skeleton.networks
                events = [RESET, SET_HEAD]
                if failure == 'gpu':
                    draw.side_effect = RuntimeError('GPU process failed')
                cancelled = (lambda: session.composition.frame == 4) if failure == 'cancel' else None
                error = sequence.BodySequenceCancelled if failure == 'cancel' else RuntimeError
                with self.assertRaises(error):
                    frame(session=session, index=3, timestamp=.75, events=events, cancelled=cancelled)
                self.assertTrue(session.invalid)
                self.assertEqual(session.composition._effect_time, .75)
                self.assertEqual(session.composition.frame, 4)
                self.assertEqual((session.next_frame, session.timestamp), (3, .066))
                self.assertIs(session.face.models, models)
                self.assertIs(session.skeleton.networks, networks)
                with self.assertRaisesRegex(ValueError, 'incomplete'):
                    checkpoint.capture(session=session)
                with self.assertRaisesRegex(ValueError, 'reset and replay'):
                    frame(session=session, index=3, timestamp=.75, events=events)

                draw.side_effect = None
                reference = create_session()
                checkpoint.restore(session=reference, data=saved)
                checkpoint.restore(session=session, data=saved)
                self.assertEqual(session.composition._effect_time, .066)
                actual, receipt = frame(session=session, index=3, timestamp=.75, events=events)
                expected, expected_receipt = frame(session=reference, index=3, timestamp=.75, events=events)
                np.testing.assert_array_equal(actual, expected)
                self.assertEqual(receipt['meshSha256'], expected_receipt['meshSha256'])
                self.assert_history_equal(pickle.loads(checkpoint.capture(session=session)),
                                          pickle.loads(checkpoint.capture(session=reference)))
                self.assertEqual((session.next_frame, session.composition.frame), (4, 4))
                session._initialize.assert_called_once()
                self.assertIs(session.face.models, models)
                self.assertIs(session.skeleton.networks, networks)


if __name__ == '__main__':
    unittest.main()
