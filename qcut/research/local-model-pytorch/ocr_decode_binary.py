"""Read-only, bounded Mach-O evidence for private OCR alphabet research."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct


PRIVATE = (Path(__file__).resolve().parent / "../../.local/jianying-model-pytorch").resolve()


def sha256(*, data):
    return hashlib.sha256(data).hexdigest()


def private_directory(*, path):
    path = Path(path).resolve()
    if not path.is_relative_to(PRIVATE) or path == PRIVATE:
        raise ValueError("private OCR evidence directory required")
    path.mkdir(parents=True, exist_ok=True)
    return path


class MachO:
    def __init__(self, *, data):
        if len(data) < 32 or len(data) > 2 * 1024**3:
            raise ValueError("invalid binary size")
        self.file_sha256 = sha256(data=data)
        self.slice_offset = 0
        if data[:4] == b"\xca\xfe\xba\xbe":
            count = struct.unpack_from(">I", data, 4)[0]
            if not 1 <= count <= 16 or 8 + 20 * count > len(data):
                raise ValueError("invalid fat header")
            slices = [struct.unpack_from(">IIIII", data, 8 + index * 20) for index in range(count)]
            arm = [row for row in slices if row[0] == 0x100000C]
            if len(arm) != 1:
                raise ValueError("one arm64 slice required")
            _, _, offset, size, _ = arm[0]
            if offset < 8 + 20 * count or offset + size > len(data):
                raise ValueError("truncated fat slice")
            self.slice_offset = offset
            data = data[offset:offset + size]
        if data[:4] != b"\xcf\xfa\xed\xfe" or len(data) < 32:
            raise ValueError("little-endian 64-bit Mach-O required")
        _, cpu, _, _, count, command_bytes, _, _ = struct.unpack_from("<8I", data)
        if cpu != 0x100000C or not 1 <= count <= 1024 or 32 + command_bytes > len(data):
            raise ValueError("invalid arm64 commands")
        self.data = data
        self.sections = []
        cursor = 32
        for _ in range(count):
            if cursor + 8 > 32 + command_bytes:
                raise ValueError("truncated load command")
            command, size = struct.unpack_from("<II", data, cursor)
            if size < 8 or cursor + size > 32 + command_bytes:
                raise ValueError("invalid load command size")
            if command == 0x19:
                if size < 72:
                    raise ValueError("truncated segment")
                section_count = struct.unpack_from("<I", data, cursor + 64)[0]
                if 72 + 80 * section_count > size:
                    raise ValueError("truncated sections")
                for index in range(section_count):
                    row = cursor + 72 + 80 * index
                    name, segment, address, length, offset = struct.unpack_from("<16s16sQQI", data, row)
                    flags = struct.unpack_from("<I", data, row + 64)[0]
                    zerofill = flags & 0xFF in (1, 12, 18)
                    if not zerofill and offset + length > len(data):
                        raise ValueError("section outside slice")
                    self.sections.append({"name": name.rstrip(b"\0").decode("ascii"),
                                          "segment": segment.rstrip(b"\0").decode("ascii"),
                                          "address": address, "size": length, "offset": offset,
                                          "zerofill": zerofill})
            cursor += size
        if cursor != 32 + command_bytes:
            raise ValueError("unconsumed load commands")

    def file_offset(self, *, address, length=1):
        for section in self.sections:
            if (not section["zerofill"] and section["address"] <= address
                    and address + length <= section["address"] + section["size"]):
                return section["offset"] + address - section["address"]
        raise ValueError("address outside file-backed sections")

    def read(self, *, address, length):
        if type(length) is not int or length < 1 or length > 4 * 1024**2:
            raise ValueError("bounded positive read required")
        offset = self.file_offset(address=address, length=length)
        return self.data[offset:offset + length]

    def disassemble(self, *, address, length):
        import capstone

        if address % 4 or length % 4 or length > 65536:
            raise ValueError("aligned bounded disassembly required")
        engine = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
        return [f"{item.address:#x}: {item.mnemonic} {item.op_str}"
                for item in engine.disasm(self.read(address=address, length=length), address)]

    def xrefs(self, *, target):
        section = next(item for item in self.sections if item["name"] == "__text")
        data = memoryview(self.data)[section["offset"]:section["offset"] + section["size"]]
        words = memoryview(data).cast("I")
        target_page = target & ~0xFFF
        refs = []
        for index, word in enumerate(words):
            if word & 0x9F000000 != 0x90000000:
                continue
            address = section["address"] + 4 * index
            immediate = ((word >> 5 & 0x7FFFF) << 2) | (word >> 29 & 3)
            if immediate & (1 << 20):
                immediate -= 1 << 21
            if (address & ~0xFFF) + (immediate << 12) != target_page:
                continue
            register = word & 31
            for distance in range(1, min(9, len(words) - index)):
                other = words[index + distance]
                if other & 0xFFC00000 == 0x91000000 and other >> 5 & 31 == register:
                    if target_page + (other >> 10 & 0xFFF) == target:
                        refs.append({"adrp": address, "add": address + 4 * distance})
                    break
        return refs

    def strings(self, *, pattern):
        expression = re.compile(pattern, re.IGNORECASE)
        results = []
        for section in self.sections:
            if section["name"] != "__cstring":
                continue
            start = section["offset"]
            for match in re.finditer(rb"[^\x00]{3,}", self.data[start:start + section["size"]]):
                try:
                    value = match.group().decode("utf-8")
                except UnicodeDecodeError:
                    continue
                if expression.search(value):
                    results.append({"address": section["address"] + match.start(), "text": value})
        return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--pattern", default="GeneralOCR|OCRFunction|general_ocr|tt_general_ocr")
    parser.add_argument("--address", type=lambda value: int(value, 0))
    parser.add_argument("--length", type=lambda value: int(value, 0), default=512)
    parser.add_argument("--xref", type=lambda value: int(value, 0))
    args = parser.parse_args()
    directory = private_directory(path=args.out.parent)
    target = directory / args.out.name
    if target.exists():
        raise ValueError("fresh output required")
    binary = MachO(data=args.binary.read_bytes())
    result = {"binary": str(args.binary.resolve()), "sha256": binary.file_sha256,
              "slice_offset": binary.slice_offset, "slice_sha256": sha256(data=binary.data),
              "sections": binary.sections}
    if args.address is not None:
        result["disassembly"] = binary.disassemble(address=args.address, length=args.length)
    elif args.xref is not None:
        result["xrefs"] = binary.xrefs(target=args.xref)
    else:
        result["strings"] = binary.strings(pattern=args.pattern)
    target.write_text(json.dumps(result, ensure_ascii=True, indent=2) + "\n")
    print(json.dumps({"report": str(target), "sha256": binary.file_sha256,
                      "results": result.get("xrefs", result.get("disassembly", result.get("strings")))}))


if __name__ == "__main__":
    main()
