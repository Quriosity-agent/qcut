"""Worker history replay uses only recorded own backend routes and input identities."""
import copy
from pathlib import Path
import pickle
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_sequence_sessions as module
from body_execution_profile import BodyExecutionCheckpointError, SWING_PROFILE, WARM_PROFILE
from test_independent_sequence_sessions import FakeEngine, fake_capture, fake_restore

SESSION = 'a' * 64


class RoutingEngine(FakeEngine):
    def __init__(self, *, runtime=None, execution_profile=WARM_PROFILE, execution_generation=None):
        self.execution_profile, self.execution_generation = execution_profile, execution_generation
        self.execution_identity = {'profile': execution_profile, 'generation': execution_generation,
                                   'model': 'model', 'helper': 'helper'}
        self.own_ready, self.closed = False, False
        super().__init__()

    def reset(self):
        super().reset()
        self.routes, self.replay = [], []

    def apply_execution_replay(self, *, routes, replace_context=False):
        if not replace_context and self.routes != routes[:len(self.routes)]:
            raise ValueError('fake executed route conflict')
        self.replay = copy.deepcopy(routes)

    def capture_execution_state(self):
        return {'routes': copy.deepcopy(self.routes)}

    def process(self, **arguments):
        index = len(self.routes)
        self.routes.append(copy.deepcopy(self.replay[index]) if index < len(self.replay)
                           else {'network': 'refine', 'backend': 'coreml' if self.own_ready else 'cpu'})
        return super().process(**arguments)

    def close(self):
        self.closed = True


def capture(*, session):
    return pickle.dumps({'history': fake_capture(session=session), 'identity': session.execution_identity,
                         'routes': session.routes})


def restore(*, session, data):
    saved = pickle.loads(data)
    if saved['identity'] != session.execution_identity:
        raise BodyExecutionCheckpointError('fake execution identity mismatch')
    routes = saved['routes']
    if routes != session.replay[:len(routes)]:
        raise BodyExecutionCheckpointError('fake execution route prefix mismatch')
    fake_restore(session=session, data=saved['history'])
    session.routes = routes


