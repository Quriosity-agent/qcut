"""Fake LLDB contracts/state machines only; no debugger or vendor runtime."""
from copy import deepcopy
import hashlib
import importlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, call, patch

import face_preprocess_lldb as observer
import face_preprocess_memory as memory


class FakePoint:
    def __init__(self, *, identity, hardware=True):
        self.identity, self.hardware, self.enabled = identity, hardware, False
        self.callback = None

    def GetID(self):
        return self.identity

    def IsHardware(self):
        return self.hardware

    def IsEnabled(self):
        return self.enabled

    def SetEnabled(self, enabled):
        self.enabled = enabled

    def SetScriptCallbackFunction(self, callback):
        self.callback = callback


def address(*, offset, valid=True, uuid=observer.LENS_UUID):
    return Mock(IsValid=Mock(return_value=valid), GetFileAddress=Mock(return_value=offset),
                GetModule=Mock(return_value=Mock(GetUUIDString=Mock(return_value=uuid))))


def fake_lldb():
    error = Mock(Fail=Mock(return_value=False), GetCString=Mock(return_value="fake LLDB error"))
    return SimpleNamespace(SBError=Mock(return_value=error), SBCommandReturnObject=Mock(),
                           SBLaunchInfo=Mock(), eLaunchFlagDisableASLR=8, eStateExited=10)


