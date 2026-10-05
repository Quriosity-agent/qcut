"""CPU-only reader diagnostics; no getter observation can claim consumption."""
import unittest
from unittest import mock

import face_live_reader_trace as trace
import face_live_bridge_lldb as bridge


class ReaderTraceTests(unittest.TestCase):
    def setUp(self):
        self.frame, self.location = mock.Mock(), mock.Mock()
        self.address = self.frame.GetPCAddress.return_value
        self.address.IsValid.return_value = True
        self.address.GetFileAddress.return_value = trace.RAW_GETTER
        module = self.address.GetModule.return_value
        module.GetUUIDString.return_value = trace.CORE_UUID
        module.GetFileSpec.return_value.GetFilename.return_value = "libcccreator.dylib"
        self.frame.GetFunctionName.return_value = "raw_reader"
        self.thread = self.frame.GetThread.return_value
        self.thread.GetThreadID.return_value = 123
        self.thread.GetNumFrames.return_value = 2
        self.thread.GetFrameAtIndex.return_value = self.frame
        self.location.GetBreakpoint.return_value.IsHardware.return_value = True
        self.registers = {"x0": 8192, "w1": 4}
        self.patch = mock.patch.object(trace, "register", side_effect=lambda **kw: self.registers[kw["name"]])
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def observe(self):
        return trace.observe(frame=self.frame, location=self.location, prediction=0)

    def test_getter_is_diagnostic_only(self):
        result = self.observe()
        self.assertEqual(result["graph"], 8192)
        self.assertEqual(result["buffer_type"], 4)
        self.assertEqual(result["observation"], "getter-entry-only")
        self.assertFalse(result["candidate_injected"])
        self.assertFalse(result["renderer_consumption"])
        self.assertEqual(len(result["stack"]), 2)
        self.frame.EvaluateExpression.assert_not_called()
        self.thread.GetProcess.assert_not_called()

    def test_non_face_types_do_not_read_stack(self):
        self.registers["w1"] = 5
        self.assertIsNone(self.observe())
        self.thread.GetFrameAtIndex.assert_not_called()

    def test_uuid_address_hardware_and_graph_are_guarded(self):
        for change in ("uuid", "pc", "invalid", "software", "null", "huge"):
            with self.subTest(change=change):
                if change == "uuid":
                    self.address.GetModule.return_value.GetUUIDString.return_value = "foreign"
                elif change == "pc":
                    self.address.GetFileAddress.return_value += 4
                elif change == "invalid":
                    self.address.IsValid.return_value = False
                elif change == "software":
                    self.location.GetBreakpoint.return_value.IsHardware.return_value = False
                elif change == "null":
                    self.registers["x0"] = 0
                else:
                    self.registers["x0"] = 2**64 - 1
                with self.assertRaises(ValueError):
                    self.observe()
                self.address.GetModule.return_value.GetUUIDString.return_value = trace.CORE_UUID
                self.address.GetFileAddress.return_value = trace.RAW_GETTER
                self.address.IsValid.return_value = True
                self.location.GetBreakpoint.return_value.IsHardware.return_value = True
                self.registers["x0"] = 8192

    def test_stack_and_symbols_are_bounded(self):
        self.thread.GetNumFrames.return_value = 10000
        self.frame.GetFunctionName.return_value = "x" * 10000
        result = self.observe()
        self.assertEqual(len(result["stack"]), trace.MAX_FRAMES)
        self.assertTrue(all(len(row["symbol"]) == 512 for row in result["stack"]))
        self.frame.GetFunctionName.return_value = None
        self.assertEqual(self.observe()["stack"][0]["symbol"], "")

    def test_callback_does_not_modify_inference_or_consumer_receipts(self):
        state = mock.Mock(reader_hits=0, reader_events=[], index=0, started=0, failures=[])
        with mock.patch.object(bridge, "STATE", state), mock.patch.object(bridge.time, "monotonic", return_value=1):
            self.assertFalse(bridge.on_reader_breakpoint(self.frame, self.location, {}))
        self.assertEqual(state.reader_hits, 1)
        self.assertEqual(len(state.reader_events), 1)
        self.assertEqual(state.failures, [])
        state.handle.assert_not_called()

    def test_callback_stops_on_budget_or_invalid_reader(self):
        for hits, elapsed, invalid in ((trace.MAX_HITS, 1, False), (0, 241, False), (0, 1, True)):
            state = mock.Mock(reader_hits=hits, reader_events=[], index=0, started=0, failures=[])
            self.address.IsValid.return_value = not invalid
            with self.subTest(hits=hits, elapsed=elapsed, invalid=invalid), \
                    mock.patch.object(bridge, "STATE", state), \
                    mock.patch.object(bridge.time, "monotonic", return_value=elapsed):
                self.assertTrue(bridge.on_reader_breakpoint(self.frame, self.location, {}))
                self.assertEqual(len(state.failures), 1)
                self.assertEqual(state.reader_events, [])

    def test_installer_refuses_foreign_image_and_software_breakpoint(self):
        debugger, target, module, point = (mock.Mock() for _ in range(4))
        target.modules = [module]
        module.GetUUIDString.return_value = "foreign"
        with mock.patch.object(trace, "command"):
            with self.assertRaisesRegex(ValueError, "pinned"):
                trace.install(debugger=debugger, target=target, core="/private/core", callback="callback")
            module.GetUUIDString.return_value = trace.CORE_UUID
            target.GetNumBreakpoints.side_effect = [3, 4]
            target.GetBreakpointAtIndex.return_value = point
            point.IsHardware.return_value = False
            with self.assertRaisesRegex(ValueError, "software"):
                trace.install(debugger=debugger, target=target, core="/private/core", callback="callback")
            point.SetScriptCallbackFunction.assert_not_called()

    def test_installer_adds_exactly_one_hardware_point(self):
        debugger, target, module, point = (mock.Mock() for _ in range(4))
        target.modules = [module]
        module.GetUUIDString.return_value = trace.CORE_UUID
        target.GetNumBreakpoints.side_effect = [3, 4]
        target.GetBreakpointAtIndex.return_value = point
        point.IsHardware.return_value = True
        with mock.patch.object(trace, "command") as command:
            trace.install(debugger=debugger, target=target, core="/private/core", callback="callback")
        self.assertIn("--hardware", command.call_args.kwargs["text"])
        point.SetScriptCallbackFunction.assert_called_once_with("callback")


if __name__ == "__main__":
    unittest.main()
