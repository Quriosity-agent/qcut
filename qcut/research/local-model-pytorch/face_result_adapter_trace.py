"""Pinned READ-ONLY AE face-result ownership/cache trace; never runs native code.

Only creates an unloaded LLDB target and disassembles fixed address windows. No
attach, launch, expression evaluation, memory write, clone, or native mutation.
Raw vendor evidence belongs beneath the ignored .local directory, never in Git.
Recovered ordering is a research contract, not a validated injection interface.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import struct
import sys

import espresso_oracle
from face_render_injection_inventory import LIBRARY, LIBRARY_SHA256, UUID, command
from face_render_requirement_trace import adrp_add_address, instructions
from ocr_decode_binary import MachO


REGIONS = {
    "extraction_lookup": (0x16739EC, 39),
    "graph_getter": (0x25E3FF8, 14),
    "raw_lookup": (0x25E3AF8, 16),
    "raw_graph_lookup": (0x40722C, 14),
    "raw_reader": (0xC15CD4, 11),
    "raw_reader_arguments": (0xC1AF2C, 3),
    "raw_reader_key": (0xC1AF24, 2),
    "raw_publish": (0xC157E8, 15),
    "raw_map_value": (0xB5A644, 13),
    "owning_assignment": (0x407380, 29),
    "adapted_lookup": (0x25E3784, 221),
    "nested_cache_keys": (0x25D72F0, 22),
    "requirement_nonzero": (0x16B9D48, 6),
    "requirement_subset": (0x25E30BC, 16),
    "requirement_intersection": (0x1699718, 20),
    "requirement_equality": (0x16B1698, 56),
    "frame_cache_clear": (0x25E3440, 41),
    "frame_clear_caller": (0x27839D8, 11),
    "frame_clear_arguments": (0x1792064, 2),
    "frame_clear_bridge": (0x25E33B8, 8),
    "context_constructor": (0x25D9A1C, 18),
    "blit_getter": (0xC15CA0, 13),
    "frame_refresh_context": (0x25E0918, 46),
    "old_bulk_refresh": (0x25DB3AC, 53),
    "old_single_refresh": (0x25DB480, 63),
    "adapter_virtual_dispatch": (0x25D9C24, 40),
    "face_adapter_factory": (0x25DB998, 20),
    "face_adapter_initialize": (0x25F0684, 26),
    "face_adapter_reads": (0x25F0B98, 35),
    "face_count_reads": (0xC16554, 8),
    "face_raw_type": (0xC16574, 2),
    "new_single_refresh": (0x25D7494, 35),
    "new_face_reads": (0x25D75D4, 30),
    "new_face_type_check": (0x25D99B0, 3),
    "face_requirement_initialize": (0x25E2528, 8),
}

# Meaningful guards are original research notes, not a redistributed vendor dump.
REQUIRED = {
    0x1673A04: "stp x1, x2, [sp]",
    0x1673A08: "bl 0x2be1454",
    0x1673A0C: "ldr x8, [x19, #0x80]",
    0x1673A18: "bl 0x25e2438",
    0x1673A28: "bl 0x25e3ff8",
    0x1673A50: "mov w2, #0x0",
    0x1673A58: "bl 0x25e3784",
    0x1673A6C: "bl 0x2be1460",
    0x25E3FFC: "ldr w0, [x0, #0xa8]",
    0x25E4010: "ldr x8, [x8, #0x608]",
    0x25E3B08: "ldr x8, [x0]",
    0x25E3B0C: "ldr x0, [x8, #0x90]",
    0x25E3B14: "mov x19, x3",
    0x25E3B18: "bl 0x40722c",
    0x25E3B30: "b 0xc15cd4",
    0x40724C: "add x0, x0, #0xd8",
    0x407254: "bl 0x167b12c",
    0x40725C: "ldr x0, [x0, #0x18]",
    0xC15CE8: "add x0, x19, #0x10",
    0xC15CEC: "bl 0xc1af24",
    0xC15CF4: "ldr x0, [x0, #0x18]",
    0xC1AF24: "add x1, sp, #0xc",
    0xC1AF28: "b 0x167b12c",
    0xC1AF2C: "mov x19, x0",
    0xC1AF30: "str w1, [sp, #0xc]",
    0xC157FC: "ldr x8, [x2]",
    0xC15800: "cbz x8, 0xc15820",
    0xC15808: "add x0, x0, #0x10",
    0xC15810: "bl 0xb5a644",
    0xC15818: "bl 0x407380",
    0xB5A668: "add x0, x0, #0x18",
    0x407398: "cmp x8, x0",
    0x40739C: "b.eq 0x4073e4",
    0x4073AC: "ldr x9, [x9]",
    0x4073B4: "blr x9",
    0x4073C4: "ldr x8, [x8, #0x18]",
    0x4073C8: "blr x8",
    0x4073D4: "ldr x8, [x8, #0x8]",
    0x4073D8: "blr x8",
    0x4073E0: "str x8, [x19]",
    0x25E37B0: "stp w2, w1, [sp, #0xe8]",
    0x25E37B4: "str w3, [sp, #0xe4]",
    0x25E37B8: "ldr x22, [x0]",
    0x25E37C8: "add x0, x22, #0x738",
    0x25E37CC: "bl 0x2be1454",
    0x25E37D0: "add x0, x22, #0x778",
    0x25E37D8: "bl 0x25e30fc",
    0x25E37E0: "bl 0x25d72f0",
    0x25E37E8: "bl 0x25d731c",
    0x25E38D0: "ldr x8, [x19]",
    0x25E38D4: "cbz x8, 0x25e3904",
    0x25E38EC: "bl 0x16b9d48",
    0x25E38F4: "add x0, x22, #0x580",
    0x25E38FC: "bl 0x25e30bc",
    0x25E3900: "tbnz w0, #0x0, 0x25e3a9c",
    0x25E390C: "bl 0x40722c",
    0x25E3918: "bl 0xc15bf4",
    0x25E3A34: "bl 0x25d9a1c",
    0x25E3A3C: "bl 0xc15ca0",
    0x25E3A44: "ldrb w8, [x22, #0x661]",
    0x25E3A54: "ldr x0, [x22, #0x650]",
    0x25E3A60: "bl 0x25d7494",
    0x25E3A68: "ldr x0, [x22, #0x658]",
    0x25E3A74: "bl 0x25db480",
    0x25E3A9C: "ldr x19, [x19]",
    0x25E3AA4: "bl 0x2be1460",
    0x25D7310: "add x0, x0, #0x18",
    0x25D733C: "add x0, x0, #0x18",
    0x1699754: "and x9, x10, x9",
    0x16B1730: "cmp x8, x10",
    0x16B1770: "mov w0, #0x1",
    0x25E345C: "add x0, x0, #0x738",
    0x25E3464: "add x0, x19, #0x778",
    0x25E3488: "ldr w8, [x20, #0x10]",
    0x25E348C: "cmp w8, #0x2e",
    0x25E3490: "ccmp w8, #0x4, #0x4, ne",
    0x25E3494: "b.ne 0x25e34a0",
    0x25E349C: "b 0x25e3484",
    0x25E34BC: "bl 0x25e5260",
    0x27839D8: "ldr x0, [x19, #0x178]",
    0x27839F0: "bl 0x1792064",
    0x1792064: "mov w1, #0x0",
    0x1792068: "b 0x25e33b8",
    0x25D9A3C: "stp x1, x2, [x0], #0x10",
    0x25D9A48: "stp x21, x20, [x22, #0x18]",
    0x25D9A4C: "stp x19, xzr, [x22, #0x28]",
    0xC15CB0: "mov w1, #0x3",
    0x25E0940: "bl 0x25d9a1c",
    0x25E0954: "bl 0x25e30fc",
    0x25E095C: "bl 0x25d72f0",
    0x25E0984: "bl 0x25d7348",
    0x25E09C8: "bl 0x25db3ac",
    0x25DB3D4: "ldr x22, [x1, #0x20]",
    0x25DB3DC: "bl 0xc15ca0",
    0x25DB3E0: "str x0, [x20, #0x30]",
    0x25DB448: "bl 0x25db480",
    0x25DB498: "mov x21, x2",
    0x25DB49C: "mov x19, x1",
    0x25DB4A0: "mov x22, x0",
    0x25DB4A4: "str w3, [sp, #0x1c]",
    0x25DB4AC: "add x1, sp, #0x1c",
    0x25DB4B0: "bl 0x25dcd08",
    0x25DB4B8: "mov x20, x0",
    0x25DB4E0: "ldr x0, [x21]",
    0x25DB4E4: "cbnz x0, 0x25db514",
    0x25DB518: "ldr x8, [x8, #0x38]",
    0x25DB51C: "blr x8",
    0x25DB524: "str x8, [x19, #0x18]",
    0x25DB534: "bl 0xc15ca0",
    0x25DB538: "str x0, [x19, #0x30]",
    0x25DB53C: "mov x0, x20",
    0x25DB540: "mov x1, x19",
    0x25DB544: "bl 0x25d9c24",
    0x25D9C34: "mov x19, x1",
    0x25D9C38: "mov x20, x0",
    0x25D9C7C: "ldr x0, [x19, #0x20]",
    0x25D9C84: "ldr w1, [x20, #0x8]",
    0x25D9C94: "ldr x2, [x8, #0x70]",
    0x25D9C98: "mov x0, x20",
    0x25D9C9C: "mov x1, x19",
    0x25D9CAC: "br x2",
    0x25DB9A8: "sub w8, w0, #0x4",
    0x25DB9C4: "add x10, x10, x11, lsl #2",
    0x25DB9D4: "bl 0x25f0684",
    0x25F06A0: "str x8, [x0]",
    0x25F0B98: "ldr x22, [x1, #0x18]",
    0x25F0BA8: "mov x23, x1",
    0x25F0BAC: "mov x9, x0",
    0x25F0C0C: "ldr x12, [x23, #0x20]",
    0x25F0C18: "stp x8, x12, [sp, #0x58]",
    0xC1655C: "bl 0xc16574",
    0xC16564: "ldp x9, x8, [x0, #0x38]",
    0xC16574: "mov w1, #0x4",
    0xC16578: "b 0xc15cd4",
    0x25D74A8: "cmp w3, #0x4",
    0x25D74F0: "bl 0xaafba4",
    0x25D7518: "bl 0x25d7580",
    0x25D75D4: "ldr x22, [x1, #0x20]",
    0x25D75E4: "bl 0x25d99b0",
    0x25D99B4: "mov w1, #0x4",
    0x25D99B8: "b 0xc15bf4",
    0x25E252C: "ldr q1, [x8, #0x620]",
    0x25E2530: "stp q0, q1, [sp, #0x170]",
    0x25E2538: "ldr q0, [x8, #0x970]",
    0x25E2544: "stp q0, q1, [sp, #0x190]",
}

REGION_SHA256 = {
    "extraction_lookup": "1abaeae966aab3b8b4c2ea9f153d94385f8c098f0da225a19a3b8507bd9d5824",
    "graph_getter": "78103c4d66492853f0aaa7007f2236d026ca87aa23d3f1b9fce04b061d7ce08b",
    "raw_lookup": "7e639ce3afd9a872f715ea7f1e1ded7fe0281b3f8216b75206b6c55a98e161d1",
    "raw_graph_lookup": "b09d5ef7edcf6dcf7fcf20373d444117fccd61f7f1a2aeb2363f417eb38e1726",
    "raw_reader": "a2e7f220cf818c36739e6b28f16d3cef359df8d44585375d111ca86f2544427d",
    "raw_reader_arguments": "88ea4a404f9c8420afa009f3916a5814ad673a3c784946985c593cda6811de4b",
    "raw_reader_key": "2f7408d1ff380e0638007a7da7a543c3254b94ba0c1a6e1e16f9b12c52b57dd6",
    "raw_publish": "54712cf171de55f8d9f1677f4dbd4e438f4b65d46edae50677dbb9e249a84269",
    "raw_map_value": "8c582eeaa1503eaee30b4947f24191521d03b85126ea9bf9ab72a9cf51fc4385",
    "owning_assignment": "6e1b254c1f21b4d1056677abd0d47d941ce9d8bb2d9bbd970bf145d2eec7fa20",
    "adapted_lookup": "5f33bd7710e32cbb5fa40201279a44608612cd6569340b0f83e664890ab5ac04",
    "nested_cache_keys": "b0bb924601c21786a1facc36eecbc2b8fb043eb182550661308fa2d58895a013",
    "requirement_nonzero": "41e95d4d7f5bc3ef4f1b7be122dd0c1760be23b25dce0776357f9b32d133498e",
    "requirement_subset": "80cc7d17f36e7f8ad6b98aaebb3b53479b923d28e35cd1bf4763c0e539ca1fec",
    "requirement_intersection": "29bcb73787ab8d674701e572694534d774840b2d6ca46931ca1bf65f846f8080",
    "requirement_equality": "1a9d3e912edcc74b9e0a556cb61811e2731524e1f8b75a9c51ce576e6ce6e331",
    "frame_cache_clear": "a42b9c95ff68bd5eb5dd3a5d5c5ca56078ae1321cc0d2ebab83caa4b7046cca0",
    "frame_clear_caller": "83f6e3958f2ce727dfc1ff5557d48ab954e4d9e98bd2ff5212cd894bf0f984f9",
    "frame_clear_arguments": "1be919e7ac077d22c7588d6a96bab2940711c9c3196e4a4b83951fadc4fd13a0",
    "frame_clear_bridge": "4e58f06fb2fd30697ba756998b43e705958aeef5b9aca3495cde637739523c30",
    "context_constructor": "e25053d30c58be52d428ef3650c5379159288e7605f24cc5a5e89890d51477e4",
    "blit_getter": "921690cf1b7bd5af2d6371c220fa39d094ed98355e0d10e6c1609d31eb8a106b",
    "frame_refresh_context": "995ae6b631b6ad1ad54d586b77e190a92ba0a3cb74ed66a60d2da63507ce2e0b",
    "old_bulk_refresh": "ac6f5180bb2a09343b219d16b9be7d206ee54045d7e387907058142e0565d7c9",
    "old_single_refresh": "2065a56ddc624bb732e49f7c11d9e690e8a3fec6f1e59ab2420002c267b0e503",
    "adapter_virtual_dispatch": "547724f23402615ad4becb034546edae997b3c213957c36f46cd4436a372babc",
    "face_adapter_factory": "6fc37affe000f89944225a704af6a303594560a23e6a6a3d9b88565846ced54c",
    "face_adapter_initialize": "0fd37a13112e815520c1b71a9b48702288dd2db5ffe808798d3e3aa717f8373b",
    "face_adapter_reads": "2e13a01b1daef0ef38cdf495f6e3d69efb193e736f4fce15af8418d0cf05b853",
    "face_count_reads": "1c4d9ab82ab97261934b217c836b3a825d43438f36c98f10dae7d42ff21d7259",
    "face_raw_type": "c8399f352e7202b6ddcda15f72e070bd57325521e2360e0b757a662ea4cb96f6",
    "new_single_refresh": "f00fce796b6f3759014b706b4a6b325c84c59d56792a3f4a862a915835f7fd80",
    "new_face_reads": "a7e445f4e0d138aa089106057f32867241c7d0043930933bcd99b9e3377e1352",
    "new_face_type_check": "c6312c0a952bad597710015f9bc11753d053aa640005a78304a30f45344d1d42",
    "face_requirement_initialize": "a22c99528d7ffa60b478cbb63aa2cb5ed2a5f3f374fa645107ab7f4f44f7d668",
}

REFBASE_BINDINGS = {
    0x360EAC8: "__ZNK13AmazingEngine7RefBase6retainEv",
    0x360EAD0: "__ZNK13AmazingEngine7RefBase7releaseEv",
    0x360EAE0: "__ZNK13AmazingEngine7RefBase11getRefCountEv",
}


def region_fingerprints(*, observed):
    return {name: hashlib.sha256("".join(
        f"{address + 4 * index:x}:{observed[address + 4 * index]}\n"
        for index in range(count)).encode("ascii")).hexdigest()
        for name, (address, count) in REGIONS.items()}


def require_trace(*, observed):
    addresses = {address + 4 * index for address, count in REGIONS.values() for index in range(count)}
    if set(observed) != addresses:
        raise ValueError("unexpected static disassembly extent")
    mismatches = [hex(address) for address, value in REQUIRED.items() if observed.get(address) != value]
    if mismatches:
        raise ValueError("adapter instruction anchor mismatch: " + ", ".join(mismatches))
    if region_fingerprints(observed=observed) != REGION_SHA256:
        raise ValueError("adapter instruction window fingerprint mismatch")


def static_arguments(*, library):
    args = ["lldb", "--batch", "--no-lldbinit", "-o",
            "target create " + json.dumps(str(library)) + " --arch arm64"]
    for address, count in REGIONS.values():
        args += ["-o", f"disassemble --start-address {address:#x} --count {count}"]
    return args + ["-o", "quit"]


def verify_image(*, image):
    vptr = adrp_add_address(data=image.read(address=0x25F0698, length=8), address=0x25F0698, register=8)
    if vptr != 0x36F7C90 or struct.unpack("<Q", image.read(address=vptr + 0x70, length=8))[0] != 0x25F0B44:
        raise ValueError("face adapter vptr/virtual conversion mismatch")
    checks = ((0x2D29620, struct.pack("<QQ", 4, 1)), (0x2CED970, struct.pack("<QQ", 0, 6)),
              (0x2ECD0F8, bytes([0])))
    for address, expected in checks:
        if image.read(address=address, length=len(expected)) != expected:
            raise ValueError("face requirement/factory constant mismatch")


def verified_bindings(*, text):
    rows = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 3 or not fields[2].startswith("0x"):
            continue
        address = int(fields[2], 16)
        if address not in REFBASE_BINDINGS:
            continue
        if address in rows or fields[:2] != ["__DATA_CONST", "__const"] or fields[3:6] != ["pointer", "0", "libAGFX"]:
            raise ValueError("ambiguous RefBase ownership binding")
        if len(fields) != 7 or fields[6] != REFBASE_BINDINGS[address]:
            raise ValueError("RefBase ownership binding mismatch")
        rows[address] = line
    if set(rows) != set(REFBASE_BINDINGS):
        raise ValueError("missing RefBase ownership binding")
    return "\n".join(rows[address] for address in sorted(rows)) + "\n"


def recovered_contract():
    return {
        "raw_owner": {"manager_imp": "manager[0]", "ae_manager_offset": "0x90",
                      "ae_manager_graph_map_offset": "0xd8",
                      "graph_result_getter": "0x40722c(aeManager, graphIndex)",
                      "result_type_map_offset": "0x10", "type": 4, "map_node_value_offset": "0x18",
                      "borrowed_getter": "0xc15cd4(BachAlgorithmResult*, type)",
                      "owning_publish": "0xc157e8(BachAlgorithmResult*, int32_t type, FaceBuffer** incoming) for type 4",
                      "publish_precondition": "incoming and *incoming must be non-null; publisher rejects null buffers",
                      "publish_return_abi_verified": False,
                      "assignment": "0x407380(owning_slot, pointer_to_buffer)",
                      "assignment_order": ["same-pointer no-op", "retain incoming via vslot +0",
                                           "old getRefCount via vslot +0x18", "old release via vslot +8",
                                           "store incoming"],
                      "output_index": "0x25e3af8 accepts x2 but does not use it on the successful path"},
        "adapted_cache": {"mutex_imp_offset": "0x738", "graph_map_imp_offset": "0x778",
                          "face_requirement_low_high": [1, 0],
                          "key": ["graphIndex", "outputIndex", "algorithmType"],
                          "value": "shared ownership of algorithm_result_face_st, not FaceBuffer",
                          "cache_hit": "non-null adapted result and nonzero type requirement contained in imp+0x588 128-bit requirement bits",
                          "pointer_or_timestamp_comparison": False,
                          "frame_clear": "0x25e3440(imp, pipelineIndex) preserves type 4 and 46 entries",
                          "face_erase_invalidator_verified": False},
        "conversion_context": {"adapted_result_offset": "0x18", "bach_algorithm_result_offset": "0x20",
                               "blit_buffer_offset": "0x30", "blit_buffer_type": 3,
                               "face_raw_getter": "0xc16574 -> 0xc15cd4(type=4)",
                               "persistent_face_buffer_pointer_cache_verified": False},
        "old_adapter_lookup": {"manager": "*(imp+0x658)",
                               "single_refresh": "0x25db480(x0=oldAdapterManager, x1=conversionContext*, x2=adapted-result ownership-pair slot*, w3=int32 type)",
                               "lookup": "0x25dcd08(x0=oldAdapterManager, x1=pointer_to_int32_type) returns adapter pointer used directly",
                               "internal_map_offset_verified": False, "internal_map_node_layout_verified": False,
                               "converter_dispatch": "0x25d9c24 -> adapter vptr slot +0x70",
                               "converter_inputs": {"x0": "FaceAdapter*", "x1": "conversionContext*"},
                               "x2": "dispatch branch target, not an established third argument",
                               "converter_return_abi_verified": False},
        "refresh": {"per_frame": "0x25e09c8 -> 0x25db3ac -> 0x25db448 -> 0x25db480",
                    "old_face_virtual": "FaceAdapter vptr 0x36f7c90 slot +0x70 -> 0x25f0b44",
                    "new_face": "imp+0x661 == 1: imp+0x650 -> 0x25d7494 -> 0x25d7580",
                    "old_face": "otherwise: imp+0x658 -> 0x25db480 -> 0x25d9c24",
                    "late_lookup": "0x16739ec -> 0x25e3784 can return already-adapted data without conversion"},
        "candidate_lifecycle_order": [
            "Validate clone/isolation independently; this trace does not construct or clone a buffer.",
            "Quiesce graph analysis and all result consumers; no synchronized external writer is established.",
            "Resolve the current manager/graph BachAlgorithmResult and preserve an owning reference to the old buffer if restoration is needed.",
            "Publish through the owning type-4 assignment, after analysis publishes its result but before the first face conversion reads it.",
            "Let the existing per-frame old/new conversion refresh the persistent adapted result before effect consumers run.",
            "Keep the replacement alive for all raw/adapted borrowers; restoration must use owning assignment and reconversion, not a raw store.",
        ],
        "unverified": ["synchronized writable ingress/hook before per-frame conversion",
                       "publisher return ABI and any external-call/thread-safety contract",
                       "oldAdapterManager lookup helper 0x25dcd08 internal map offset/node layout; converter return ABI",
                       "standalone late face-cache invalidator or forced reconversion ABI",
                       "active runtime old/new adapter mode and multiple output-index behavior",
                       "all auxiliary masks/borrowers and asynchronous consumer completion",
                       "clone ownership is outside this trace; native bypass, pixel equivalence, and runtime replacement are not verified here"],
    }


def run(*, library, output):
    output = espresso_oracle.private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite adapter evidence")
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise ValueError("adapter trace is pinned to macOS arm64")
    library = Path(library).resolve()
    if espresso_oracle.sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("effect core hash mismatch")
    uuid = command(args=["xcrun", "dwarfdump", "--uuid", str(library)])
    arm64_uuids = re.findall(r"^UUID: (\S+) \(arm64\) .+$", uuid, re.MULTILINE)
    if arm64_uuids != [UUID]:
        raise ValueError("effect core architecture UUID mismatch")
    image = MachO(data=library.read_bytes())
    if image.file_sha256 != LIBRARY_SHA256:
        raise ValueError("effect core changed during image read")
    verify_image(image=image)
    bind_output = command(args=["xcrun", "llvm-objdump", "--macho", "--arch=arm64", "--bind", str(library)], maximum=16000000)
    bindings = verified_bindings(text=bind_output)
    evidence = command(args=static_arguments(library=library))
    observed = instructions(text=evidence)
    require_trace(observed=observed)
    if espresso_oracle.sha256(path=library) != LIBRARY_SHA256:
        raise ValueError("effect core changed during trace")
    report = {"static_face_adapter_trace_verified": True, "external_injection_verified": False,
              "runtime_cache_refresh_verified": False, "native_function_called": False,
              "effect_core_sha256": LIBRARY_SHA256, "arm64_uuid": UUID,
              "verified_instruction_anchors": len(REQUIRED), "instruction_window_sha256": REGION_SHA256,
              "regions": {name: {"address": hex(address), "count": count} for name, (address, count) in REGIONS.items()},
              "contract": recovered_contract()}
    output.mkdir(parents=True, exist_ok=False)
    for name, value in (("uuid.txt", uuid), ("ownership-bindings.txt", bindings), ("static-trace.txt", evidence)):
        (output / name).write_text(value)
    report["evidence"] = {path.name: espresso_oracle.sha256(path=path) for path in sorted(output.glob("*.txt"))}
    (output / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=LIBRARY)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = run(library=args.library, output=args.out)
    print(json.dumps({key: report[key] for key in ("static_face_adapter_trace_verified", "external_injection_verified",
                                                 "runtime_cache_refresh_verified", "native_function_called",
                                                 "verified_instruction_anchors")}))


if __name__ == "__main__":
    main()
