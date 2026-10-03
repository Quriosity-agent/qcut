"""Synthetic failure/ownership contracts; no vendor function is loaded or called."""
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import face_result_adapter_trace as trace


def page_pair(*, address, target):
    immediate = (((target & ~0xFFF) - (address & ~0xFFF)) >> 12) & 0x1FFFFF
    page = 0x90000008 | ((immediate & 3) << 29) | ((immediate >> 2) << 5)
    add = 0x91000108 | ((target & 0xFFF) << 10)
    return struct.pack("<II", page, add)


class SyntheticImage:
    file_sha256 = trace.LIBRARY_SHA256

    def __init__(self):
        self.values = {
            0x25F0698: page_pair(address=0x25F0698, target=0x36F7C90),
            0x36F7D00: struct.pack("<Q", 0x25F0B44),
            0x2D29620: struct.pack("<QQ", 4, 1),
            0x2CED970: struct.pack("<QQ", 0, 6),
            0x2ECD0F8: bytes([0]),
        }

    def read(self, *, address, length):
        value = self.values[address]
        if len(value) != length:
            raise ValueError("unexpected synthetic image extent")
        return value


def synthetic_instructions():
    observed = {address + 4 * index: "nop" for address, count in trace.REGIONS.values() for index in range(count)}
    observed.update(trace.REQUIRED)
    return observed


def evidence(*, observed):
    return "\n".join(f"library[0x{address:x}] <+0>: {value}" for address, value in sorted(observed.items()))


def binding_evidence():
    return "\n".join(f"__DATA_CONST __const {address:#010x} pointer 0 libAGFX {symbol}"
                     for address, symbol in trace.REFBASE_BINDINGS.items()) + "\n"


