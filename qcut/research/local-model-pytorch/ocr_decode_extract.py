"""Extract the pinned GeneralOCR class table into ignored local evidence only."""
import argparse
import json
from pathlib import Path
import struct

from ocr_decode_binary import MachO, private_directory, sha256
from ocr_decode_contract import (BINARY_SHA256, DECODER, EVIDENCE_LEVEL, FORMAT, MAPPING_SHA256, PROOF_RANGES,
                                 PROFILE, SOURCE_SHA256, TABLE_SHA256, load_pinned_alphabet, mapping_digest)


TABLE_ADDRESS = 0x2D0BC2C
TABLE_COUNT = 10535


def extract(*, binary_path, source_path, out):
    out = private_directory(path=out)
    if any(out.iterdir()):
        raise ValueError("fresh alphabet output directory required")
    source = Path(source_path).read_bytes()
    binary = MachO(data=Path(binary_path).read_bytes())
    if sha256(data=source) != SOURCE_SHA256 or binary.file_sha256 != BINARY_SHA256:
        raise ValueError("only the reviewed source model and runtime pair is allowed")
    proofs = []
    for name, address, size, expected in PROOF_RANGES:
        code = binary.read(address=address, length=size)
        if sha256(data=code) != expected:
            raise ValueError(f"reviewed code changed: {name}")
        proofs.append({"name": name, "address": address, "bytes": size, "sha256": expected,
                       "instructions": binary.disassemble(address=address, length=size)})
    if (binary.read(address=0x312C1C8, length=1) != b"\0"
            or binary.read(address=0x3170B38, length=2) != b" \0"):
        raise ValueError("blank/space constructor literals changed")
    raw = binary.read(address=TABLE_ADDRESS, length=TABLE_COUNT * 4)
    if sha256(data=raw) != TABLE_SHA256:
        raise ValueError("reviewed Unicode array changed")
    codepoints = struct.unpack(f"<{TABLE_COUNT}I", raw)
    if any(value > 0x10FFFF or 0xD800 <= value <= 0xDFFF for value in codepoints):
        raise ValueError("invalid Unicode scalar")
    tokens = [None, " "] + [chr(value) for value in codepoints]
    if mapping_digest(tokens=tokens) != MAPPING_SHA256:
        raise ValueError("class-order proof mismatch")
    evidence = {"status": EVIDENCE_LEVEL, "source_model": str(Path(source_path).resolve()),
                "source_model_sha256": SOURCE_SHA256, "binary": str(Path(binary_path).resolve()),
                "binary_sha256": BINARY_SHA256, "arm64_slice_offset": binary.slice_offset,
                "arm64_slice_sha256": sha256(data=binary.data), "table_address": TABLE_ADDRESS,
                "table_file_offset": binary.slice_offset + binary.file_offset(address=TABLE_ADDRESS),
                "table_count": TABLE_COUNT, "table_encoding": "uint32-le Unicode scalars",
                "table_sha256": TABLE_SHA256, "mapping_sha256": MAPPING_SHA256, "class_count": len(tokens),
                "mapping_derived_from": "constructor-and-recForward-not-fixture-labels",
                "class_construction": "0=null, 1=space, 2+i=table[i]; duplicate spaces preserved",
                "decoder": DECODER, "proof_ranges": proofs, "native_execution": False,
                "preprocessing_scope": "recForward copies uint8 to FP32; crop/color/engine transforms not yet certified",
                "orientation_scope": "forward time axis only; detector crop and rotation not yet certified"}
    evidence_path = out / "evidence.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=True, indent=2) + "\n")
    metadata = {"format": FORMAT, "profile": PROFILE, "local_only": True, "source_model_sha256": SOURCE_SHA256,
                "class_count": len(tokens), "tokens": tokens, "mapping_sha256": MAPPING_SHA256,
                "decoder": DECODER, "evidence": {"level": EVIDENCE_LEVEL, "file": evidence_path.name,
                                                "sha256": sha256(data=evidence_path.read_bytes())}}
    alphabet_path = out / "alphabet.json"
    alphabet_path.write_text(json.dumps(metadata, ensure_ascii=True, indent=2) + "\n")
    load_pinned_alphabet(path=alphabet_path)
    return {"alphabet": str(alphabet_path), "evidence": str(evidence_path), "classes": len(tokens),
            "mapping_sha256": MAPPING_SHA256, "status": EVIDENCE_LEVEL}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(extract(binary_path=args.binary, source_path=args.source, out=args.out)))


if __name__ == "__main__":
    main()
