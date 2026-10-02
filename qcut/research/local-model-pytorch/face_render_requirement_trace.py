"""Pinned, read-only evidence that external-algorithm setters consume requirements."""
import argparse
import json
from pathlib import Path
import platform
import re
import struct
import sys

import espresso_oracle
from face_render_injection_inventory import LIBRARY, LIBRARY_SHA256, UUID, command
from ocr_decode_binary import MachO


REGIONS = {
    "create_handle": (0x16386D8, 148),
    "manager_constructor": (0x177BD40, 32),
    "constructor_this": (0x1792294, 3),
    "old_wrapper": (0x2277744, 34),
    "array_wrapper": (0x22777DC, 33),
    "old_setter": (0x1642A28, 34),
    "new_setter": (0x1642AB0, 36),
    "new_arguments": (0x9E4594, 3),
    "array_setter": (0x1642B44, 39),
    "array_converter": (0x164299C, 35),
    "converter_arguments": (0x3FE8AC, 3),
    "array_ids": (0x164C1E4, 3),
    "bitset_merge": (0x1648870, 10),
    "virtual_arguments": (0x6C6DEC, 3),
    "requirement_consumer": (0x1785674, 20),
    "consumer_this": (0x17919B0, 4),
    "consumer_compare": (0x1792010, 2),
    "comparison": (0x16B7CF4, 24),
    "requirement_constructor": (0x1728A34, 28),
    "allocate_requirement": (0x4004E8, 2),
    "zero_requirement": (0x1769038, 4),
    "req_get": (0x1728AA4, 35),
    "req_set": (0x1728B8C, 38),
    "param_get": (0x1728C90, 34),
    "param_get_value": (0x176A778, 3),
    "param_set": (0x1728D74, 39),
    "num_get": (0x1728E78, 33),
    "num_get_value": (0x1768A44, 5),
    "num_set": (0x1728F58, 35),
    "num_set_value": (0x1769D7C, 3),
    "ids_get": (0x1729058, 33),
    "ids_get_value": (0x176AC34, 3),
    "ids_set": (0x1729144, 34),
}

# Shared register-save thunks must be followed; they do not obey a standalone C ABI.
REQUIRED = {
    0x16387CC: "bl 0x177bd40",
    0x177BD60: "bl 0x1792294",
    0x1792294: "mov x19, x0",
    0x177BDA4: "stp x8, x9, [x19]",
    0x227778C: "bl 0x1642ab0",
    0x2277814: "ldp q0, q1, [x20]",
    0x2277818: "stp q0, q1, [sp]",
    0x2277820: "bl 0x1642b44",
    0x1642A60: "stp xzr, x19, [sp, #0x8]",
    0x1642A64: "stp xzr, x19, [sp, #0x18]",
    0x1642A6C: "ldr x8, [x8, #0x538]",
    0x1642ACC: "bl 0x9e4594",
    0x9E4594: "mov x19, x2",
    0x9E4598: "mov x20, x1",
    0x1642AF4: "stp xzr, x20, [sp, #0x8]",
    0x1642AF8: "stp xzr, x19, [sp, #0x18]",
    0x1642B00: "ldr x8, [x8, #0x538]",
    0x1642B90: "bl 0x164299c",
    0x1642B94: "ldp q0, q1, [sp, #0x20]",
    0x1642BA0: "ldr x8, [x8, #0x538]",
    0x1642BA4: "bl 0x6c6dec",
    0x6C6DEC: "mov x1, sp",
    0x6C6DF0: "mov x0, x20",
    0x16429B0: "bl 0x3fe8ac",
    0x3FE8AC: "mov x19, x1",
    0x3FE8B0: "mov x20, x0",
    0x16429CC: "ldr x8, [x20, #0x8]",
    0x16429D4: "orr x8, x9, x8",
    0x16429DC: "adrp x8, 5603",
    0x16429E4: "str q0, [sp, #0x10]",
    0x16429E8: "ldrsw x8, [x20, #0x10]",
    0x16429F4: "ldr x8, [x20, #0x18]",
    0x16429F8: "bl 0x164c1e4",
    0x164C1E4: "ldrsw x1, [x8, x21, lsl #2]",
    0x1642A08: "bl 0x1648870",
    0x1648874: "cmp x8, #0x10",
    0x1648884: "orr x9, x10, x9",
    0x1648888: "str x9, [x0, x8]",
    0x1785684: "mov x20, x1",
    0x1785688: "bl 0x17919b0",
    0x17919B0: "mov x19, x0",
    0x178568C: "add x8, x19, #0x898",
    0x1785690: "ldp q0, q1, [x20]",
    0x1785694: "stp q0, q1, [x8]",
    0x1785698: "add x0, x19, #0x838",
    0x1792014: "b 0x16b7cf4",
    0x4004E8: "mov w0, #0x20",
    0x1769040: "stp q0, q0, [x0]",
    0x1728B18: "ldr d0, [x8]",
    0x1728C10: "fcvtzu x9, d0",
    0x1728C14: "str x9, [x8]",
    0x176A77C: "ldr d0, [x8, #0x8]",
    0x1728DF8: "fcvtzu x9, d0",
    0x1728DFC: "str x9, [x8, #0x8]",
    0x1768A48: "ldr w8, [x8, #0x10]",
    0x1768A4C: "scvtf d0, w8",
    0x1769D7C: "fcvtzs w9, d0",
    0x1769D80: "str w9, [x8, #0x10]",
    0x176AC38: "ldr x1, [x8, #0x18]",
    0x17291C4: "str x9, [x8, #0x18]",
}

