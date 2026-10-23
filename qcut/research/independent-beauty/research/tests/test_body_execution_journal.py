"""Only completed own frames can extend a generation's exact route history."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_execution_journal as module
from body_execution_profile import BodyExecutionCheckpointError, SWING_PROFILE

CPU = {'network': 'refine', 'backend': 'cpu'}
COREML = {'network': 'refine', 'backend': 'coreml'}


class RouteJournal(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='body-routes-')
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.identity = {'profile': SWING_PROFILE, 'generation': 'one', 'model': 'model-one', 'helper': 'helper-one'}
        self.rgba = np.zeros((4, 6, 4), np.uint8)
        self.journal = self.open()

    def open(self, **changes):
        return module.ExecutionRouteJournal(**{'session': 'a' * 64, 'checkpoints': self.folder,
                                               'identity': self.identity, **changes})

    def fingerprint(self, *, frame=0, journal=None, **changes):
        return (journal or self.journal).frame_input(**{'frame': frame, 'rgba': self.rgba,
            'controls': {'SlimBody': 40}, 'timestamp': frame / 30, **changes})

    def append(self, *, frame, routes):
        self.journal.commit(frame=frame, input_identity=self.fingerprint(frame=frame), routes=routes)

    def test_completed_routes_survive_reopen_and_replay_does_not_rewrite(self):
        self.append(frame=0, routes=[CPU])
        self.append(frame=1, routes=[CPU, COREML])
        before = self.journal.path.read_bytes()
        reopened = self.open()
        self.assertEqual(reopened.routes(), [CPU, COREML])
        reopened.commit(frame=0, input_identity=self.fingerprint(journal=reopened), routes=[CPU])
        self.assertEqual(self.journal.path.read_bytes(), before)
        copied = reopened.routes()
        copied[0]['backend'] = 'coreml'
        self.assertEqual(reopened.routes()[0], CPU)

    def test_uncommitted_frame_choices_are_not_recovered(self):
        self.fingerprint()
        self.assertFalse(self.journal.path.exists())
        self.assertEqual(self.open().routes(), [])
        self.append(frame=0, routes=[CPU])
        self.fingerprint(frame=1)
        self.assertEqual(self.open().routes(), [CPU])

    def test_original_pixels_controls_and_time_cannot_fork_existing_history(self):
        self.append(frame=0, routes=[CPU])
        for changes in ({'rgba': self.rgba + 1}, {'controls': {'SlimBody': 55}}, {'timestamp': .5}):
            with self.subTest(changes=list(changes)), self.assertRaisesRegex(BodyExecutionCheckpointError, 'input conflicts'):
                self.fingerprint(**changes)
        self.assertEqual(self.open().routes(), [CPU])

    def test_prefix_and_existing_frame_conflicts_do_not_overwrite(self):
        self.append(frame=0, routes=[CPU])
        before = self.journal.path.read_bytes()
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'prefix conflicts'):
            self.append(frame=1, routes=[COREML, COREML])
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'replay conflicts'):
            self.journal.commit(frame=0, input_identity=self.fingerprint(), routes=[COREML])
        self.assertEqual(self.journal.path.read_bytes(), before)

    def test_session_generation_model_and_helper_mismatches_fail_closed(self):
        self.append(frame=0, routes=[CPU])
        for changes in ({'session': 'b' * 64}, *({'identity': {**self.identity, field: 'different'}}
                                                for field in ('generation', 'model', 'helper'))):
            with self.subTest(changes=changes), self.assertRaisesRegex(BodyExecutionCheckpointError, 'another session or execution identity'):
                self.open(**changes)

    def test_route_and_frame_bounds_are_checked(self):
        for routes in ([], [CPU] * 9, [{'network': 'face', 'backend': 'cpu'}], [{'network': 'refine', 'backend': 'guess'}]):
            with self.subTest(routes=routes), self.assertRaises(BodyExecutionCheckpointError):
                self.append(frame=0, routes=routes)
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'contiguous'):
            self.fingerprint(frame=1)

    def test_stale_and_concurrent_writers_cannot_replace_history(self):
        stale = self.open()
        self.append(frame=0, routes=[CPU])
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'changed under'):
            stale.commit(frame=0, input_identity=self.fingerprint(), routes=[COREML])
        other = self.open()
        with self.journal._locked(), self.assertRaisesRegex(BodyExecutionCheckpointError, 'another writer'):
            other.commit(frame=1, input_identity=self.fingerprint(frame=1), routes=[CPU, COREML])
        self.assertEqual(self.open().routes(), [CPU])

    def test_failed_atomic_replace_keeps_last_committed_frame(self):
        self.append(frame=0, routes=[CPU])
        before = self.journal.path.read_bytes()
        with patch.object(module.os, 'replace', side_effect=OSError('disk full')), self.assertRaisesRegex(OSError, 'disk full'):
            self.append(frame=1, routes=[CPU, COREML])
        self.assertEqual(self.journal.path.read_bytes(), before)
        self.assertEqual(self.journal.routes(), [CPU])
        self.assertEqual(list(self.folder.glob('*.tmp')), [])

    def test_corrupt_frame_order_and_byte_budget_are_refused(self):
        self.append(frame=0, routes=[CPU])
        saved = json.loads(self.journal.path.read_text())
        saved['frames'][0]['frame'] = False
        self.journal.path.write_text(json.dumps(saved))
        with self.assertRaisesRegex(BodyExecutionCheckpointError, 'frame order'):
            self.open()
        with patch.object(module, 'MAX_STATE_BYTES', 16), self.assertRaisesRegex(BodyExecutionCheckpointError, 'byte budget'):
            self.open()


if __name__ == '__main__':
    unittest.main()
