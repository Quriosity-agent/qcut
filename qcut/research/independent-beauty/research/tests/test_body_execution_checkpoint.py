"""Opt-in execution checkpoints cannot replace another backend or readiness history."""
import pickle
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_sequence_checkpoint as checkpoint
from body_execution_profile import BodyExecutionCheckpointError, SWING_PROFILE, WARM_PROFILE
from test_body_sequence_checkpoint import advance, fake_session


def swing_session(*, generation='run-one', model='model-a'):
    session = fake_session()
    session.execution_profile, session.execution_generation = SWING_PROFILE, generation
    session._execution = SimpleNamespace(identity={'profile': SWING_PROFILE, 'generation': generation,
        'model': model, 'helper': 'helper-a', 'source': 'source-a',
        'schedule': 'per-detector-listener-latch-v1'}, reset=lambda: None)
    session.execution_state = {'coarseReady': False, 'refineReady': True,
                               'routes': [['coarse', 'cpu'], ['refine', 'cpu'], ['refine', 'coreml']]}
    session.capture_execution_state = Mock(side_effect=lambda: session.execution_state)
    session.validate_execution_state = Mock()

    def restore_state(*, state):
        session.execution_state = state

    session.restore_execution_state = Mock(side_effect=restore_state)
    return session


class ExecutionSnapshots(unittest.TestCase):
    def test_warm_snapshot_bytes_and_version_remain_unchanged(self):
        session = fake_session()
        advance(session, frame=4)
        before = checkpoint.capture(session=session)
        session.execution_profile, session.execution_generation = WARM_PROFILE, None
        self.assertEqual(checkpoint.capture(session=session), before)
        snapshot = pickle.loads(before)
        self.assertEqual(snapshot['version'], 5)
        self.assertNotIn('execution_identity', snapshot)
        self.assertNotIn('execution_state', snapshot)

    def test_matching_v6_restores_route_state_and_excludes_helper_handles(self):
        source = swing_session()
        advance(source, frame=4)
        source.skeleton.checkpoint_handles = frozenset({'helper'})
        source.skeleton.helper = lambda: None
        data = checkpoint.capture(session=source)
        snapshot = pickle.loads(data)
        self.assertEqual(snapshot['version'], 6)
        self.assertEqual(snapshot['execution_identity'], source.execution_identity)
        self.assertEqual(snapshot['execution_state'], source.execution_state)
        self.assertNotIn('helper', snapshot['skeleton'])
        self.assertNotIn('checkpoint_handles', snapshot['skeleton'])
        target = swing_session()
        advance(target, frame=8)
        target.execution_state = {'routes': []}
        target.skeleton.checkpoint_handles = frozenset({'helper'})
        helper = target.skeleton.helper = object()
        checkpoint.restore(session=target, data=data)
        self.assertEqual(target.next_frame, 4)
        self.assertIs(target.skeleton.helper, helper)
        self.assertEqual(target.execution_state, snapshot['execution_state'])
        target.restore_execution_state.assert_called_once_with(state=snapshot['execution_state'])

    def assert_refused_without_mutation(self, *, source, target, message):
        data = checkpoint.capture(session=source)
        advance(target, frame=9)
        before = checkpoint.capture(session=target)
        skeleton, networks = target.skeleton, target.skeleton.networks
        with patch.object(target, 'restart', wraps=target.restart) as restart:
            with self.assertRaisesRegex(BodyExecutionCheckpointError, message):
                checkpoint.restore(session=target, data=data)
            restart.assert_not_called()
        self.assertIs(target.skeleton, skeleton)
        self.assertIs(target.skeleton.networks, networks)
        self.assertEqual(checkpoint.capture(session=target), before)

    def test_v5_only_restores_into_warm_and_v6_only_into_opt_in(self):
        warm = fake_session()
        advance(warm, frame=3)
        self.assert_refused_without_mutation(source=warm, target=swing_session(), message='profile')
        swing = swing_session()
        advance(swing, frame=3)
        self.assert_refused_without_mutation(source=swing, target=fake_session(), message='profile')

    def test_generation_model_helper_source_and_schedule_all_bind_history(self):
        for field in ('generation', 'model', 'helper', 'source', 'schedule'):
            source, target = swing_session(), swing_session()
            advance(source, frame=3)
            target._execution.identity[field] = 'different'
            if field == 'generation':
                target.execution_generation = 'different'
            with self.subTest(field=field):
                self.assert_refused_without_mutation(source=source, target=target, message='identity')

    def test_unreplayable_route_history_is_refused_before_restart(self):
        source, target = swing_session(), swing_session()
        advance(source, frame=3)
        advance(target, frame=9)
        data = checkpoint.capture(session=source)
        before = checkpoint.capture(session=target)
        target.validate_execution_state.side_effect = ValueError('recorded readiness cannot be replayed')
        with patch.object(target, 'restart', wraps=target.restart) as restart:
            with self.assertRaisesRegex(BodyExecutionCheckpointError, 'readiness cannot be replayed'):
                checkpoint.restore(session=target, data=data)
            restart.assert_not_called()
        target.validate_execution_state.side_effect = None
        self.assertEqual(checkpoint.capture(session=target), before)
        target.restore_execution_state.assert_not_called()

    def test_missing_or_non_json_execution_state_is_refused_before_restart(self):
        source = swing_session()
        advance(source, frame=2)
        snapshot = pickle.loads(checkpoint.capture(session=source))
        for state in (float('nan'), {'routes': (1, 2)}):
            target = swing_session()
            with self.subTest(state=state), patch.object(target, 'restart') as restart:
                with self.assertRaises(BodyExecutionCheckpointError):
                    checkpoint.restore(session=target, data=pickle.dumps({**snapshot, 'execution_state': state}))
                restart.assert_not_called()


if __name__ == '__main__':
    unittest.main()
