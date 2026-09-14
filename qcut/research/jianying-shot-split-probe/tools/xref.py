#!/usr/bin/env python3
"""Find adrp+add references to an address inside a thin arm64 Mach-O (vmaddr == file offset for __TEXT).
Usage: xref.py <thin-arm64-dylib> <target-hex> [exports.sorted]  — prints referencing instruction
addresses and the nearest preceding exported symbol."""
import struct, sys, bisect
lib, target = sys.argv[1], int(sys.argv[2], 16)
exports_path = sys.argv[3] if len(sys.argv) > 3 else "exports.sorted"
b = open(lib, "rb").read()
# __text bounds: read from load commands (LC_SEGMENT_64 __TEXT / section __text)
ncmds = struct.unpack("<I", b[16:20])[0]; off = 32; text_off = text_size = 0
for _ in range(ncmds):
    cmd, size = struct.unpack("<II", b[off:off+8])
    if cmd == 0x19 and b[off+8:off+24].rstrip(b"\0") == b"__TEXT":
        nsects = struct.unpack("<I", b[off+64:off+68])[0]; so = off + 72
        for _ in range(nsects):
            if b[so:so+16].rstrip(b"\0") == b"__text":
                text_off = struct.unpack("<I", b[so+48:so+52])[0]; text_size = struct.unpack("<Q", b[so+40:so+48])[0]
            so += 80
    off += size
syms = []
for line in open(exports_path):
    a, n = line.split(); syms.append((int(a, 16), n))
syms.sort(); addrs = [a for a, _ in syms]
def nearest(addr):
    i = bisect.bisect_right(addrs, addr) - 1
    return syms[i] if i >= 0 else (0, "?")
page = target & ~0xfff
hits = []
words = struct.unpack("<%dI" % (text_size // 4), b[text_off:text_off + (text_size // 4) * 4])
for i, w in enumerate(words):
    if (w & 0x9f000000) != 0x90000000:  # ADRP
        continue
    pc = text_off + i * 4
    immlo = (w >> 29) & 3; immhi = (w >> 5) & 0x7ffff
    imm = ((immhi << 2) | immlo)
    if imm & (1 << 20): imm -= 1 << 21
    if (pc & ~0xfff) + (imm << 12) != page: continue
    rd = w & 0x1f
    for j in range(1, 10):   # look for ADD rd, rd, #imm12 nearby
        w2 = words[i + j] if i + j < len(words) else 0
        if (w2 & 0xff800000) == 0x91000000 and (w2 & 0x1f) == rd and ((w2 >> 5) & 0x1f) == rd:
            imm12 = (w2 >> 10) & 0xfff
            if page + imm12 == target:
                hits.append(pc)
            break
for pc in hits:
    a, n = nearest(pc)
    print(f"{pc:#x} in {n} (+{pc - a:#x})")
print(f"{len(hits)} references")
