"""Private stage files never become worker inputs or accepted parity evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from face_live_worker import LiveWorker
from face_live_worker_test import TOKEN, begin, feed, fixtures


class WorkerTraceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.worker = LiveWorker(models=fixtures.FakeHeads(), token=TOKEN,
            source_key="synthetic-worker-source", trace_directory=self.directory)

    def test_two_cold_snapshots_match_fresh_worker_outputs(self):
        for prediction, mode in ((0, "seed-160"), (1, "update")):
            reply, _, _ = feed(worker=self.worker, prediction=prediction, mode=mode)
            path = self.directory / f"candidate-{prediction}.json"
            value = json.loads(path.read_text())
            self.assertEqual(value["pid"], 123)
            self.assertEqual(value["token_sha256"], hashlib.sha256(TOKEN.encode()).hexdigest())
            self.assertNotIn(TOKEN, path.read_text())
            self.assertEqual(value["source_key"], "synthetic-worker-source")
            self.assertEqual(value["stages"]["normalized"], reply["result"]["faces"][0]["points"])
            self.assertFalse(value["native_final_point_input_used"])
            self.assertFalse(value["product_parity_verified"])
            self.assertNotIn("stages", reply["result"])
        self.assertEqual(len(list(self.directory.iterdir())), 2)

    def test_existing_file_rejected_without_overwrite_or_state_commit(self):
        path = self.directory / "candidate-0.json"
        path.write_text("existing evidence")
        with self.assertRaises(FileExistsError):
            feed(worker=self.worker)
        self.assertEqual(path.read_text(), "existing evidence")
        self.assertIsNone(self.worker.core.state)
        self.assertEqual(self.worker.index, -1)
        with self.assertRaisesRegex(RuntimeError, "poisoned"):
            begin(worker=self.worker)

    def test_prediction_budget_cannot_extend_to_temporal_claim(self):
        feed(worker=self.worker)
        feed(worker=self.worker, prediction=1, mode="update")
        state = self.worker.core.state
        with self.assertRaisesRegex(ValueError, "cold single-frame"):
            feed(worker=self.worker, prediction=2, mode="update")
        self.assertIs(self.worker.core.state, state)
        self.assertEqual(len(list(self.directory.iterdir())), 2)

    def test_default_worker_creates_no_stage_files(self):
        worker = LiveWorker(models=fixtures.FakeHeads(), token=TOKEN, source_key="synthetic-worker-source")
        feed(worker=worker)
        self.assertEqual(list(self.directory.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
