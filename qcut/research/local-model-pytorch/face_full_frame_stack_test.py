"""Fake LLDB stacks and CPU-only neutral stack-probe runs; no native host."""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from face_alignment_replay import LockedFiles
import face_full_frame_stack_lldb as stacks
import face_full_frame_stack_probe as probe


def frame(*, pc=123, symbol="synthetic function", name="synthetic.dylib", uuid="synthetic UUID"):
    module = Mock(IsValid=Mock(return_value=True), GetUUIDString=Mock(return_value=uuid),
                  GetFileSpec=Mock(return_value=Mock(GetFilename=Mock(return_value=name))))
    address = Mock(IsValid=Mock(return_value=True), GetModule=Mock(return_value=module),
                   GetFileAddress=Mock(return_value=pc))
    return Mock(IsValid=Mock(return_value=True), GetPCAddress=Mock(return_value=address),
                GetFunctionName=Mock(return_value=symbol))


class StackFramesTests(unittest.TestCase):
    def setUp(self):
        self.frames = [frame(pc=stacks.base.POINTS["prediction"], name="liblens.dylib", uuid=stacks.base.LENS_UUID),
                       frame(pc=8192, symbol=None, name="libsystem_pthread.dylib", uuid="system UUID")]
        self.thread = Mock(GetNumFrames=Mock(return_value=2),
                           GetFrameAtIndex=Mock(side_effect=lambda index: self.frames[index]))

    def test_preserves_module_uuid_pc_and_symbol_identity_in_frame_order(self):
        self.assertEqual(stacks.stack_frames(thread=self.thread), [
            dict(index=0, module="liblens.dylib", uuid=stacks.base.LENS_UUID,
                 file_address=stacks.base.POINTS["prediction"], symbol="synthetic function"),
            dict(index=1, module="libsystem_pthread.dylib", uuid="system UUID", file_address=8192, symbol="")])
        self.assertEqual([call.args[0] for call in self.thread.GetFrameAtIndex.call_args_list], [0, 1])

    def test_stack_count_accepts_one_and_64_but_no_unbounded_extra_reads(self):
        for count in (1, 64):
            self.thread.GetNumFrames.return_value = count
            self.thread.GetFrameAtIndex.side_effect = lambda _: self.frames[0]
            self.thread.GetFrameAtIndex.reset_mock()
            with self.subTest(count=count):
                rows = stacks.stack_frames(thread=self.thread)
                self.assertEqual([row["index"] for row in rows], list(range(count)))
                self.assertEqual(self.thread.GetFrameAtIndex.call_count, count)

    def test_stack_count_rejects_bool_float_nan_negative_and_oversized(self):
        for count in (True, False, 1.0, float("nan"), 0, -1, 65, 10**100, None):
            self.thread.GetNumFrames.return_value = count
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "bounded initialized"):
                stacks.stack_frames(thread=self.thread)
        self.thread.GetFrameAtIndex.assert_not_called()

    def test_invalid_frame_address_or_module_stops_at_bad_frame(self):
        objects = (self.frames[0], self.frames[0].GetPCAddress(), self.frames[0].GetPCAddress().GetModule())
        for item in objects:
            item.IsValid.return_value = False
            self.thread.GetFrameAtIndex.reset_mock()
            with self.subTest(item=item), self.assertRaises(ValueError):
                stacks.stack_frames(thread=self.thread)
            self.thread.GetFrameAtIndex.assert_called_once_with(0)
            item.IsValid.return_value = True

    def test_file_address_requires_typed_nonnegative_bounded_integer(self):
        for pc in (True, 123.0, float("nan"), -1, 2**63, None, "123"):
            self.frames[0].GetPCAddress().GetFileAddress.return_value = pc
            with self.subTest(pc=pc), self.assertRaisesRegex(ValueError, "stack identity"):
                stacks.stack_frames(thread=self.thread)

    def test_file_address_zero_and_last_signed_value_are_valid(self):
        for pc in (0, 2**63 - 1):
            self.frames[0].GetPCAddress().GetFileAddress.return_value = pc
            with self.subTest(pc=pc):
                self.assertEqual(stacks.stack_frames(thread=self.thread)[0]["file_address"], pc)

    def test_module_names_and_uuids_require_nonempty_bounded_strings(self):
        module = self.frames[0].GetPCAddress().GetModule()
        for getter, limit in ((module.GetFileSpec().GetFilename, 1024), (module.GetUUIDString, 128)):
            for value in (None, "", True, 123, ["name"], "x" * (limit + 1)):
                getter.return_value = value
                with self.subTest(limit=limit, value=value), self.assertRaisesRegex(ValueError, "stack identity"):
                    stacks.stack_frames(thread=self.thread)
            getter.return_value = "x" * limit
            self.assertTrue(stacks.stack_frames(thread=self.thread))

    def test_symbol_allows_unknown_empty_and_exact_bound_not_nonstring(self):
        for symbol in (None, "", "x" * 4096):
            self.frames[0].GetFunctionName.return_value = symbol
            with self.subTest(symbol_length=len(symbol or "")):
                self.assertEqual(stacks.stack_frames(thread=self.thread)[0]["symbol"], symbol or "")
        for symbol in (True, 123, ["function"], "x" * 4097):
            self.frames[0].GetFunctionName.return_value = symbol
            with self.subTest(kind=type(symbol)), self.assertRaisesRegex(ValueError, "stack identity"):
                stacks.stack_frames(thread=self.thread)


