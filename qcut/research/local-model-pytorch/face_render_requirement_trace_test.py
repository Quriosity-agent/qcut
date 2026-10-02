"""Fail-closed static requirement-layout and consumer tracing contracts."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from face_render_requirement_trace import (
    FIELDS, LIBRARY_SHA256, REGIONS, REQUIRED, UUID, adrp_add_address,
    consumer_address, field_layout, instructions, require_instructions, run,
)


def page_pair(*, address, target, register=8):
    delta = ((target & ~0xFFF) - (address & ~0xFFF)) >> 12
    immediate = delta & 0x1FFFFF
    page = 0x90000000 | ((immediate & 3) << 29) | ((immediate >> 2) << 5) | register
    add = 0x91000000 | ((target & 0xFFF) << 10) | (register << 5) | register
    return struct.pack("<II", page, add)


class SyntheticImage:
    file_sha256 = LIBRARY_SHA256

    def read(self, *, address, length):
        if (address, length) == (0x177BD98, 8):
            return page_pair(address=address, target=0x36580E0)
        if (address, length) == (0x36580E0 + 0x538, 8):
            return struct.pack("<Q", 0x1785674)
        raise ValueError("unexpected synthetic binary read")

    def strings(self, *, pattern):
        return [{"address": index + 1, "text": "BefRequirementNew_ST::" + name}
                for index, (name, _, _, _) in enumerate(FIELDS)]

    def xrefs(self, *, target):
        return [{"adrp": FIELDS[target - 1][3], "add": FIELDS[target - 1][3] + 4}]


def evidence():
    addresses = sorted({address + 4 * index for address, count in REGIONS.values() for index in range(count)})
    return "\n".join(f"library[0x{address:x}] <+0>: {REQUIRED.get(address, 'nop')}" for address in addresses)


class RequirementTraceTest(unittest.TestCase):
    def test_comment_and_whitespace_are_not_instruction_evidence(self):
        text = "library[0x100] <+0>: ldr   x8, [x8, #0x538] ; comment\n"
        self.assertEqual(instructions(text=text), {0x100: "ldr x8, [x8, #0x538]"})
        with self.assertRaisesRegex(ValueError, "missing"):
            instructions(text="comment mentions ldr x8, [x8, #0x538]")

    def test_overlapping_regions_must_agree(self):
        text = "library[0x100] <+0>: ret\nlibrary[0x100] <+4>: ret\n"
        self.assertEqual(instructions(text=text), {0x100: "ret"})
        with self.assertRaisesRegex(ValueError, "overlapping"):
            instructions(text=text.replace("<+4>: ret", "<+4>: nop"))

    def test_every_anchor_is_required_at_its_exact_address(self):
        require_instructions(observed=dict(REQUIRED))
        for address in REQUIRED:
            observed = dict(REQUIRED)
            observed.pop(address)
            with self.assertRaisesRegex(ValueError, "mismatch"):
                require_instructions(observed=observed)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            require_instructions(observed={address + 4: value for address, value in REQUIRED.items()})

    def test_adrp_add_supports_signed_page_deltas(self):
        for address, target in ((0x177BD98, 0x36580E0), (0x4000, 0x10E0), (0x4004, 0x4FFF)):
            self.assertEqual(adrp_add_address(data=page_pair(address=address, target=target),
                                             address=address, register=8), target)

    def test_vptr_decoder_rejects_other_opcodes_registers_and_alignment(self):
        valid = page_pair(address=0x177BD98, target=0x36580E0)
        candidates = (b"", valid[:4], bytes(8), page_pair(address=0x177BD98, target=0x36580E0, register=9),
                      valid[:4] + struct.pack("<I", struct.unpack("<I", valid[4:])[0] | (1 << 22)))
        for data in candidates:
            with self.assertRaises(ValueError):
                adrp_add_address(data=data, address=0x177BD98, register=8)
        with self.assertRaises(ValueError):
            adrp_add_address(data=valid, address=0x177BD99, register=8)
        with self.assertRaises(ValueError):
            adrp_add_address(data=valid, address=0x177BD98, register=31)

    def test_consumer_must_come_from_constructor_not_an_unrelated_base_vtable(self):
        self.assertEqual(consumer_address(image=SyntheticImage()),
                         {"vptr": "0x36580e0", "slot": "0x538", "target": "0x1785674"})
        for value in (0x3656198 + 16, 0x36580E0):
            with patch.object(SyntheticImage, "read", side_effect=[page_pair(address=0x177BD98, target=value),
                                                                    struct.pack("<Q", 0x176AF24)]):
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    consumer_address(image=SyntheticImage())

    def test_field_names_need_code_cross_references(self):
        layout = field_layout(image=SyntheticImage())
        self.assertEqual(layout["size"], 32)
        self.assertEqual([item["offset"] for item in layout["fields"]], [0, 8, 16, 24])
        self.assertEqual([item["type"] for item in layout["fields"]], ["uint64", "uint64", "int32", "int32_pointer"])
        self.assertEqual(layout["padding"], [{"offset": 20, "size": 4}])
        with patch.object(SyntheticImage, "xrefs", return_value=[]), self.assertRaisesRegex(ValueError, "xref"):
            field_layout(image=SyntheticImage())
        with patch.object(SyntheticImage, "strings", return_value=[]), self.assertRaisesRegex(ValueError, "xref"):
            field_layout(image=SyntheticImage())

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                run(library=Path("missing"), output=Path(directory))

    def test_platform_hash_uuid_and_instructions_fail_without_writing(self):
        self.check_run(failure="platform")
        self.check_run(failure="hash")
        self.check_run(failure="uuid")
        self.check_run(failure="slice_hash")
        self.check_run(failure="instruction")
        self.check_run(failure="extent")
        self.check_run(failure="late_hash")

    def check_run(self, *, failure):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = root / "synthetic"
            library.write_bytes(bytes(32))
            output = root / "output"
            uuid = f"UUID: {UUID} (arm64) synthetic"
            text = evidence()
            if failure == "instruction":
                text = text.replace("str x9, [x8, #0x18]", "str x9, [x8, #0x20]")
            if failure == "extent":
                text += "\nlibrary[0x1] <+0>: nop"
            with patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)), patch(
                    "face_render_requirement_trace.sys.platform", "linux" if failure == "platform" else "darwin"), patch(
                    "platform.machine", return_value="arm64"), patch("espresso_oracle.sha256", side_effect=[
                        "bad" if failure == "hash" else LIBRARY_SHA256,
                        "bad" if failure == "late_hash" else LIBRARY_SHA256,
                        "synthetic", "synthetic"]), patch(
                    "face_render_requirement_trace.command", side_effect=["wrong" if failure == "uuid" else uuid, text]) as execute, patch(
                    "face_render_requirement_trace.MachO", return_value=SyntheticImage()):
                if failure == "slice_hash":
                    with patch.object(SyntheticImage, "file_sha256", "bad"), self.assertRaises(ValueError):
                        run(library=library, output=output)
                elif failure:
                    with self.assertRaises(ValueError):
                        run(library=library, output=output)
                else:
                    report = run(library=library, output=output)
                    self.assertTrue(report["static_requirement_trace_verified"])
                    self.assertFalse(report["external_injection_verified"])
                    self.assertFalse(report["native_function_called"])
                    self.assertEqual(report["interface_role"], "algorithm_requirements_not_face_results")
                    self.assertEqual(json.loads((output / "summary.json").read_text()), report)
                    self.assertEqual(set(report["evidence"]), {"uuid.txt", "static-trace.txt"})
                    args = execute.call_args.kwargs["args"]
                    self.assertEqual(args[:3], ["lldb", "--batch", "--no-lldbinit"])
                    commands = [args[index + 1] for index, value in enumerate(args) if value == "-o"]
                    self.assertEqual(len(commands), len(REGIONS) + 2)
                    self.assertTrue(commands[0].startswith("target create "))
                    self.assertTrue(all(value.startswith("disassemble --start-address ") for value in commands[1:-1]))
                    self.assertEqual(commands[-1], "quit")
            if failure:
                self.assertFalse(output.exists())

    def test_static_trace_never_promoted_to_runtime_injection(self):
        self.check_run(failure=None)

    def test_wrong_architecture_stops_before_binary_tools(self):
        with tempfile.TemporaryDirectory() as directory, patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)), patch(
                "face_render_requirement_trace.sys.platform", "darwin"), patch("platform.machine", return_value="x86_64"), patch(
                "face_render_requirement_trace.command") as execute:
            with self.assertRaisesRegex(ValueError, "arm64"):
                run(library=Path("missing"), output=Path(directory) / "new")
            execute.assert_not_called()

    def test_duplicate_field_labels_are_not_accepted_as_abi_evidence(self):
        rows = SyntheticImage().strings(pattern="unused")
        with patch.object(SyntheticImage, "strings", return_value=rows + [rows[0]]), self.assertRaisesRegex(ValueError, "xref"):
            field_layout(image=SyntheticImage())


if __name__ == "__main__":
    unittest.main()
