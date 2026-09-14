#!/usr/bin/env python3
"""Dump a C++ vtable from a thin arm64 dylib (vmaddr == file offset in __TEXT/__DATA_CONST here) and name each slot.
Usage: vtable.py <thin-arm64-dylib> <vtable-vaddr-hex> <slot-count> [exports.sorted]"""
import struct, subprocess, sys, re
lib, vaddr, count = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3])
exports_path = sys.argv[4] if len(sys.argv) > 4 else "exports.sorted"
exports = {int(a,16): n for a, n in (l.split() for l in open(exports_path))}
with open(lib, "rb") as f:
    f.seek(vaddr); data = f.read(8 * (count + 2))
vals = struct.unpack("<%dQ" % (count + 2), data)
print("offset-to-top:", hex(vals[0]), "typeinfo:", hex(vals[1]))
def first_strings(addr, n=48):
    out = subprocess.run(["xcrun", "llvm-objdump", "-d", "--arch=arm64", "--no-show-raw-insn", f"--start-address={addr:#x}", f"--stop-address={addr+4*n:#x}", lib], capture_output=True, text=True).stdout
    strs = re.findall(r'literal pool for: "(.*?)"', out)
    calls = [exports.get(int(m, 16)) for m in re.findall(r"\bbl\s+0x([0-9a-f]+)", out)]
    calls = [subprocess.run(["c++filt", c], capture_output=True, text=True).stdout.strip()[:70] for c in calls if c]
    return strs[:3], calls[:3]
for i, v in enumerate(vals[2:]):
    name = exports.get(v)
    if name:
        name = subprocess.run(["c++filt", name], capture_output=True, text=True).stdout.strip()
        print(f"slot {i:2d} {v:#x} {name[:110]}")
    else:
        s, c = first_strings(v)
        print(f"slot {i:2d} {v:#x} (unexported) strs={s} calls={c}")