class ObserverTests(unittest.TestCase):
    def setUp(self):
        self.state = stacks.StackObserver(debugger=Mock(), target=Mock(), out=Path("/synthetic"))
        self.frame, self.location = frame(), Mock()
        self.thread = Mock()
        self.frame.GetThread.return_value = self.thread
        self.base_type = stacks.StackObserver.__mro__[1]

    def test_prediction_base_event_is_preserved_and_stack_attached_after_base_handler(self):
        original = dict(index=0, thread=17, prediction="base-owned event")
        def handle(state, *, frame, location):
            self.assertIs(state, self.state)
            self.assertIs(frame, self.frame)
            self.assertIs(location, self.location)
            state.predictions.append(deepcopy(original))
        rows = [dict(index=0, symbol="synthetic stack")]
        with (patch.object(self.base_type, "handle", autospec=True, side_effect=handle) as base,
              patch.object(stacks.base, "file_address", return_value=stacks.base.POINTS["prediction"]),
              patch.object(stacks, "stack_frames", return_value=rows) as collect):
            self.state.handle(frame=self.frame, location=self.location)
        base.assert_called_once_with(self.state, frame=self.frame, location=self.location)
        collect.assert_called_once_with(thread=self.thread)
        self.assertEqual(self.state.predictions, [dict(original, stack=rows)])

    def test_nonprediction_events_delegate_without_stack_or_prediction_mutation(self):
        self.state.predictions = [dict(index=0, prior=True)]
        with (patch.object(self.base_type, "handle", autospec=True) as base,
              patch.object(stacks.base, "file_address") as address,
              patch.object(stacks, "stack_frames") as collect):
            for name, offset in stacks.base.POINTS.items():
                if name == "prediction":
                    continue
                address.return_value = offset
                self.state.handle(frame=self.frame, location=self.location)
        self.assertEqual(base.call_count, len(stacks.base.POINTS) - 1)
        self.assertEqual(self.state.predictions, [dict(index=0, prior=True)])
        collect.assert_not_called()

    def test_base_handler_failure_never_collects_an_uninitialized_stack(self):
        with (patch.object(self.base_type, "handle", side_effect=ValueError("base event rejected")),
              patch.object(stacks, "stack_frames") as collect):
            with self.assertRaisesRegex(ValueError, "base event rejected"):
                self.state.handle(frame=self.frame, location=self.location)
        collect.assert_not_called()
        self.assertEqual(self.state.predictions, [])

    def test_stack_error_leaves_base_prediction_without_fabricated_stack(self):
        def handle(state, *, frame, location):
            state.predictions.append(dict(index=0))
        with (patch.object(self.base_type, "handle", autospec=True, side_effect=handle),
              patch.object(stacks.base, "file_address", return_value=stacks.base.POINTS["prediction"]),
              patch.object(stacks, "stack_frames", side_effect=ValueError("unreadable stack"))):
            with self.assertRaisesRegex(ValueError, "unreadable stack"):
                self.state.handle(frame=self.frame, location=self.location)
        self.assertEqual(self.state.predictions, [dict(index=0)])

    def test_nonpinned_module_is_rejected_without_collecting_a_stack(self):
        self.frame.GetPCAddress().GetModule().GetUUIDString.return_value = "foreign module"
        with patch.object(self.base_type, "handle"), patch.object(stacks, "stack_frames") as collect:
            with self.assertRaisesRegex(ValueError, "pinned lens"):
                self.state.handle(frame=self.frame, location=self.location)
        collect.assert_not_called()

    def test_run_registers_base_callback_then_temporarily_replaces_and_restores_observer(self):
        original, debugger = stacks.base.Observer, Mock()
        def run(*, debugger, config_path):
            command.assert_called_once()
            self.assertIs(stacks.base.Observer, stacks.StackObserver)
            self.assertEqual(config_path, "/synthetic/config.json")
        with patch.object(stacks.base, "command") as command, patch.object(stacks.base, "run", side_effect=run):
            stacks.run(debugger=debugger, config_path="/synthetic/config.json")
        command.assert_called_once_with(debugger=debugger,
            text="command script import " + json.dumps(str(Path(stacks.base.__file__).resolve())))
        self.assertIs(stacks.base.Observer, original)

    def test_observer_restores_on_base_run_failure_and_import_failure(self):
        original = stacks.base.Observer
        for command_error, run_error in ((None, RuntimeError("host failure")), (ValueError("import failure"), None)):
            with (self.subTest(command_error=command_error), patch.object(stacks.base, "command", side_effect=command_error),
                  patch.object(stacks.base, "run", side_effect=run_error) as run):
                with self.assertRaises((ValueError, RuntimeError)):
                    stacks.run(debugger=Mock(), config_path="/synthetic/config.json")
                if command_error is not None:
                    run.assert_not_called()
            self.assertIs(stacks.base.Observer, original)


class StackProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name).resolve()
        cls.capture = cls.root / "capture"
        cls.capture.mkdir()
        (cls.capture / "baseline").mkdir()
        (cls.capture / "report.json").write_bytes(b'{"synthetic":true}\n')
        cls.pixels = cls.root / "synthetic-full.rgba"
        cls.pixels.write_bytes(bytes(1448 * 1086 * 4))
        for index in range(7):
            (cls.capture / "baseline" / f"frame-{index:02d}.rgba").symlink_to(cls.pixels)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name).resolve()
        self.locked = LockedFiles()
        self.locked.read(path=self.capture / "report.json")
        self.args = argparse.Namespace(capture=self.capture, out=self.out)
        self.runtime, self.package, self.host = (self.root / name for name in ("runtime", "package", "synthetic-host"))
        self.frames = [dict(input=self.pixels, timestamp=index / 30) for index in range(7)]
        self.descriptors = [dict(prediction=index, sha256=f"{index:064x}") for index in range(26)]
        self.context = dict(root=self.capture, original=self.root / "original", runtime=self.runtime,
                            package=self.package, host=self.host, evidence=dict(audit=str(self.root / "audit"),
                            algorithm_frames=deepcopy(self.descriptors)))
        self.files = dict(byte_observer=self.root / "synthetic-byte.dylib", geometry_observer=self.root / "synthetic-geometry.dylib")
        self.trace = dict(passed=True, target_memory_written=False, target_functions_evaluated=False,
                          software_breakpoints_used=False, failures=[], observer_failures=[], predictions=[
            dict(index=index, stack=[dict(index=0, uuid=stacks.base.LENS_UUID, module="liblens.dylib",
                                         file_address=stacks.base.POINTS["prediction"], symbol="prediction")])
            for index in range(26)])
        self.addCleanup(patch.stopall)
        patch.object(probe, "LockedFiles", return_value=self.locked).start()
        patch.object(probe.sequence, "fresh_output", return_value=self.out).start()
        self.load = patch.object(probe.capture, "load", return_value=self.context).start()
        self.profile = patch.object(probe.probe, "lock_profile", return_value=({}, self.runtime, self.package, self.files, self.frames)).start()
        self.requests = patch.object(probe.probe, "requests", return_value="synthetic requests\n").start()
        patch.object(probe.owned, "environment", return_value=dict(PATH="synthetic PATH", HOME="synthetic HOME",
            QCUT_FRAME_WIDTH="1448", QCUT_FRAME_HEIGHT="1086", UNTRUSTED="drop", QCUT_UNKNOWN="drop", DYLD_INSERT_LIBRARIES="drop")).start()
        patch.object(probe.probe, "system_environment", return_value={"PATH": "synthetic PATH"}).start()
        self.sources = patch.object(probe, "sources", return_value={"synthetic.py": "a" * 64}).start()
        self.process = patch.object(probe.probe, "bounded_process", side_effect=self.generate).start()
        self.protocol = patch.object(probe.probe, "validate_protocol", return_value={"synthetic": "validated"}).start()
        self.snapshots = patch.object(probe.observed, "snapshots", return_value=[dict(index=index) for index in range(26)]).start()
        self.algorithms = patch.object(probe.geometry, "algorithm_frames", return_value=deepcopy(self.descriptors)).start()
        self.metrics = patch.object(probe, "frame_metrics", side_effect=self.measure).start()
        self.library = patch.object(probe.consumer, "verify_library").start()

    def generate(self, *, command, environment, log):
        self.assertEqual(command[:4], ["xcrun", "lldb", "--batch", "--no-lldbinit"])
        self.assertEqual(environment, {"PATH": "synthetic PATH"})
        self.assertEqual(log, self.out / "lldb.log")
        (self.out / "trace" / "trace.json").write_text(json.dumps(self.trace) + "\n")
        for index in range(7):
            (self.out / "observed" / f"frame-{index:02d}.rgba").symlink_to(self.pixels)

    def measure(self, *, actual, reference, width, height):
        self.assertEqual((len(actual), len(reference), width, height), (1448 * 1086 * 4, 1448 * 1086 * 4, 1448, 1086))
        equal = actual == reference
        return dict(equal=equal, changed_pixels=0 if equal else 1, max_delta=0 if equal else 1,
                    bbox=None if equal else [0, 0, 1, 1], sha256=hashlib.sha256(actual).hexdigest())

    def saved(self):
        return json.loads((self.out / "report.json").read_bytes())

    def failed(self, *, error=ValueError, message=None):
        with self.assertRaises(error) as caught:
            probe.run(args=self.args)
        if message is not None:
            self.assertIn(message, str(caught.exception))
        report = self.saved()
        for key in ("passed", "completed", "observer_pixel_parity_verified", "arbitrary_frame_backend_connected", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.assertTrue(report["failures"])
        return report

    def test_readonly_complete_26_input_and_seven_final_pixel_profile(self):
        report = probe.run(args=self.args)
        self.assertEqual(report, self.saved())
        for key in ("passed", "completed", "diagnostic_only", "observer_pixel_parity_verified"):
            self.assertIs(report[key], True)
        for key in ("native_analysis_bypassed", "software_breakpoints_used", "target_memory_written",
                    "target_functions_evaluated", "arbitrary_frame_backend_connected", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.assertEqual(report["profile"], "full-frame-prediction-stack-diagnostic-v1")
        self.assertEqual(report["algorithm_inputs_verified"], 26)
        self.assertEqual(report["prediction_stacks"], self.trace["predictions"])
        self.assertEqual(len(report["comparisons"]), 7)
        self.assertEqual(self.metrics.call_count, 7)
        self.library.assert_called_once_with(runtime=self.runtime)
        self.load.assert_called_once_with(root=self.capture, locked=self.locked)
        self.profile.assert_called_once_with(capture=self.context["original"], audit=self.root / "audit", locked=self.locked)

    def test_config_keeps_explicit_dependencies_and_filters_unknown_environment(self):
        probe.run(args=self.args)
        config = json.loads((self.out / "lldb-config.json").read_bytes())
        self.assertEqual(config["host"], str(self.host))
        self.assertEqual(config["lens"], str(self.runtime / "Frameworks/liblens.dylib"))
        self.assertEqual(config["arguments"], list(map(str, (self.runtime, self.runtime / "Models", self.package))))
        self.assertEqual(config["environment"], dict(PATH="synthetic PATH", HOME="synthetic HOME",
            QCUT_FRAME_WIDTH="1448", QCUT_FRAME_HEIGHT="1086", DYLD_INSERT_LIBRARIES=f"{self.files['byte_observer']}:{self.files['geometry_observer']}",
            QCUT_BYTENN_CAPTURE_IO="1", QCUT_BYTENN_CAPTURE_TERMINALS="1", QCUT_BYTENN_CAPTURE_DIR=str(self.out / "capture"),
            QCUT_FACE_GEOMETRY_DIR=str(self.out / "geometry")))
        self.sources.assert_called_once_with(names=("face_full_frame_stack_probe.py", "face_full_frame_stack_lldb.py",
            "face_preprocess_lldb.py", "face_preprocess_memory.py", "face_diagnostic_report.py"), locked=self.locked)

    def test_rejected_capture_never_launches_debugger_or_claims_observer_parity(self):
        self.load.side_effect = ValueError("capture rejected")
        self.failed(message="capture rejected")
        self.process.assert_not_called()
        self.library.assert_not_called()

    def test_debugger_timeout_preserves_failed_report_without_checks_or_fallback(self):
        self.process.side_effect = subprocess.TimeoutExpired(["synthetic debugger"], 300)
        self.failed(error=subprocess.TimeoutExpired)
        self.protocol.assert_not_called()
        self.metrics.assert_not_called()
        self.library.assert_not_called()

    def test_incomplete_host_protocol_never_uses_trace_as_success(self):
        self.protocol.side_effect = ValueError("protocol incomplete")
        self.failed(message="protocol incomplete")
        self.snapshots.assert_not_called()
        self.library.assert_not_called()

    def test_trace_rejects_target_memory_writes(self):
        self.trace["target_memory_written"] = True
        self.failed(message="read-only hardware trace")
        self.metrics.assert_not_called()
        self.library.assert_not_called()

    def test_trace_rejects_software_breakpoints(self):
        self.trace["software_breakpoints_used"] = True
        self.failed(message="read-only hardware trace")

    def test_trace_rejects_target_function_evaluation(self):
        self.trace["target_functions_evaluated"] = True
        self.failed(message="read-only hardware trace")

    def test_trace_rejects_truthy_nonboolean_readonly_claim(self):
        self.trace["target_memory_written"] = 0
        self.failed(message="read-only hardware trace")

    def test_trace_failure_list_is_not_ignored_even_when_passed_is_true(self):
        self.trace["failures"] = ["unexpected debugger stop"]
        self.failed(message="read-only hardware trace")

    def test_trace_requires_exact_boolean_passed_not_truthy_integer(self):
        self.trace["passed"] = 1
        self.failed(message="read-only hardware trace")

    def test_trace_observer_failure_prevents_pixel_parity_claim(self):
        self.trace["observer_failures"] = ["stack unreadable"]
        self.failed(message="read-only hardware trace")

    def test_exact_26_prediction_stacks_are_required(self):
        self.trace["predictions"].pop()
        self.failed(message="initialized prediction stacks")

    def test_empty_stack_does_not_claim_pinned_entry(self):
        self.trace["predictions"][12]["stack"] = []
        self.failed(message="initialized prediction stacks")

    def test_stack_over_64_frames_is_rejected(self):
        self.trace["predictions"][0]["stack"] *= 65
        self.failed(message="initialized prediction stacks")

    def test_wrong_entry_uuid_is_rejected_before_algorithm_comparison(self):
        self.trace["predictions"][0]["stack"][0]["uuid"] = "foreign UUID"
        self.failed(message="initialized prediction stacks")
        self.algorithms.assert_not_called()

    def test_wrong_entry_file_address_is_rejected(self):
        self.trace["predictions"][0]["stack"][0]["file_address"] += 4
        self.failed(message="initialized prediction stacks")

    def test_boolean_prediction_index_is_not_valid_zero(self):
        self.trace["predictions"][0]["index"] = False
        self.failed()

    def test_float_entry_pc_is_not_valid_pinned_integer(self):
        self.trace["predictions"][0]["stack"][0]["file_address"] = float(stacks.base.POINTS["prediction"])
        self.failed()

    def test_algorithm_input_difference_stops_before_final_pixel_comparison(self):
        self.algorithms.return_value[25]["sha256"] = "a" * 64
        self.failed(message="altered algorithm RGBA inputs")
        self.metrics.assert_not_called()
        self.library.assert_not_called()

    def test_missing_algorithm_input_is_not_partial_verification(self):
        self.algorithms.return_value.pop()
        self.failed(message="altered algorithm RGBA inputs")

    def test_final_pixel_difference_does_not_claim_observer_parity(self):
        self.metrics.side_effect = lambda **_: dict(equal=False, changed_pixels=1, max_delta=1)
        self.failed(message="altered final pixels")
        self.library.assert_not_called()

    def test_library_identity_failure_revokes_parity_after_pixel_checks(self):
        self.library.side_effect = ValueError("runtime changed")
        self.failed(message="runtime changed")
        self.assertEqual(self.metrics.call_count, 7)

    def test_final_trace_mutation_revokes_already_verified_observer_and_completion(self):
        def mutate(*, runtime):
            (self.out / "trace" / "trace.json").write_bytes(b"mutated trace")
        self.library.side_effect = mutate
        self.failed(message="hash mismatch")

    def test_one_guard_failure_cannot_be_erased_by_successful_second_verification(self):
        with patch.object(self.locked, "verify", side_effect=[None, ValueError("final guard failed"), None]):
            self.failed(message="final guard failed")

    def test_primary_debugger_error_survives_final_guard_error_and_records_both(self):
        self.process.side_effect = RuntimeError("original debugger error")
        with patch.object(self.locked, "verify", side_effect=[None, ValueError("final guard error"), ValueError("final guard error")]):
            report = self.failed(error=RuntimeError, message="original debugger error")
        self.assertEqual(report["failures"], ["RuntimeError: original debugger error", "guard ValueError: final guard error"])


if __name__ == "__main__":
    unittest.main()
