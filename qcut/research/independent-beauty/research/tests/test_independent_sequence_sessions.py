"""Body-video sessions resume from snapshots, answer gaps and survive the worker."""
import json
import os
from pathlib import Path
import pickle
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_sequence_sessions as module

SESSION_A, SESSION_B = 'a' * 64, 'b' * 64


class FakeEngine:
    """The slice of BodySmartSequence the session table drives; frames add to a history."""

    def __init__(self):
        self.restarts, self.processed, self.fail = 0, [], None
        self.reset()

    def reset(self):
        self.stream, self.next_frame, self.history, self.invalid = None, 0, [], False

    def restart(self):
        self.restarts += 1
        self.reset()

    def process(self, *, rgba, controls, stream, frame, timestamp):
        if self.invalid or frame != self.next_frame or self.stream not in (None, stream):
            raise ValueError('contiguous frame index required')
        if self.fail is not None:
            self.invalid = True
            raise self.fail
        self.stream = stream
        self.history.append(frame)
        self.next_frame += 1
        self.processed.append((stream, frame))
        return rgba + np.uint8(len(self.history)), {'frame': frame, 'history': list(self.history)}


def fake_capture(*, session):
    if session.invalid:
        raise ValueError('incomplete')
    return pickle.dumps({'stream': session.stream, 'next_frame': session.next_frame, 'history': session.history})


def fake_restore(*, session, data):
    state = pickle.loads(data)
    session.reset()
    session.stream, session.next_frame, session.history = state['stream'], state['next_frame'], list(state['history'])
    return session