class HelpersTests(unittest.TestCase):
    def setUp(self):
        self.lldb = fake_lldb()
        self.enterContext(patch.dict(sys.modules, {"lldb": self.lldb}))

    def test_module_import_does_not_require_lldb(self):
        with patch.dict(sys.modules, {"lldb": None}):
            self.assertIs(importlib.reload(observer), observer)

    def test_command_result_and_failure_no_retry(self):
        debugger, result = Mock(), Mock()
        self.lldb.SBCommandReturnObject.return_value = result
        result.Succeeded.return_value, result.GetOutput.return_value = True, "hardware created"
        self.assertEqual(observer.command(debugger=debugger, text="fake command"), "hardware created")
        debugger.GetCommandInterpreter().HandleCommand.assert_called_once_with("fake command", result)
        for message in ("hardware unavailable", ""):
            result.Succeeded.return_value, result.GetError.return_value = False, message
            with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, message or "LLDB command failed"):
                observer.command(debugger=debugger, text="fake command")
        self.assertEqual(debugger.GetCommandInterpreter().HandleCommand.call_count, 3)

    def test_integer_and_float_bit_register_reads_and_missing_errors(self):
        frame, value = Mock(), Mock()
        frame.FindRegister.return_value = value
        value.IsValid.return_value = True
        value.GetValueAsUnsigned.return_value = 0xABCD123456789ABC
        value.GetData().GetUnsignedInt32.return_value = 0x3FC00000
        self.assertEqual(observer.register(frame=frame, name="lr"), 0xABCD123456789ABC)
        self.assertEqual(observer.register(frame=frame, name="s0"), 0x3FC00000)
        value.GetData().GetUnsignedInt32.assert_called_once_with(self.lldb.SBError(), 0)
        value.IsValid.return_value = False
        with self.assertRaisesRegex(ValueError, "missing register"):
            observer.register(frame=frame, name="x0")
        value.IsValid.return_value = True
        self.lldb.SBError().Fail.return_value = True
        with self.assertRaisesRegex(ValueError, "unreadable register"):
            observer.register(frame=frame, name="w3")

    def test_file_address_requires_valid_pinned_module(self):
        self.assertEqual(observer.file_address(address=address(offset=123)), 123)
        for valid, uuid in ((False, observer.LENS_UUID), (True, "other UUID")):
            with self.subTest(valid=valid, uuid=uuid), self.assertRaisesRegex(ValueError, "pinned lens"):
                observer.file_address(address=address(offset=123, valid=valid, uuid=uuid))

    def test_read_and_scalar_partial_and_error_rejection(self):
        state = observer.Observer(debugger=Mock(), target=Mock(), out=Path("/synthetic"))
        state.process = Mock(ReadMemory=Mock(return_value=struct.pack("<Q", 12345)))
        self.assertEqual(state.scalar(address=8192, kind="<Q"), 12345)
        state.process.ReadMemory.assert_called_once_with(8192, 8, self.lldb.SBError())
        state.process.ReadMemory.return_value = b"short"
        with self.assertRaisesRegex(ValueError, "unreadable"):
            state.read(address=8192, size=8)
        state.process.ReadMemory.return_value = bytes(8)
        self.lldb.SBError().Fail.return_value = True
        with self.assertRaisesRegex(ValueError, "unreadable"):
            state.read(address=8192, size=8)

    def test_blob_delegates_actual_unpack_metadata_and_bytes(self):
        state = observer.Observer(debugger=Mock(), target=Mock(), out=Path("/synthetic"))
        metadata, pixels = dict(rows=1, cols=1, address=8192), b"\x00\x80\xff"
        state.save_blob = Mock(return_value={"saved": True})
        with patch.object(memory, "unpack_mat", return_value=(metadata, pixels)) as unpack:
            self.assertEqual(state.blob(name="crop", address=8192), {"saved": True})
        unpack.assert_called_once_with(read=state.read, address=8192)
        state.save_blob.assert_called_once_with(name="crop", metadata=metadata, pixels=pixels)

    def test_save_blob_exclusive_bytes_hash_and_exact_trace_budget(self):
        directory, path = MagicMock(spec=Path), MagicMock(spec=Path)
        directory.__truediv__.return_value = path
        path.name = "prediction-20-source.bgr"
        state = observer.Observer(debugger=Mock(), target=Mock(), out=directory)
        state.prediction, state.trace_bytes = 20, observer.TRACE_LIMIT - 3
        result = state.save_blob(name="source", metadata=dict(rows=1, cols=1), pixels=b"abc")
        directory.__truediv__.assert_called_once_with("prediction-20-source.bgr")
        path.open.assert_called_once_with("xb")
        path.open.return_value.__enter__.return_value.write.assert_called_once_with(b"abc")
        self.assertEqual(result, dict(rows=1, cols=1, file=path.name, sha256=hashlib.sha256(b"abc").hexdigest()))
        with self.assertRaisesRegex(ValueError, "trace byte budget"):
            state.save_blob(name="crop", metadata={}, pixels=b"x")
        self.assertEqual(path.open.call_count, 1)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.clock = self.enterContext(patch.object(observer.time, "monotonic", return_value=100))
        self.points, self.debugger, self.target = [], Mock(), Mock()
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.points)
        self.target.GetBreakpointAtIndex.side_effect = lambda index: self.points[index]
        self.commands = self.enterContext(patch.object(observer, "command", side_effect=self.create_point))
        self.state = observer.Observer(debugger=self.debugger, target=self.target, out=Path("/synthetic"))
        self.state.install()
        self.enterContext(patch.object(observer, "register", side_effect=lambda *, frame, name: frame.values[name]))
        self.decoded = dict(alignment=16384, preprocessor=32768, rect=dict(values=[1, 2, 3, 4], raw_hex="rect"),
                            source_mat=dict(address=24576, rows=1, cols=1, data=65536), source_bytes=b"abc")
        self.decode = self.enterContext(patch.object(memory, "unpack_detection_call", side_effect=lambda **_: deepcopy(self.decoded)))
        self.rect = self.enterContext(patch.object(memory, "unpack_rect", return_value=dict(values=[2, 3, 4, 5], raw_hex="post")))
        self.state.scalar = Mock(side_effect=self.scalar)
        self.state.blob = Mock(side_effect=self.blob)
        self.state.save_blob = Mock(side_effect=lambda *, name, metadata, pixels:
                                    dict(metadata, file=f"prediction-{self.state.prediction:02d}-{name}.bgr",
                                         sha256=hashlib.sha256(pixels).hexdigest()))

    def create_point(self, *, debugger, text):
        self.points.append(FakePoint(identity=len(self.points) + 1))
        return "created hardware point"

    def scalar(self, *, address, kind):
        return {0x10000 - 0x30: 8192, 0x20000 + 0x3C: 160, 0x20000 + 0x40: 160,
                0x20000 + 0x110: 0x30000, 0x30000 + 0x48: 0x40000}[address]

    def blob(self, *, name, address):
        return dict(address=address, data=65536, rows=160, cols=160, sha256="same pixels",
                    file=f"prediction-{self.state.prediction:02d}-{name}.bgr")

    def frame(self, *, name, tid=7, caller=0x2D5F30):
        pc = address(offset=observer.POINTS[name])
        parent = Mock(GetPCAddress=Mock(return_value=address(offset=caller)))
        thread = Mock(GetThreadID=Mock(return_value=tid), GetFrameAtIndex=Mock(return_value=parent))
        frame = Mock(GetPCAddress=Mock(return_value=pc), GetPC=Mock(return_value=observer.POINTS[name] + 0x100000),
                     GetThread=Mock(return_value=thread))
        frame.values = dict(x0=32768 if name == "entry" else 8192, x1=24576, x2=8192, x29=0x10000,
                            lr=0xABCD001234567890, w2=0, w3=160, w4=160, w5=1, w6=0, w7=0, s0=0x3FC00000)
        if name == "resized":
            frame.values["x0"] = 32768 + 0x80
        if name == "predictor":
            frame.values.update(x0=0x20000, x1=32768 + 0x80)
        return frame

    def hit(self, *, name, frame=None, location=None):
        frame = self.frame(name=name) if frame is None else frame
        location = Mock(GetBreakpoint=Mock(return_value=self.state.breakpoints[name]), IsResolved=Mock(return_value=True)) if location is None else location
        self.state.handle(frame=frame, location=location)
        return frame

    def stage(self, *, through):
        for name in ("prediction", "entry", "crop", "resized", "predictor"):
            self.hit(name=name)
            if name == through:
                return

    def test_install_is_hardware_disabled_exact_offsets_and_initial_pair(self):
        self.assertEqual(self.commands.call_args_list, [call(debugger=self.debugger,
            text=f"breakpoint set --hardware --disable -s liblens.dylib -a {offset:#x}") for offset in observer.POINTS.values()])
        self.assertEqual([name for name, point in self.state.breakpoints.items() if point.IsEnabled()], ["prediction", "entry"])
        self.assertTrue(all(point.callback == "face_preprocess_lldb.on_breakpoint" for point in self.points))
        self.assertEqual(self.state.maximum_active, 2)

    def test_install_errors_missing_or_software_point_never_fall_back(self):
        for mode in ("command", "missing", "software"):
            state = observer.Observer(debugger=self.debugger, target=self.target, out=Path("/synthetic"))
            self.points.clear()
            self.commands.reset_mock()
            self.commands.side_effect = (RuntimeError("no hardware") if mode == "command" else
                                         (lambda **_: None) if mode == "missing" else
                                         (lambda **_: self.points.append(FakePoint(identity=1, hardware=False))))
            with self.subTest(mode=mode), self.assertRaises((ValueError, RuntimeError)):
                state.install()
            self.assertEqual(self.commands.call_count, 1)
            self.assertIn("--hardware --disable", self.commands.call_args.kwargs["text"])

    def test_active_budget_four_allowed_fifth_rejected(self):
        for name in ("crop", "resized"):
            self.state.arm(name=name, enabled=True)
        self.assertEqual(self.state.maximum_active, 4)
        with self.assertRaisesRegex(ValueError, "breakpoint budget"):
            self.state.arm(name="predictor", enabled=True)
        self.assertEqual(self.commands.call_count, 5)

    def test_complete_26_prediction_two_crop_lifecycle_and_serializable_evidence(self):
        for index in range(26):
            self.hit(name="prediction")
            if index in (0, 20):
                for name in ("entry", "crop", "resized", "predictor"):
                    self.hit(name=name)
        self.assertEqual((len(self.state.predictions), len(self.state.events)), (26, 2))
        self.assertEqual([row["prediction"] for row in self.state.events], [0, 20])
        self.assertEqual(self.state.maximum_active, 4)
        self.assertIsNone(self.state.pending)
        for event in self.state.events:
            self.assertEqual(event["call"]["rect_address"], 8192)
            self.assertIsInstance(event["call"]["rect"], dict)
            self.assertNotIn("source_bytes", event["call"])
            self.assertEqual(event["raw_lr"], 0xABCD001234567890)
            self.assertEqual((event["predictor"], event["provider"], event["network"]), (0x20000, 0x30000, 0x40000))
            self.assertTrue(event["prepared_same_header"])
            self.assertTrue(event["prepared_same_storage"])
        json.dumps(self.state.events, allow_nan=False)
        self.assertEqual([point.IsEnabled() for point in self.points], [True, True, False, False, False])

    def test_copied_mat_header_and_storage_allowed_when_pixels_equal(self):
        for same_storage in (True, False):
            self.stage(through="resized")
            frame = self.frame(name="predictor")
            frame.values["x1"] = 0x50000
            self.state.blob.side_effect = lambda *, name, address: dict(self.blob(name=name, address=address),
                                                                      data=65536 if same_storage else 69632)
            self.hit(name="predictor", frame=frame)
            event = self.state.events[-1]
            self.assertFalse(event["prepared_same_header"])
            self.assertEqual(event["prepared_same_storage"], same_storage)
            self.state.blob.side_effect = self.blob

    def test_prepared_pixel_or_dimensions_mismatch_rejected(self):
        self.stage(through="resized")
        for field, value in (("sha256", "changed pixels"), ("rows", 159), ("cols", 161)):
            self.state.blob.side_effect = lambda *, name, address: dict(self.blob(name=name, address=address), **{field: value})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "prepared predictor Mat"):
                self.hit(name="predictor")
        self.assertEqual(self.state.events, [])
        self.assertIsNotNone(self.state.pending)

    def test_two_known_callers_accepted_unknown_unwind_rejected(self):
        self.hit(name="prediction")
        with self.assertRaisesRegex(ValueError, "unverified detection caller"):
            self.hit(name="entry", frame=self.frame(name="entry", caller=0x111111))
        self.decode.assert_not_called()
        for caller in observer.CALLERS:
            self.hit(name="entry", frame=self.frame(name="entry", caller=caller))
            self.assertEqual(self.state.pending["caller"], caller)
            self.state.pending = None

    def test_non160_entry_ignored_without_decoding(self):
        self.hit(name="prediction")
        for width, height in ((256, 160), (160, 256), (256, 256)):
            frame = self.frame(name="entry")
            frame.values.update(w3=width, w4=height)
            self.hit(name="entry", frame=frame)
        self.decode.assert_not_called()
        self.assertIsNone(self.state.pending)

    def test_disjoint_threads_and_reentrant_or_unfinished_calls_rejected(self):
        self.stage(through="entry")
        for name, message in (("entry", "reentrant"), ("prediction", "unfinished")):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, message):
                self.hit(name=name)
        with self.assertRaisesRegex(ValueError, "cross-thread"):
            self.hit(name="crop", frame=self.frame(name="crop", tid=8))
        self.assertEqual(self.state.thread, 7)

    def test_prediction_and_callback_watchdog_bounds(self):
        self.state.prediction = 62
        self.hit(name="prediction")
        with self.assertRaisesRegex(ValueError, "excessive prediction"):
            self.hit(name="prediction")
        self.state.prediction, self.state.callbacks = 0, 127
        self.clock.return_value = 400
        self.hit(name="prediction")
        with self.assertRaisesRegex(ValueError, "callback/watchdog"):
            self.hit(name="prediction")
        self.state.callbacks = 0
        self.clock.return_value = 400.000001
        with self.assertRaisesRegex(ValueError, "callback/watchdog"):
            self.hit(name="prediction")

    def test_unresolved_nonhardware_wrong_id_offset_and_module_hits(self):
        for mode in ("unresolved", "software", "id", "offset", "module"):
            frame, point = self.frame(name="prediction"), self.state.breakpoints["prediction"]
            location = Mock(GetBreakpoint=Mock(return_value=point), IsResolved=Mock(return_value=mode != "unresolved"))
            if mode in ("software", "id"):
                location.GetBreakpoint.return_value = FakePoint(identity=999, hardware=mode != "software")
            if mode in ("offset", "module"):
                frame.GetPCAddress.return_value = address(offset=0x111111 if mode == "offset" else observer.POINTS["prediction"],
                                                           uuid="wrong UUID" if mode == "module" else observer.LENS_UUID)
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.hit(name="prediction", frame=frame, location=location)
        self.assertEqual(self.state.predictions, [])

    def test_intermediates_require_prediction_pending_and_matching_ordinal(self):
        with self.assertRaisesRegex(ValueError, "outside a prediction"):
            self.hit(name="entry")
        self.hit(name="prediction")
        for name in ("crop", "resized", "predictor"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unassociated"):
                self.hit(name=name)
        self.stage(through="entry")
        self.state.pending["prediction"] -= 1
        with self.assertRaisesRegex(ValueError, "unassociated"):
            self.hit(name="crop")

    def test_crop_rect_ownership_and_duplicate_crop(self):
        self.stage(through="entry")
        self.state.scalar.return_value, self.state.scalar.side_effect = 8193, None
        with self.assertRaisesRegex(ValueError, "Rect ownership"):
            self.hit(name="crop")
        self.rect.assert_not_called()
        self.state.scalar.side_effect = self.scalar
        self.hit(name="crop")
        self.rect.assert_called_once_with(read=self.state.read, address=8192)
        with self.assertRaisesRegex(ValueError, "duplicate crop"):
            self.hit(name="crop")

    def test_resize_requires_crop_expected_output_and_160_dimensions(self):
        self.stage(through="entry")
        with self.assertRaisesRegex(ValueError, "resize without"):
            self.hit(name="resized")
        self.hit(name="crop")
        frame = self.frame(name="resized")
        frame.values["x0"] += 1
        with self.assertRaisesRegex(ValueError, "resize without"):
            self.hit(name="resized", frame=frame)
        self.state.blob.side_effect = lambda **kwargs: dict(self.blob(**kwargs), rows=159)
        with self.assertRaisesRegex(ValueError, "resize dimensions"):
            self.hit(name="resized")

    def test_predictor_dimensions_and_prior_resize_required(self):
        self.stage(through="crop")
        with self.assertRaisesRegex(ValueError, "wrong predictor"):
            self.hit(name="predictor")
        self.hit(name="resized")
        self.state.scalar.side_effect = lambda **_: 159
        with self.assertRaisesRegex(ValueError, "wrong predictor"):
            self.hit(name="predictor")

    def test_callback_continues_success_stops_and_records_failure(self):
        frame, location = Mock(), Mock()
        with patch.object(observer, "STATE", self.state):
            self.state.handle = Mock()
            self.assertFalse(observer.on_breakpoint(frame, location, {}))
            self.assertIs(self.state.process, frame.GetThread().GetProcess())
            self.state.handle.side_effect = ValueError("hardware safety failure")
            self.assertTrue(observer.on_breakpoint(frame, location, {}))
        self.assertEqual(self.state.failures, ["ValueError: hardware safety failure"])


class RunTests(unittest.TestCase):
    def setUp(self):
        self.lldb = fake_lldb()
        self.enterContext(patch.dict(sys.modules, {"lldb": self.lldb}))
        self.config = dict(host="/synthetic/host", lens="/synthetic/liblens.dylib", trace="/synthetic/trace",
                           arguments=["/synthetic/runtime"], environment={"HOME": "/synthetic", "QCUT_FRAME_WIDTH": "1448"},
                           stdin="/synthetic/requests.tsv", stdout="/synthetic/stdout", stderr="/synthetic/stderr")
        self.enterContext(patch.object(Path, "read_text", return_value=json.dumps(self.config)))
        self.write = self.enterContext(patch.object(Path, "write_text"))
        self.enterContext(patch("builtins.print"))
        self.commands = self.enterContext(patch.object(observer, "command"))
        self.state = Mock(predictions=[{}] * 26, events=[{}] * 2, callbacks=34, trace_bytes=153600,
                          maximum_active=4, failures=[], pending=None)
        self.factory = self.enterContext(patch.object(observer, "Observer", return_value=self.state))
        self.enterContext(patch.object(observer, "STATE", None))
        self.process = Mock(IsValid=Mock(return_value=True), GetState=Mock(return_value=10),
                            GetExitStatus=Mock(return_value=0), GetProcessID=Mock(return_value=42))
        self.target = Mock(IsValid=Mock(return_value=True), GetTriple=Mock(return_value="arm64-apple-macos"),
                           Launch=Mock(return_value=self.process))
        self.debugger = Mock(CreateTarget=Mock(return_value=self.target))
        self.info = self.lldb.SBLaunchInfo.return_value
        self.info.GetLaunchFlags.return_value = 15
        self.info.AddOpenFileAction.return_value = True

    def run_observer(self):
        observer.run(debugger=self.debugger, config_path="/synthetic/config.json")
        return json.loads(self.write.call_args.args[0])

    def test_success_launch_flags_environment_redirection_and_readonly_report(self):
        report = self.run_observer()
        self.assertTrue(report["passed"])
        for key in ("software_breakpoints_used", "target_memory_written", "target_functions_evaluated"):
            self.assertIs(report[key], False)
        self.debugger.SetAsync.assert_called_once_with(False)
        self.state.install.assert_called_once_with()
        self.info.SetLaunchFlags.assert_called_once_with(7)
        self.info.SetEnvironmentEntries.assert_called_once_with(["HOME=/synthetic", "QCUT_FRAME_WIDTH=1448"], False)
        self.assertEqual(self.info.AddOpenFileAction.call_args_list, [call(0, self.config["stdin"], True, False),
            call(1, self.config["stdout"], False, True), call(2, self.config["stderr"], False, True)])
        self.assertEqual(report["maximum_active_breakpoints"], 4)
        self.process.Kill.assert_not_called()

    def test_invalid_target_resets_previous_state_and_does_not_launch(self):
        for valid, triple in ((False, "arm64"), (True, "x86_64-apple-macos")):
            observer.STATE = self.state
            self.target.IsValid.return_value, self.target.GetTriple.return_value = valid, triple
            report = self.run_observer()
            self.assertFalse(report["passed"])
            self.assertNotIn("predictions", report)
            self.assertIsNone(observer.STATE)
        self.target.Launch.assert_not_called()

    def test_install_or_stdio_error_never_launches_or_retries_software(self):
        self.state.install.side_effect = RuntimeError("hardware unavailable")
        report = self.run_observer()
        self.assertIn("hardware unavailable", report["failures"][0])
        self.target.Launch.assert_not_called()
        self.state.install.side_effect = None
        self.info.AddOpenFileAction.return_value = False
        report = self.run_observer()
        self.assertIn("stdio", report["failures"][0])
        self.target.Launch.assert_not_called()

    def test_stopped_process_killed_nonzero_exited_not_killed(self):
        self.process.GetState.return_value = 5
        report = self.run_observer()
        self.assertFalse(report["passed"])
        self.process.Kill.assert_called_once_with()
        self.process.Kill.reset_mock()
        self.process.GetState.return_value, self.process.GetExitStatus.return_value = 10, 7
        self.assertFalse(self.run_observer()["passed"])
        self.process.Kill.assert_not_called()

    def test_launch_error_kills_valid_live_process(self):
        self.lldb.SBError().Fail.return_value = True
        self.process.GetState.return_value = 5
        report = self.run_observer()
        self.assertIn("fake LLDB error", report["failures"][0])
        self.process.Kill.assert_called_once_with()

    def test_observer_failure_pending_or_incomplete_profiles_never_pass(self):
        for field, value in (("failures", ["callback failed"]), ("pending", {"prediction": 20}),
                             ("predictions", [{}] * 25), ("events", [{}])):
            before = getattr(self.state, field)
            setattr(self.state, field, value)
            with self.subTest(field=field):
                self.assertFalse(self.run_observer()["passed"])
            setattr(self.state, field, before)


if __name__ == "__main__":
    unittest.main()