FIELDS = (
    ("algorithmReq", 0, "uint64", 0x1728AD8),
    ("algorithmParam", 8, "uint64", 0x1728CC4),
    ("algorithmNum", 16, "int32", 0x1728EAC),
    ("algorithmRequirement", 24, "int32_pointer", 0x172908C),
)


def instructions(*, text):
    result = {}
    for match in re.finditer(r"^.*?\[0x([0-9a-f]+)\]\s+<\+\d+>:\s*(.*)$", text, re.MULTILINE):
        address = int(match.group(1), 16)
        value = " ".join(match.group(2).split(";", 1)[0].split())
        if address in result and result[address] != value:
            raise ValueError("inconsistent overlapping instruction evidence")
        result[address] = value
    if not result:
        raise ValueError("static instruction evidence missing")
    return result


def require_instructions(*, observed, required=REQUIRED):
    missing = [hex(address) for address, expected in required.items() if observed.get(address) != expected]
    if missing:
        raise ValueError("requirement trace instruction mismatch: " + ", ".join(missing))


def adrp_add_address(*, data, address, register):
    if len(data) != 8 or address % 4 or not 0 <= register < 31:
        raise ValueError("aligned ADRP/ADD pair required")
    page, add = struct.unpack("<II", data)
    if (page & 0x9F000000 != 0x90000000 or page & 31 != register
            or add & 0xFFC00000 != 0x91000000 or add & 31 != register
            or add >> 5 & 31 != register):
        raise ValueError("unexpected constructor vptr ADRP/ADD")
    immediate = ((page >> 5 & 0x7FFFF) << 2) | (page >> 29 & 3)
    if immediate & (1 << 20):
        immediate -= 1 << 21
    return (address & ~0xFFF) + (immediate << 12) + (add >> 10 & 0xFFF)


def consumer_address(*, image):
    vptr = adrp_add_address(data=image.read(address=0x177BD98, length=8), address=0x177BD98, register=8)
    if vptr != 0x36580E0:
        raise ValueError("constructor vptr mismatch")
    target = struct.unpack("<Q", image.read(address=vptr + 0x538, length=8))[0]
    if target != 0x1785674:
        raise ValueError("external requirement consumer mismatch")
    return {"vptr": hex(vptr), "slot": "0x538", "target": hex(target)}


def field_layout(*, image):
    strings = image.strings(pattern=r"^BefRequirementNew_ST::algorithm")
    fields = []
    for name, offset, kind, anchor in FIELDS:
        matching = [item for item in strings if item["text"] == "BefRequirementNew_ST::" + name]
        if len(matching) != 1 or not any(ref["adrp"] == anchor for ref in image.xrefs(target=matching[0]["address"])):
            raise ValueError("requirement field name/xref mismatch: " + name)
        fields.append({"name": name, "offset": offset, "type": kind})
    return {"size": 32, "alignment": 8, "fields": fields, "padding": [{"offset": 20, "size": 4}]}


def run(*, library, output):
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite requirement evidence")
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise ValueError("requirement trace is pinned to macOS arm64")
    library = Path(library).resolve()
    if espresso_oracle.sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("effect core hash mismatch")
    uuid = command(args=["xcrun", "dwarfdump", "--uuid", str(library)])
    if not re.search(r"UUID: " + re.escape(UUID) + r" \(arm64\)", uuid):
        raise ValueError("effect core architecture UUID mismatch")
    image = MachO(data=library.read_bytes())
    if image.file_sha256 != LIBRARY_SHA256:
        raise ValueError("effect core changed during trace")
    consumer = consumer_address(image=image)
    layout = field_layout(image=image)
    args = ["lldb", "--batch", "--no-lldbinit", "-o", "target create " + json.dumps(str(library)) + " --arch arm64"]
    for address, count in REGIONS.values():
        args += ["-o", f"disassemble --start-address {address:#x} --count {count}"]
    evidence = command(args=args + ["-o", "quit"])
    observed = instructions(text=evidence)
    require_instructions(observed=observed)
    expected_addresses = {address + 4 * index for address, count in REGIONS.values() for index in range(count)}
    if set(observed) != expected_addresses:
        raise ValueError("unexpected static disassembly extent")
    if espresso_oracle.sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("effect core changed during trace")
    report = {
        "static_requirement_trace_verified": True,
        "external_injection_verified": False,
        "native_function_called": False,
        "effect_core_sha256": LIBRARY_SHA256,
        "arm64_uuid": UUID,
        "interface_role": "algorithm_requirements_not_face_results",
        "layout": layout,
        "consumer": consumer,
        "internal_payload": {"size": 32, "operation": "requirement_bits_merge_and_value_copy", "manager_offset": "0x898"},
        "verified_instruction_anchors": len(REQUIRED),
        "regions": {name: {"address": hex(address), "count": count} for name, (address, count) in REGIONS.items()},
        "unverified": ["a writable Bach face-result ingress", "face result ownership and lifetime",
                       "internal analysis bypass", "render response to external points"],
    }
    output.mkdir(parents=True)
    (output / "uuid.txt").write_text(uuid)
    (output / "static-trace.txt").write_text(evidence)
    report["evidence"] = {path.name: espresso_oracle.sha256(path=path) for path in output.glob("*.txt")}
    (output / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=LIBRARY)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = run(library=args.library, output=args.out)
    print(json.dumps({key: report[key] for key in ("static_requirement_trace_verified", "external_injection_verified",
                                                 "interface_role", "consumer", "verified_instruction_anchors")}))


if __name__ == "__main__":
    main()
