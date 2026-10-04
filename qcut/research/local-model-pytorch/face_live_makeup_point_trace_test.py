"""CPU-only post-load observations; no native process or debugger required."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

import face_live_makeup_point_trace as trace
import face_live_bridge_lldb as bridge


class FloatRegisterTests(unittest.TestCase):
    def test_reads_float_register_raw_bits_without_numeric_conversion(self):
        frame, error = mock.Mock(), mock.Mock()
        value = frame.FindRegister.return_value
        value.IsValid.return_value = True
        error.Fail.return_value = False
        value.GetData.return_value.GetUnsignedInt32.return_value = 0x3e800000
        with mock.patch.dict("sys.modules", {"lldb": mock.Mock(SBError=mock.Mock(return_value=error))}):
            self.assertEqual(trace.float_register_bits(frame=frame, name="s2"), 0x3e800000)
            value.GetData.return_value.GetUnsignedInt32.assert_called_once_with(error, 0)
            value.GetValueAsUnsigned.assert_not_called()
            error.Fail.return_value = True
            with self.assertRaisesRegex(ValueError, "unreadable"):
                trace.float_register_bits(frame=frame, name="s3")
            value.IsValid.return_value = False
            with self.assertRaisesRegex(ValueError, "missing"):
                trace.float_register_bits(frame=frame, name="s2")


class PointTraceTests(unittest.TestCase):
    def setUp(self):
        self.frame, self.location = mock.Mock(), mock.Mock()
        self.location.GetBreakpoint.return_value.IsHardware.return_value = True
        self.address = self.frame.GetPCAddress.return_value
        self.address.IsValid.return_value = True
        self.address.GetModule.return_value.GetUUIDString.return_value = trace.CORE_UUID
        self.address.GetFileAddress.return_value = trace.POINT_LOAD
        self.thread = self.frame.GetThread.return_value
        self.thread.GetThreadID.return_value = 123
        self.caller = self.thread.GetFrameAtIndex.return_value.GetPCAddress.return_value
        self.caller.IsValid.return_value = True
        self.caller.GetModule.return_value.GetUUIDString.return_value = trace.CORE_UUID
        self.caller.GetFileAddress.return_value = 0x9eb9c4
        self.registers = dict(x19=8192, x11=16384, x8=0, w21=640, w22=640)
        self.bits = struct.unpack("<2I", struct.pack("<2f", 0.25, 0.75))
        self.memory = {8192 + 0x20: struct.pack("<Q", 12288),
                       12288 + 0x10: struct.pack("<QQ", 16384, 16384 + 848),
                       8192 + 0x40: struct.pack("<i", 0), 16384: struct.pack("<2I", *self.bits)}
        self.publication = dict(event="live_makeup_publication", prediction=1, timestamp_us=0,
            candidate_injected=True, renderer_consumption=False, thread=123, binding_id=2, graph_id=1,
            graph=32768, owned_base=8192, owned_points=16384, source_base=40960, source_points=49152,
            face_id=0, faces=1)
        patch = mock.patch.object(trace, "register", side_effect=lambda **kw: self.registers[kw["name"]])
        patch.start()
        self.addCleanup(patch.stop)
        patch = mock.patch.object(trace, "float_register_bits", side_effect=lambda **kw:
                                  self.bits[0 if kw["name"] == "s2" else 1])
        patch.start()
        self.addCleanup(patch.stop)

    def read(self, *, address, size):
        result = self.memory[address]
        self.assertEqual(len(result), size)
        return result

    def observe(self):
        return trace.observe(frame=self.frame, location=self.location, prediction=1,
                             read=self.read, publication=self.publication)

    def test_exact_source_and_loaded_bits_are_read_only(self):
        row = self.observe()
        self.assertEqual(row["point_index"], 0)
        self.assertEqual(row["base"], 8192)
        self.assertEqual(row["source_address"], 16384)
        self.assertEqual(row["loaded_bits"], row["memory_bits"])
        self.assertEqual(row["binding_id"], 2)
        self.assertEqual(row["observation"], "post-load-source-xy")
        self.assertFalse(row["renderer_consumption"])
        self.frame.EvaluateExpression.assert_not_called()
        self.thread.GetProcess.assert_not_called()

    def test_last_point_is_bounded_and_uses_exact_offset(self):
        self.registers.update(x8=840, x11=16384 + 840)
        self.memory[16384 + 840] = self.memory[16384]
        self.assertEqual(self.observe()["point_index"], 105)
        for offset in (-1, 1, 848, 2**64 - 1, True):
            self.registers["x8"] = offset
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                self.observe()

    def test_breakpoint_and_caller_identity(self):
        for obj, method, bad in ((self.address, "IsValid", False),
                (self.address, "GetFileAddress", trace.POINT_LOAD - 4),
                (self.address.GetModule(), "GetUUIDString", "foreign"),
                (self.location.GetBreakpoint(), "IsHardware", False),
                (self.caller, "GetFileAddress", 0x9eb9c0),
                (self.caller.GetModule(), "GetUUIDString", "foreign")):
            target = getattr(obj, method)
            old = target.return_value
            target.return_value = bad
            with self.subTest(method=method, bad=bad), self.assertRaises(ValueError):
                self.observe()
            target.return_value = old

    def test_publication_identity_alias_and_dimensions_are_guarded(self):
        for key, value in (('prediction', 0), ('thread', 999), ('owned_base', 40960),
                           ('owned_points', 49152), ('source_base', 8192),
                           ('source_points', 16384), ('faces', 2), ('face_id', 9)):
            original = self.publication[key]
            self.publication[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.observe()
            self.publication[key] = original
        for key, value in (("x19", 0), ("x11", 2**64), ("x11", 16392), ("w21", 0), ("w22", 4097)):
            original = self.registers[key]
            self.registers[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.observe()
            self.registers[key] = original

    def test_changed_values_invalid_vectors_and_nonfinite_xy_rejected(self):
        self.memory[16384] = struct.pack("<2f", 0.5, 0.75)
        with self.assertRaisesRegex(ValueError, "registers differ"):
            self.observe()
        for values in ((float("nan"), 0.5), (float("inf"), 0.5), (-0.1, 0.5), (0.5, 1.1)):
            self.bits = struct.unpack("<2I", struct.pack("<2f", *values))
            self.memory[16384] = struct.pack("<2I", *self.bits)
            with self.assertRaisesRegex(ValueError, "unbounded makeup source"):
                self.observe()
        self.memory[12288 + 0x10] = struct.pack("<QQ", 16384, 16384 + 840)
        with self.assertRaisesRegex(ValueError, "candidate span"):
            self.observe()

    def test_only_last_flushed_publication_is_live(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "records.jsonl"
            line = json.dumps(self.publication).encode() + b"\n"
            path.write_bytes(line)
            self.assertEqual(trace.publication_scope(path=path, prediction=1), self.publication)
            for data in (b"", line[:-1], line + b'{"event":"live_makeup_update_exit"}\n',
                         b"x" * (trace.RECORD_LIMIT + 1)):
                path.write_bytes(data)
                with self.subTest(size=len(data)), self.assertRaises(ValueError):
                    trace.publication_scope(path=path, prediction=1)
            path.write_bytes(line)
            with self.assertRaises(ValueError):
                trace.publication_scope(path=path, prediction=0)

    def test_callback_does_not_mutate_prediction_or_exchange_with_worker(self):
        state = mock.Mock(point_hits=0, point_events=[], failures=[], index=1,
                          started=0, config=dict(report="/private/live/observer.json"))
        with mock.patch.object(bridge, "STATE", state), \
                mock.patch.object(bridge.time, "monotonic", return_value=1), \
                mock.patch.object(trace, "publication_scope", return_value=self.publication), \
                mock.patch.object(trace, "observe", return_value=dict(renderer_consumption=False)):
            self.assertFalse(bridge.on_point_breakpoint(self.frame, self.location, {}))
        self.assertEqual(state.index, 1)
        self.assertEqual(state.point_hits, 1)
        self.assertEqual(len(state.point_events), 1)
        state.handle.assert_not_called()

    def test_callback_budget_is_terminal(self):
        for hits, elapsed in ((trace.MAX_HITS, 1), (0, 241)):
            state = mock.Mock(point_hits=hits, point_events=[], failures=[], started=0)
            with mock.patch.object(bridge, "STATE", state), \
                    mock.patch.object(bridge.time, "monotonic", return_value=elapsed):
                self.assertTrue(bridge.on_point_breakpoint(self.frame, self.location, {}))
                self.assertEqual(len(state.failures), 1)
                self.assertEqual(state.point_events, [])

    def test_install_uses_same_single_hardware_slot(self):
        with mock.patch.object(trace.reader_trace, "install") as install:
            trace.install(debugger="debugger", target="target", core="core", callback="callback")
        self.assertEqual(install.call_args.kwargs["address"], trace.POINT_LOAD)

    def test_conflicting_diagnostics_never_launch_or_reuse_old_observer(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
            path.write_text(json.dumps(dict(trace_makeup_points=True, trace_face_readers=True, report=str(report))))
            debugger = mock.Mock()
            with mock.patch.dict("sys.modules", {"lldb": mock.Mock()}), \
                    mock.patch.object(bridge, "STATE", mock.Mock(events=["old"])), \
                    mock.patch("builtins.print"):
                bridge.run(debugger=debugger, config_path=path)
            debugger.CreateTarget.assert_not_called()
            value = json.loads(report.read_text())
            self.assertFalse(value["passed"])
            self.assertNotIn("events", value)
            self.assertIn("share one hardware slot", value["failures"][0])


if __name__ == "__main__":
    unittest.main()