class SessionTable(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='body-sessions-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.addCleanup(patch.stopall)
        patch.object(module, 'capture', side_effect=fake_capture).start()
        patch.object(module, 'restore', side_effect=fake_restore).start()
        self.engine = FakeEngine()
        self.sessions = self.table(engine=self.engine)
        self.rgba = np.zeros((4, 4, 4), np.uint8)

    def table(self, *, engine=None, **options):
        return module.SequenceSessions(runtime=self.root, engine=engine or FakeEngine(),
                                       **{'interval': 3, **options})

    def folder(self, session=SESSION_A):
        return str(self.root / 'checkpoints' / session)

    def frame(self, frame, *, session=SESSION_A, sessions=None):
        sessions = sessions or self.sessions
        resumed = sessions.prepare(session=session, frame=frame, checkpoints=self.folder(session))
        _, receipt = sessions.render(session=session, frame=frame, timestamp=frame / 24,
                                     checkpoints=self.folder(session), rgba=self.rgba, controls={})
        return resumed, receipt

    def gap(self, frame, *, session=SESSION_A, sessions=None):
        with self.assertRaises(module.SequenceGap) as raised:
            (sessions or self.sessions).prepare(session=session, frame=frame, checkpoints=self.folder(session))
        return raised.exception.restart_from

    def test_frames_continue_and_leave_a_snapshot_every_interval(self):
        results = [self.frame(frame) for frame in range(7)]
        self.assertEqual([resumed for resumed, _ in results], ['restarted'] + ['continued'] * 6)
        self.assertEqual(results[2][1]['checkpoint'], {'frame': 3, 'stored': True})
        self.assertNotIn('checkpoint', results[3][1])
        self.assertEqual(sorted(path.name for path in Path(self.folder()).iterdir()),
                         ['0000000003.snapshot', '0000000006.snapshot'])
        self.assertEqual(self.sessions.snapshot()['memorySnapshots'], 2)

    def test_backward_seek_answers_a_gap_then_restores_the_nearest_snapshot(self):
        for frame in range(7):
            self.frame(frame)
        self.assertEqual(self.gap(4), 3)
        self.assertEqual(self.frame(3)[0], 'restored')
        self.assertEqual(self.engine.history, [0, 1, 2, 3])
        self.assertEqual(self.frame(4)[0], 'continued')
        self.assertEqual(self.gap(1), 0)
        self.assertEqual(self.frame(0)[0], 'restarted')

    def test_forward_jump_resumes_from_the_live_engine_without_disturbing_it(self):
        for frame in range(5):
            self.frame(frame)
        self.assertEqual(self.gap(8), 5)
        self.assertEqual(self.engine.next_frame, 5)
        self.assertEqual(self.frame(5)[0], 'continued')

    def test_switching_sessions_keeps_the_newest_state_of_the_one_left(self):
        for frame in range(5):
            self.frame(frame)
        self.assertEqual(self.frame(0, session=SESSION_B)[0], 'restarted')
        self.frame(1, session=SESSION_B)
        self.assertEqual(self.frame(5)[0], 'restored')
        self.assertEqual(self.engine.history, [0, 1, 2, 3, 4, 5])
        self.assertEqual(self.frame(2, session=SESSION_B)[0], 'restored')

    def test_a_new_worker_resumes_from_the_checkpoint_folder(self):
        for frame in range(7):
            self.frame(frame)
        restarted = self.table()
        self.assertEqual(self.gap(5, sessions=restarted), 3)
        self.assertEqual(self.frame(3, sessions=restarted)[0], 'restored')
        self.assertEqual(restarted.engine.history, [0, 1, 2, 3])

    def test_an_unreadable_snapshot_is_dropped_for_an_earlier_one(self):
        for frame in range(7):
            self.frame(frame)
        restarted = self.table()
        path = Path(self.folder()) / '0000000006.snapshot'
        path.write_bytes(b'not a snapshot')
        self.assertEqual(self.gap(6, sessions=restarted), 3)
        self.assertFalse(path.exists())
        self.assertIsNone(restarted.active)

    def test_a_snapshot_of_another_session_is_refused(self):
        for frame in range(4):
            self.frame(frame)
        Path(self.folder(SESSION_B)).mkdir(parents=True)
        shutil.copy(Path(self.folder()) / '0000000003.snapshot', Path(self.folder(SESSION_B)) / '0000000003.snapshot')
        self.assertEqual(self.gap(3, session=SESSION_B, sessions=self.table()), 0)
        self.assertFalse((Path(self.folder(SESSION_B)) / '0000000003.snapshot').exists())

    def test_a_failed_frame_resumes_only_from_a_snapshot(self):
        for frame in range(4):
            self.frame(frame)
        self.engine.fail = RuntimeError('GPU process failed')
        with self.assertRaisesRegex(RuntimeError, 'GPU'):
            self.frame(4)
        self.engine.fail = None
        self.assertEqual(self.gap(4), 3)
        self.assertEqual(self.frame(3)[0], 'restored')

    def test_the_memory_budget_evicts_old_snapshots_but_the_folder_keeps_them(self):
        sessions = self.table(engine=self.engine, memory_bytes=1)
        for frame in range(7):
            self.frame(frame, sessions=sessions)
        self.assertEqual(sessions.snapshot()['memorySnapshots'], 1)
        (Path(self.folder()) / '0000000006.snapshot').unlink()
        self.assertEqual(self.frame(6, sessions=sessions)[0], 'restored')
        self.assertEqual(self.frame(3, sessions=sessions)[0], 'restored')

    def test_a_folder_that_cannot_be_written_keeps_the_memory_snapshot(self):
        blocked = self.root / 'blocked'
        blocked.write_text('a file where the folder should be')
        self.sessions.prepare(session=SESSION_A, frame=0, checkpoints=str(blocked / SESSION_A))
        for frame in range(3):
            _, receipt = self.sessions.render(session=SESSION_A, frame=frame, timestamp=frame / 24,
                                              checkpoints=str(blocked / SESSION_A), rgba=self.rgba, controls={})
        self.assertFalse(receipt['checkpoint']['stored'])
        self.sessions.prepare(session=SESSION_B, frame=0, checkpoints=self.folder(SESSION_B))
        self.assertEqual(self.sessions.prepare(session=SESSION_A, frame=3,
                                              checkpoints=str(blocked / SESSION_A)), 'restored')
        self.assertEqual(self.engine.history, [0, 1, 2])

    def test_warm_history_cannot_continue_in_an_empty_checkpoint_folder(self):
        self.frame(0)
        other = str(self.root / 'other-history')
        with self.assertRaises(module.SequenceGap) as gap:
            self.sessions.prepare(session=SESSION_A, frame=1, checkpoints=other)
        self.assertEqual(gap.exception.restart_from, 0)
        self.assertEqual(self.frame(1)[0], 'continued')
        self.sessions.prepare(session=SESSION_A, frame=0, checkpoints=other)
        self.sessions.render(session=SESSION_A, frame=0, timestamp=0, checkpoints=other,
                             rgba=self.rgba, controls={})
        self.assertEqual(self.sessions.prepare(session=SESSION_A, frame=2, checkpoints=self.folder()), 'restored')
        self.assertEqual(self.engine.history, [0, 1])

    def test_invalid_other_folder_snapshot_does_not_discard_original_memory(self):
        for frame in range(3):
            self.frame(frame)
        other = self.root / 'invalid-history'
        other.mkdir()
        broken = other / '0000000003.snapshot'
        broken.write_bytes(b'not a snapshot')
        with self.assertRaises(module.SequenceGap) as gap:
            self.sessions.prepare(session=SESSION_A, frame=3, checkpoints=str(other))
        self.assertEqual(gap.exception.restart_from, 0)
        self.assertFalse(broken.exists())
        self.assertEqual(self.sessions.prepare(session=SESSION_A, frame=3, checkpoints=self.folder()), 'restored')
        self.assertEqual(self.engine.history, [0, 1, 2])

    def test_render_requires_a_prepared_session(self):
        with self.assertRaisesRegex(ValueError, 'prepare'):
            self.sessions.render(session=SESSION_A, frame=0, timestamp=0, checkpoints=self.folder(),
                                 rgba=self.rgba, controls={})

    def test_sequence_requests_are_validated(self):
        valid = {'session': SESSION_A, 'frame': 3, 'timestamp': .125, 'checkpoints': self.folder()}
        self.assertEqual(module.validate_sequence(sequence=valid), valid)
        for change in ({'session': 'A' * 64}, {'session': 'a' * 63}, {'frame': -1}, {'frame': 1.0},
                       {'frame': True}, {'timestamp': float('nan')}, {'timestamp': -1}, {'timestamp': True},
                       {'checkpoints': 'relative/folder'}, {'extra': 1}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_sequence(sequence=valid | change)


class StageRunner(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='body-stage-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.image = self.root / 'input.png'
        Image.fromarray(np.full((8, 6, 4), 200, np.uint8)).save(self.image)
        self.engine = FakeEngine()
        self.sessions = module.SequenceSessions(runtime=self.root, engine=self.engine)
        self.sequence = {'session': SESSION_A, 'frame': 0, 'timestamp': 0, 'checkpoints': str(self.root / 'c')}
        self.source = Path(module.__file__).with_name(module.SCRIPT)
        self.stage = {'script': module.SCRIPT, 'parameters': ['--controls', '{"SlimBody": 30}']}

    def run_stage(self, runner, **changes):
        arguments = {'stage': self.stage, 'source': self.source, 'image': self.image, 'runtime': self.root,
                     'output': self.root / 'out.png', 'report': self.root / 'out.json', **changes}
        return runner(**arguments)

    def test_the_body_stage_renders_from_the_session_and_reports_it(self):
        resumed = self.sessions.prepare(session=SESSION_A, frame=0, checkpoints=self.sequence['checkpoints'])
        runner = self.sessions.stage_runner(sequence=self.sequence, resumed=resumed, fallback=None)
        with patch.object(module, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}):
            self.run_stage(runner)
        self.assertTrue(runner.rendered)
        self.assertEqual(self.engine.processed, [(SESSION_A, 0)])
        report = json.loads((self.root / 'out.json').read_text())
        self.assertEqual(report['resumed'], 'restarted')
        self.assertEqual(report['independence'], {'loaded_images': [], 'private_native_images': []})
        np.testing.assert_array_equal(np.asarray(Image.open(self.root / 'out.png')), np.full((8, 6, 4), 201, np.uint8))

    def test_other_stages_go_to_the_photo_runner(self):
        calls = []
        runner = self.sessions.stage_runner(sequence=self.sequence, resumed='restarted',
                                            fallback=lambda **arguments: calls.append(arguments))
        self.run_stage(runner, stage={'script': 'whiten_render.py', 'parameters': []}, face_reference='kept')
        self.assertEqual(calls[0]['face_reference'], 'kept')
        self.assertFalse(runner.rendered)

    def test_the_body_stage_refuses_extra_inputs_another_source_or_runtime(self):
        self.sessions.prepare(session=SESSION_A, frame=0, checkpoints=self.sequence['checkpoints'])
        runner = self.sessions.stage_runner(sequence=self.sequence, resumed='restarted', fallback=None)
        for changes in ({'source_evidence': self.root / 'evidence.json'}, {'source': self.root / module.SCRIPT},
                        {'runtime': self.root / 'other'}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValueError):
                self.run_stage(runner, **changes)
        self.assertEqual(self.engine.processed, [])


if __name__ == '__main__':
    unittest.main()
