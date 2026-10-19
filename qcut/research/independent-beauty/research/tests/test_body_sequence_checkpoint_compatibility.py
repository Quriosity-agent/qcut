"""Older geometry profiles must not replace a live native-video session's state."""
import pickle
import unittest
from unittest.mock import patch

import body_sequence_checkpoint as checkpoint
from body_composition.native_video import NativeVideoBody
from body_composition.persistent import PersistentCombinedBody
from test_body_sequence_checkpoint import advance, fake_session


class SnapshotCompatibility(unittest.TestCase):
    def assert_legacy_snapshot_is_refused(self, *, version):
        legacy = fake_session()
        advance(legacy, frame=3)
        legacy.composition = PersistentCombinedBody(mode=2) if version == 2 else NativeVideoBody()
        old_snapshot = pickle.loads(checkpoint.capture(session=legacy))
        old_snapshot['version'] = version
        old_snapshot['composition'].pop('_effect_time', None)
        old_snapshot['composition'].pop('_reset_frame', None)

        session = fake_session()
        advance(session, frame=9)
        session.composition = NativeVideoBody()
        session.composition.configure_controls(controls={'SmallHead': 25})
        session.composition.frame = 9
        before = checkpoint.capture(session=session)
        skeleton, face, composition = session.skeleton, session.face, session.composition
        networks, models, slots = skeleton.networks, face.models, face.slots
        initializations = session._initialize.call_count

        with patch.object(session, 'restart', wraps=session.restart) as restart:
            with self.assertRaisesRegex(ValueError, 'unsupported body session snapshot'):
                checkpoint.restore(session=session, data=pickle.dumps(old_snapshot, protocol=pickle.HIGHEST_PROTOCOL))
            restart.assert_not_called()

        self.assertEqual(checkpoint.capture(session=session), before)
        self.assertEqual(session._initialize.call_count, initializations)
        self.assertIs(session.skeleton, skeleton)
        self.assertIs(session.face, face)
        self.assertIs(session.composition, composition)
        self.assertIs(session.skeleton.networks, networks)
        self.assertIs(session.face.models, models)
        self.assertIs(session.face.slots, slots)
        self.assertEqual(session.composition.mode, 0)
        self.assertTrue(session.composition._configuration_dirty)
        self.assertEqual((session.next_frame, session.timestamp, session.invalid), (9, 8 / 24, False))
        self.assertEqual(pickle.loads(before)['version'], 5)

    def test_previous_histories_are_refused_before_mutating_a_warm_native_session(self):
        for version in (2, 3, 4):
            with self.subTest(version=version):
                self.assert_legacy_snapshot_is_refused(version=version)


if __name__ == '__main__':
    unittest.main()
