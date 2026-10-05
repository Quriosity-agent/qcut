"""The opt-in stopped observer binds crop snapshots without candidate inputs."""
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest import mock

import face_extra_crop_trace as crop
import face_live_extra_model_trace as model
import face_live_extra_trace as trace
from face_live_extra_trace_test import TraceFixture


class CropObserverIntegrationTests(TraceFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name) / "private"
        self.registers.update(x1=0x90000, x2=0xa0000)
        self.frame.GetPC.return_value = 0x1000000 + trace.CALL

    def enabled_observer(self):
        return trace.ExtraTrace(target=self.target, point_breakpoint=self.point,
            callback="test.on_extra", inner_model=True, model_directory=self.directory)

    def test_debugger_import_needs_no_numpy_or_site_packages(self):
        source = "import sys; sys.path.insert(0, sys.argv[1]); import face_extra_crop_trace; " \
                 "assert 'numpy' not in sys.modules; assert 'PIL' not in sys.modules"
        result = subprocess.run([sys.executable, "-I", "-S", "-B", "-c", source,
            str(Path(__file__).resolve().parent)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_observer_never_reads_crop_or_model_state(self):
        with mock.patch.object(crop, "snapshot") as capture, mock.patch.object(model, "snapshot") as inner:
            observer = self.observer()
            self.pair(observer=observer)
        capture.assert_not_called()
        inner.assert_not_called()
        self.assertNotIn("crop_geometry", observer.events[0])
        self.assertIsNone(observer.input_parameter)
        self.assertFalse(self.directory.exists())

    def test_call_arguments_survive_return_register_clobber_and_refresh_per_prediction(self):
        with mock.patch.object(crop, "snapshot", side_effect=lambda **kwargs: dict(
                event=kwargs["event"], prediction=kwargs["prediction"], diagnostic_only=True)) as capture, \
                mock.patch.object(model, "snapshot", return_value=dict(diagnostic_only=True)) as inner:
            observer = self.enabled_observer()
            for prediction in range(2):
                source, parameter = 0x90000 + prediction * 4096, 0xa0000 + prediction * 4096
                self.registers.update(x1=source, x2=parameter)
                self.begin(observer=observer, prediction=prediction)
                self.observe(observer=observer, name="before")
                self.registers.update(x1=0, x2=0)
                self.observe(observer=observer, name="after")
                for call in capture.call_args_list[prediction * 2:prediction * 2 + 2]:
                    self.assertEqual(call.kwargs["source"], source)
                    self.assertEqual(call.kwargs["input_parameter"], parameter)
                    self.assertEqual(call.kwargs["base"], 0x1000000)
                    self.assertEqual(call.kwargs["thread"], 123)
                    self.assertEqual(call.kwargs["scope"], self.scope())
        self.assertEqual(capture.call_count, 4)
        self.assertEqual(inner.call_count, 2)
        self.assertEqual([row["crop_geometry"]["event"] for row in observer.events],
                         ["before", "after", "before", "after"])
        self.assertTrue(observer.report()["complete"])
        self.assertFalse(observer.report()["native_points_sent_to_worker"])

    def assert_failed_capture(self, *, failure_at):
        with mock.patch.object(crop, "snapshot", side_effect=lambda **kwargs: (
                self.fail_snapshot() if kwargs["event"] == failure_at else dict(diagnostic_only=True))), \
                mock.patch.object(model, "snapshot") as inner:
            observer = self.enabled_observer()
            self.begin(observer=observer)
            if failure_at == "after":
                self.observe(observer=observer, name="before")
            with self.assertRaisesRegex(ValueError, "invalid crop evidence"):
                self.observe(observer=observer, name=failure_at)
            self.assertFalse(observer.report()["complete"])
            inner.assert_not_called()
            # One diagnostic slot rotates; failed callbacks must not arm the point reader.
            self.assertFalse(self.point.IsEnabled())

    def test_failed_before_snapshot_cannot_emit_model_payload(self):
        self.assert_failed_capture(failure_at="before")

    def test_failed_after_snapshot_cannot_emit_model_payload(self):
        self.assert_failed_capture(failure_at="after")

    @staticmethod
    def fail_snapshot():
        raise ValueError("invalid crop evidence")


if __name__ == "__main__":
    unittest.main()