class ExecutionSessions(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='body-execution-sessions-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rgba = np.zeros((4, 4, 4), np.uint8)
        self.addCleanup(patch.stopall)
        patch.object(module, 'capture', side_effect=capture).start()
        patch.object(module, 'restore', side_effect=restore).start()
        self.factory = Mock(side_effect=RoutingEngine)
        self.table = self.make_table()

    def make_table(self):
        return module.SequenceSessions(runtime=self.root, engine_factory=self.factory, interval=2)

    def request(self, *, frame, generation='run-one', checkpoints=None):
        return {'session': SESSION, 'frame': frame, 'checkpoints': str(checkpoints or self.root / generation),
                'execution_profile': SWING_PROFILE, 'execution_generation': generation}

    def frame(self, *, frame, table=None, generation='run-one', checkpoints=None, **changes):
        table = table or self.table
        request = self.request(frame=frame, generation=generation, checkpoints=checkpoints)
        resumed = table.prepare(**request)
        pixels, receipt = table.render(**request, timestamp=frame / 30, rgba=self.rgba,
                                       controls=changes.get('controls', {'SlimBody': 40}))
        return resumed, pixels, receipt

    def test_profile_switch_constructs_explicit_engine_and_closes_previous(self):
        warm = self.table.engine
        self.frame(frame=0)
        self.assertTrue(warm.closed)
        self.factory.assert_called_with(runtime=self.root, execution_profile=SWING_PROFILE, execution_generation='run-one')
        engine = self.table.engine
        self.frame(frame=1)
        self.assertIs(self.table.engine, engine)
        self.assertEqual(self.factory.call_count, 2)

    def test_close_releases_active_engine_once_and_refuses_new_frames(self):
        self.frame(frame=0)
        engine = self.table.engine
        engine.close = Mock(wraps=engine.close)
        self.table.close()
        self.table.close()
        engine.close.assert_called_once()
        self.assertTrue(engine.closed)
        self.assertIsNone(self.table.active)
        self.assertIsNone(self.table.journal)
        self.assertEqual(self.table.bytes, 0)
        with self.assertRaisesRegex(ValueError, 'closed'):
            self.table.prepare(**self.request(frame=1))

    def test_replay_preserves_recorded_choices_while_future_calls_use_new_readiness(self):
        self.frame(frame=0)
        self.table.engine.own_ready = True
        self.frame(frame=1)
        first_routes = copy.deepcopy(self.table.engine.routes)
        self.assertEqual([route['backend'] for route in first_routes], ['cpu', 'coreml'])
        self.frame(frame=0)
        self.frame(frame=1)
        self.assertEqual(self.table.engine.routes, first_routes)
        self.frame(frame=2)
        self.assertEqual(self.table.engine.routes[-1]['backend'], 'coreml')

    def test_checkpoint_and_journal_survive_worker_replacement(self):
        self.frame(frame=0)
        self.table.engine.own_ready = True
        self.frame(frame=1)
        self.frame(frame=2)
        replacement = self.make_table()
        resumed, _, _ = self.frame(frame=2, table=replacement)
        self.assertEqual(resumed, 'restored')
        self.assertEqual(replacement.engine.routes, self.table.engine.routes)
        self.assertEqual([route['backend'] for route in replacement.engine.routes], ['cpu', 'coreml', 'coreml'])

    def test_failed_partial_frame_is_absent_from_journal_and_replays_cleanly(self):
        self.frame(frame=0)
        self.table.engine.fail = RuntimeError('cancelled in frame')
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            self.frame(frame=1)
        self.assertEqual(len(self.table.engine.routes), 2)
        self.assertEqual(len(self.table.journal.routes()), 1)
        self.table.engine.fail = None
        self.frame(frame=0)
        self.frame(frame=1)
        self.assertEqual(len(self.table.journal.frames), 2)

    def test_replay_input_conflict_fails_before_processing(self):
        self.frame(frame=0)
        processed = len(self.table.engine.processed)
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'input conflicts'):
            self.frame(frame=0, controls={'SlimBody': 55})
        self.assertEqual(len(self.table.engine.processed), processed)

    def test_checkpoint_identity_failure_is_not_deleted_or_relabelled_as_gap(self):
        self.frame(frame=0)
        self.frame(frame=1)
        path = Path(self.request(frame=2)['checkpoints']) / '0000000002.snapshot'
        original = path.read_bytes()
        replacement = self.make_table()
        with patch.object(module, 'restore', side_effect=BodyExecutionCheckpointError('cannot replay exact readiness')):
            with self.assertRaisesRegex(BodyExecutionCheckpointError, 'exact readiness'):
                replacement.prepare(**self.request(frame=2))
        self.assertEqual(path.read_bytes(), original)

    def test_new_generation_uses_separate_journal_and_unknown_profile_never_constructs(self):
        self.frame(frame=0)
        self.table.engine.own_ready = True
        self.frame(frame=0, generation='run-two')
        self.assertEqual(self.table.journal.header['identity']['generation'], 'run-two')
        self.assertEqual(self.table.engine.routes[0]['backend'], 'cpu')
        self.assertTrue((self.root / 'run-one/execution-routes-v1.json').exists())
        calls = self.factory.call_count
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            self.table.prepare(**{**self.request(frame=0), 'execution_profile': 'automatic'})
        self.assertEqual(self.factory.call_count, calls)

    def test_same_session_generations_restore_their_own_checkpoint_and_parked_history(self):
        for frame in range(3):
            self.frame(frame=frame)
        original = copy.deepcopy(self.table.engine.routes)
        self.table.prepare(**self.request(frame=0, generation='run-two'))
        self.table.engine.own_ready = True
        for frame in range(3):
            self.frame(frame=frame, generation='run-two')
        alternate = copy.deepcopy(self.table.engine.routes)
        self.assertNotEqual(original, alternate)
        self.assertEqual(self.table.prepare(**self.request(frame=2)), 'restored')
        self.assertEqual(self.table.engine.routes, original[:2])
        self.assertEqual(self.table.prepare(**self.request(frame=3, generation='run-two')), 'restored')
        self.assertEqual(self.table.engine.routes, alternate)
        self.assertEqual(self.table.prepare(**self.request(frame=3)), 'restored')
        self.assertEqual(self.table.engine.routes, original)

    def test_empty_folder_cannot_continue_live_history_or_advertise_its_checkpoints(self):
        for frame in range(3):
            self.frame(frame=frame)
        other = self.root / 'empty-history'
        for frame in (2, 3, 9):
            with self.subTest(frame=frame):
                with self.assertRaises(module.SequenceGap) as gap:
                    self.table.prepare(**self.request(frame=frame, checkpoints=other))
                self.assertEqual(gap.exception.restart_from, 0)
        self.assertEqual(self.frame(frame=3)[0], 'continued')

    def test_same_generation_folders_restore_their_own_routes(self):
        for frame in range(3):
            self.frame(frame=frame)
        original = copy.deepcopy(self.table.engine.routes)
        other = self.root / 'other-history'
        self.table.prepare(**self.request(frame=0, checkpoints=other))
        self.table.engine.own_ready = True
        for frame in range(3):
            self.frame(frame=frame, checkpoints=other)
        alternate = copy.deepcopy(self.table.engine.routes)
        self.assertNotEqual(original, alternate)
        self.assertEqual(self.table.prepare(**self.request(frame=2)), 'restored')
        self.assertEqual(self.table.engine.routes, original[:2])
        self.assertEqual(self.table.prepare(**self.request(frame=3, checkpoints=other)), 'restored')
        self.assertEqual(self.table.engine.routes, alternate)
        self.assertEqual(self.table.prepare(**self.request(frame=3)), 'restored')
        self.assertEqual(self.table.engine.routes, original)

    def test_render_cannot_write_another_folder_without_preparing_it(self):
        self.frame(frame=0)
        request = self.request(frame=1, checkpoints=self.root / 'unprepared')
        with self.assertRaisesRegex(ValueError, 'prepare'):
            self.table.render(**request, rgba=self.rgba, timestamp=1 / 30, controls={'SlimBody': 40})
        self.assertEqual(self.table.engine.next_frame, 1)
        self.assertFalse(Path(request['checkpoints']).exists())

    def test_switching_clip_journals_parks_previous_routes_before_installing_new_prefix(self):
        self.frame(frame=0)
        old_routes = copy.deepcopy(self.table.engine.routes)
        old_capture = module.capture.side_effect

        def verify_capture(*, session):
            self.assertEqual(session.routes, session.replay[:len(session.routes)])
            return old_capture(session=session)

        other = {**self.request(frame=0), 'session': 'b' * 64, 'checkpoints': str(self.root / 'other-clip')}
        with patch.object(module, 'capture', side_effect=verify_capture):
            self.table.prepare(**other)
        self.table.engine.own_ready = True
        self.table.render(**other, rgba=self.rgba, timestamp=0, controls={'SlimBody': 55})
        self.assertNotEqual(self.table.engine.routes, old_routes)
        resumed, _, _ = self.frame(frame=1)
        self.assertEqual(resumed, 'restored')
        self.assertEqual(self.table.engine.routes[:1], old_routes)

    def test_sequence_transport_requires_named_profile_and_explicit_generation(self):
        sequence = {'session': SESSION, 'frame': 0, 'timestamp': 0, 'checkpoints': str(self.root)}
        valid = {**sequence, 'executionProfile': SWING_PROFILE, 'executionGeneration': 'run-one'}
        self.assertEqual(module.validate_sequence(sequence=valid), valid)
        for update in ({'executionProfile': SWING_PROFILE}, {'executionProfile': None},
                       {'executionGeneration': 'run-one'}, {'executionProfile': 'automatic'},
                       {'executionProfile': SWING_PROFILE, 'executionGeneration': None}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                module.validate_sequence(sequence={**sequence, **update})


if __name__ == '__main__':
    unittest.main()
