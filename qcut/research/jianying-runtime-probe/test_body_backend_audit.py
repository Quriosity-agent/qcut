import unittest

from body_backend_audit import check_schedule


def state(*, ready, cpu):
    return {"detector": 1, "configuredBackend": 3, "latchedReady": int(ready), "cpuEngine": cpu}


class BackendScheduleEvidenceTests(unittest.TestCase):
    def test_completion_after_poll_does_not_change_current_inference(self):
        rows = [{"event": "load", "detector": 1},
                {"event": "ready-latch", "detector": 1, "observedReady": 0},
                {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=False, cpu=10)},
                {"event": "listener-return", "listenerReady": 1},
                {"event": "cpu", "state": state(ready=False, cpu=10)},
                {"event": "ready-latch", "detector": 1, "observedReady": 1},
                {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=True, cpu=0)},
                {"event": "coreml", "state": state(ready=True, cpu=0)}]
        actual = check_schedule(events=rows)
        self.assertEqual((actual["cpuPasses"], actual["coremlPasses"]), (1, 1))

    def test_rejects_frame_index_switch_without_ready_poll(self):
        with self.assertRaisesRegex(ValueError, "latched dynamic"):
            check_schedule(events=[{"event": "load", "detector": 1}, {"event": "coreml", "state": state(ready=True, cpu=0)}])

    def test_rejects_cpu_fallback_after_activation(self):
        with self.assertRaisesRegex(ValueError, "latched dynamic"):
            check_schedule(events=[{"event": "ready-latch", "detector": 1, "observedReady": 1},
                                   {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=True, cpu=0)},
                                   {"event": "cpu", "state": state(ready=False, cpu=10)}])

    def test_address_reuse_starts_a_new_model_generation(self):
        rows = [{"event": "ready-latch", "detector": 1, "observedReady": 1},
                {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=True, cpu=0)},
                {"event": "load", "detector": 1},
                {"event": "ready-latch", "detector": 1, "observedReady": 0},
                {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=False, cpu=10)},
                {"event": "cpu", "state": state(ready=False, cpu=10)}]
        self.assertEqual(check_schedule(events=rows)["generations"], 1)

    def test_separate_detectors_can_switch_within_one_tracking_call(self):
        coarse = state(ready=False, cpu=10)
        refine = {**state(ready=True, cpu=0), "detector": 2}
        rows = [{"event": "ready-latch", "detector": 1, "observedReady": 0},
                {"event": "poll-return", "detector": 1, "returnCode": 0, "state": coarse},
                {"event": "cpu", "call": 0, "state": coarse},
                {"event": "ready-latch", "detector": 2, "observedReady": 1},
                {"event": "poll-return", "detector": 2, "returnCode": 0, "state": refine},
                {"event": "coreml", "call": 0, "state": refine},
                {"event": "coreml-return", "returnCode": -5, "state": refine},
                {"event": "ready-latch", "detector": 2, "observedReady": 1},
                {"event": "poll-return", "detector": 2, "returnCode": 0, "state": refine},
                {"event": "coreml", "call": 1, "state": refine}]
        actual = check_schedule(events=rows)
        self.assertEqual((actual["cpuPasses"], actual["coremlPasses"]), (1, 2))

    def test_rejects_stale_read_after_model_generation_changes(self):
        with self.assertRaisesRegex(ValueError, "listener read"):
            check_schedule(events=[{"event": "ready-latch", "detector": 1, "observedReady": 1},
                                   {"event": "load", "detector": 1},
                                   {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=True, cpu=0)}])

    def test_rejects_readiness_change_without_observed_read(self):
        with self.assertRaisesRegex(ValueError, "listener read"):
            check_schedule(events=[{"event": "ready-latch", "detector": 1, "observedReady": 0},
                                   {"event": "poll-return", "detector": 1, "returnCode": 0, "state": state(ready=True, cpu=0)}])


if __name__ == "__main__":
    unittest.main()