class AdapterTraceTest(unittest.TestCase):
    def test_every_instruction_anchor_requires_exact_operands(self):
        valid = synthetic_instructions()
        with patch.object(trace, "REGION_SHA256", trace.region_fingerprints(observed=valid)):
            trace.require_trace(observed=valid)
            for address in trace.REQUIRED:
                with self.subTest(address=hex(address)):
                    changed = dict(valid)
                    changed[address] = "ret"
                    with self.assertRaisesRegex(ValueError, "anchor mismatch"):
                        trace.require_trace(observed=changed)

    def test_full_windows_also_guard_unannotated_instructions(self):
        valid = synthetic_instructions()
        changed = dict(valid)
        address = next(address for address in valid if address not in trace.REQUIRED)
        changed[address] = "ret"
        with patch.object(trace, "REGION_SHA256", trace.region_fingerprints(observed=valid)):
            with self.assertRaisesRegex(ValueError, "window fingerprint"):
                trace.require_trace(observed=changed)

    def test_extra_missing_and_shifted_addresses_fail_closed(self):
        valid = synthetic_instructions()
        missing = dict(valid)
        missing.pop(next(iter(missing)))
        candidates = (missing, valid | {0: "nop"}, {address + 4: value for address, value in valid.items()})
        for observed in candidates:
            with self.subTest(count=len(observed)), self.assertRaisesRegex(ValueError, "extent"):
                trace.require_trace(observed=observed)

    def test_pins_cover_bounded_windows_and_all_anchors(self):
        self.assertEqual(set(trace.REGION_SHA256), set(trace.REGIONS))
        for value in trace.REGION_SHA256.values():
            self.assertRegex(value, r"^[0-9a-f]{64}$")
        addresses = set(synthetic_instructions())
        self.assertTrue(set(trace.REQUIRED).issubset(addresses))
        self.assertLess(len(addresses), 1000)
        self.assertTrue(all(address % 4 == 0 and 0 < count <= 221 for address, count in trace.REGIONS.values()))

    def test_parser_ignores_comments_but_rejects_conflicting_overlaps(self):
        text = "library[0x100] <+0>: ret ; synthetic\nlibrary[0x100] <+4>: ret"
        self.assertEqual(trace.instructions(text=text), {0x100: "ret"})
        with self.assertRaisesRegex(ValueError, "overlapping"):
            trace.instructions(text=text.replace("<+4>: ret", "<+4>: nop"))
        with self.assertRaises(ValueError):
            trace.instructions(text="comment mentions a native call")

    def test_image_constructor_and_virtual_target_are_required(self):
        trace.verify_image(image=SyntheticImage())
        for address in (0x25F0698, 0x36F7D00):
            image = SyntheticImage()
            image.values[address] = bytes(len(image.values[address]))
            with self.subTest(address=hex(address)), self.assertRaises(ValueError):
                trace.verify_image(image=image)

    def test_requirement_and_factory_constants_are_required(self):
        for address in (0x2D29620, 0x2CED970, 0x2ECD0F8):
            image = SyntheticImage()
            image.values[address] = bytes([255]) * len(image.values[address])
            with self.subTest(address=hex(address)), self.assertRaisesRegex(ValueError, "constant mismatch"):
                trace.verify_image(image=image)

    def test_only_the_relevant_ownership_bindings_are_retained(self):
        valid = binding_evidence()
        unrelated = "__DATA __data 0x100 pointer 0 other irrelevant_symbol\n"
        self.assertEqual(trace.verified_bindings(text=unrelated + valid), valid)

    def test_bindings_reject_missing_ambiguous_or_wrong_ownership(self):
        valid = binding_evidence()
        rows = valid.splitlines()
        candidates = ("\n".join(rows[1:]), valid + rows[0], valid.replace("libAGFX", "other"),
                      valid.replace("pointer 0", "pointer 1"), valid.replace("__const", "__data"),
                      valid.replace("retainEv", "reduceEv"), valid + rows[0] + " extra",
                      valid + " ".join(rows[0].split()[:6]))
        for text in candidates:
            with self.subTest(text=text), self.assertRaises(ValueError):
                trace.verified_bindings(text=text)

    def test_contract_separates_raw_owner_adapted_cache_and_blit(self):
        contract = trace.recovered_contract()
        raw = contract["raw_owner"]
        self.assertEqual(raw["result_type_map_offset"], "0x10")
        self.assertEqual(raw["map_node_value_offset"], "0x18")
        self.assertEqual(raw["type"], 4)
        self.assertEqual(raw["assignment_order"][1], "retain incoming via vslot +0")
        self.assertEqual(raw["assignment_order"][3], "old release via vslot +8")
        self.assertEqual(raw["assignment_order"][-1], "store incoming")
        cache = contract["adapted_cache"]
        self.assertEqual(cache["face_requirement_low_high"], [1, 0])
        self.assertEqual(cache["key"], ["graphIndex", "outputIndex", "algorithmType"])
        self.assertFalse(cache["face_erase_invalidator_verified"])
        self.assertFalse(cache["pointer_or_timestamp_comparison"])
        self.assertIn("preserves type 4 and 46", cache["frame_clear"])
        context = contract["conversion_context"]
        self.assertEqual(context["bach_algorithm_result_offset"], "0x20")
        self.assertEqual(context["blit_buffer_offset"], "0x30")
        self.assertEqual(context["blit_buffer_type"], 3)
        self.assertFalse(context["persistent_face_buffer_pointer_cache_verified"])
        old = contract["old_adapter_lookup"]
        self.assertEqual(old["manager"], "*(imp+0x658)")
        self.assertEqual(old["converter_inputs"], {"x0": "FaceAdapter*", "x1": "conversionContext*"})
        self.assertFalse(old["internal_map_offset_verified"])
        self.assertFalse(old["internal_map_node_layout_verified"])
        self.assertFalse(old["converter_return_abi_verified"])
        self.assertFalse(raw["publish_return_abi_verified"])
        self.assertIn("synchronized writable ingress/hook before per-frame conversion", contract["unverified"])
        self.assertIn("standalone late face-cache invalidator or forced reconversion ABI", contract["unverified"])

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(trace.espresso_oracle, "PRIVATE", Path(directory)):
            output = Path(directory) / "existing"
            output.mkdir()
            with patch.object(trace, "command") as execute, self.assertRaisesRegex(ValueError, "overwrite"):
                trace.run(library=Path("missing"), output=output)
            execute.assert_not_called()

    def test_private_output_rejects_root_outside_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(trace.espresso_oracle, "PRIVATE", Path(directory) / "private"):
            root = trace.espresso_oracle.PRIVATE
            root.mkdir()
            outside = Path(directory) / "outside"
            outside.mkdir()
            (root / "escape").symlink_to(outside, target_is_directory=True)
            for output in (root, outside, root / "escape" / "output"):
                with self.subTest(output=output), patch.object(trace, "command") as execute:
                    with self.assertRaisesRegex(ValueError, "private ignored directory"):
                        trace.run(library=Path("missing"), output=output)
                    execute.assert_not_called()
            self.assertEqual(trace.espresso_oracle.private_path(path=root / "valid"), (root / "valid").resolve())

    def test_all_guard_failures_leave_no_output(self):
        failures = ("platform", "architecture", "hash", "uuid", "uuid_duplicate", "uuid_extra_arm64", "image_hash",
                    "vptr", "virtual_target", "requirement", "factory", "binding", "instruction", "window",
                    "extent", "late_hash")
        for failure in failures:
            with self.subTest(failure=failure):
                self.check_run(failure=failure)

    def test_verified_static_report_is_never_promoted_to_runtime(self):
        self.check_run(failure=None)

    def check_run(self, *, failure):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory).resolve()
            library = root / "synthetic dylib"
            original_bytes = bytes(32)
            library.write_bytes(original_bytes)
            output = root / "private" / "evidence"
            uuid = f"UUID: {trace.UUID} (arm64) synthetic\n"
            if failure == "uuid":
                uuid = uuid.replace("arm64", "x86_64")
            if failure == "uuid_duplicate":
                uuid += uuid
            if failure == "uuid_extra_arm64":
                uuid += "UUID: OTHER (arm64) synthetic\n"
            observed = synthetic_instructions()
            pins = trace.region_fingerprints(observed=observed)
            if failure == "instruction":
                observed[next(iter(trace.REQUIRED))] = "ret"
            if failure == "window":
                observed[next(address for address in observed if address not in trace.REQUIRED)] = "ret"
            if failure == "extent":
                observed[0] = "nop"
            image = SyntheticImage()
            if failure == "image_hash":
                image.file_sha256 = "bad"
            if failure == "vptr":
                image.values[0x25F0698] = bytes(8)
            if failure == "virtual_target":
                image.values[0x36F7D00] = bytes(8)
            if failure == "requirement":
                image.values[0x2D29620] = bytes(16)
            if failure == "factory":
                image.values[0x2ECD0F8] = bytes([1])
            library_hash_checks = 0

            def digest(*, path):
                nonlocal library_hash_checks
                if Path(path) == library:
                    library_hash_checks += 1
                    if failure == "hash" or (failure == "late_hash" and library_hash_checks == 2):
                        return "bad"
                    return trace.LIBRARY_SHA256
                return hashlib.sha256(Path(path).read_bytes()).hexdigest()

            stack.enter_context(patch.object(trace.espresso_oracle, "PRIVATE", root / "private"))
            stack.enter_context(patch.object(trace.espresso_oracle, "sha256", side_effect=digest))
            stack.enter_context(patch.object(trace.sys, "platform", "linux" if failure == "platform" else "darwin"))
            stack.enter_context(patch.object(trace.platform, "machine", return_value="x86_64" if failure == "architecture" else "arm64"))
            stack.enter_context(patch.object(trace, "MachO", return_value=image))
            stack.enter_context(patch.object(trace, "REGION_SHA256", pins))
            execute = stack.enter_context(patch.object(trace, "command", side_effect=[
                uuid, "" if failure == "binding" else binding_evidence(), evidence(observed=observed)]))
            if failure:
                with self.assertRaises(ValueError):
                    trace.run(library=library, output=output)
                self.assertFalse(output.exists())
                if failure in ("platform", "architecture", "hash"):
                    execute.assert_not_called()
                elif failure in ("uuid", "uuid_duplicate", "uuid_extra_arm64", "image_hash", "vptr", "virtual_target", "requirement", "factory"):
                    self.assertEqual(execute.call_count, 1)
                elif failure == "binding":
                    self.assertEqual(execute.call_count, 2)
                else:
                    self.assertEqual(execute.call_count, 3)
            else:
                report = trace.run(library=library, output=output)
                self.assertTrue(report["static_face_adapter_trace_verified"])
                for key in ("external_injection_verified", "runtime_cache_refresh_verified", "native_function_called"):
                    self.assertFalse(report[key])
                self.assertEqual(json.loads((output / "summary.json").read_text()), report)
                self.assertEqual(set(report["evidence"]), {"uuid.txt", "ownership-bindings.txt", "static-trace.txt"})
                for name, value in report["evidence"].items():
                    self.assertEqual(value, hashlib.sha256((output / name).read_bytes()).hexdigest())
                self.assertEqual(execute.call_count, 3)
                self.assertEqual(execute.call_args_list[0].kwargs["args"], ["xcrun", "dwarfdump", "--uuid", str(library)])
                self.assertEqual(execute.call_args_list[1].kwargs["args"], ["xcrun", "llvm-objdump", "--macho", "--arch=arm64", "--bind", str(library)])
                self.assertEqual(execute.call_args_list[2].kwargs["args"], trace.static_arguments(library=library))
            self.assertEqual(library.read_bytes(), original_bytes)

    def test_lldb_command_surface_only_creates_unloaded_target_and_disassembles(self):
        library = Path('/private/synthetic "quoted" dylib')
        args = trace.static_arguments(library=library)
        self.assertEqual(args[:3], ["lldb", "--batch", "--no-lldbinit"])
        self.assertTrue(all(value == "-o" for value in args[3::2]))
        commands = args[4::2]
        self.assertEqual(commands[0], "target create " + json.dumps(str(library)) + " --arch arm64")
        self.assertEqual(commands[1:-1], [f"disassemble --start-address {address:#x} --count {count}"
                                        for address, count in trace.REGIONS.values()])
        self.assertEqual(commands[-1], "quit")


if __name__ == "__main__":
    unittest.main()
