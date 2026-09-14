#!/usr/bin/env python3
"""Annotated ranged disassembly (usage: disasm.py <thin-arm64-dylib> <start-hex> <stop-hex> [exports.sorted]) for an arm64 Mach-O dylib: resolves adrp/add string
literals (cstring section), bl targets (exported symbols) and vtable slot calls."""
import re, subprocess, sys, struct, bisect
lib, start, stop = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16)
exports_path = sys.argv[4] if len(sys.argv) > 4 else "exports.sorted"
exports = {}
for line in open(exports_path):
    a, n = line.split(); exports[int(a, 16)] = n
# any __TEXT address (vmaddr == fileoff here): read a NUL-terminated printable string
BLOB = open(lib, "rb").read()
def strat(addr):
    if addr <= 0 or addr >= len(BLOB): return None
    end = BLOB.find(b"\0", addr, addr + 400)
    if end == -1 or end - addr < 2: return None
    raw = BLOB[addr:end]
    if any(b < 9 or (13 < b < 32) or b == 127 for b in raw): return None
    return raw.decode("utf-8", "replace")
out = subprocess.run(["xcrun", "llvm-objdump", "-d", "--arch=arm64", "--no-show-raw-insn",
                      f"--start-address={start:#x}", f"--stop-address={stop:#x}", lib], capture_output=True, text=True).stdout
pages = {}
demangle_cache = {}
def dem(n):
    if n not in demangle_cache:
        demangle_cache[n] = subprocess.run(["c++filt", n], capture_output=True, text=True).stdout.strip() or n
    return demangle_cache[n]
for line in out.splitlines():
    mm = re.match(r"\s*([0-9a-f]+):\s+(\S+)\s*(.*)", line)
    if not mm: continue
    addr, op, args = int(mm.group(1), 16), mm.group(2), mm.group(3)
    note = ""
    a = re.match(r"\s*[0-9a-f]+:\s+adrp\s+(x\d+), (?:\d+ ; )?(0x[0-9a-f]+)", line)
    if a: pages[a.group(1)] = int(a.group(2), 16)
    a = re.match(r"add\s+(x\d+), (x\d+), #(0x[0-9a-f]+|\d+)", f"{op} {args}")
    if op == "add" and a and a.group(2) in pages:
        tgt = pages[a.group(2)] + int(a.group(3), 0)
        s = strat(tgt)
        if s is not None: note = f'  ; str "{s[:90]}"'
        elif tgt in exports: note = f"  ; &{dem(exports[tgt])[:100]}"
    if op == "bl":
        t = re.match(r"(0x[0-9a-f]+)", args)
        if t:
            tgt = int(t.group(1), 16)
            name = exports.get(tgt)
            if name: note = f"  ; {dem(name)[:140]}"
            elif "symbol stub for" in args: note = ""
            else: note = "  ; (unexported)"
    a = re.match(r"ldr\s+(x\d+), \[(x\d+), #(0x[0-9a-f]+)\]", f"{op} {args}")
    if op == "ldr" and a: note = f"  ; slot {int(a.group(3),16)//8} if vtable"
    if op == "blr": note = "  ; --> indirect call"
    print(f"{addr:x}: {op} {args}{note}")
