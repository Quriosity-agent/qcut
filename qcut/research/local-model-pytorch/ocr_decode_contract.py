"""Evidence-gated alphabet manifests; a matching class count is insufficient."""
import hashlib
import json
from pathlib import Path
import re

from ocr_decode_ctc import Alphabet


FORMAT = "qcut-private-ocr-alphabet-v1"
PROFILE = "general-ocr-rec-v2.4-10537-libcccreator-arm64-v1"
SOURCE_SHA256 = "d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac"
MAPPING_SHA256 = "707fc0b30801d75498382950d6760deab10bd8e4c98db11cbff5811b58e5bebb"
BINARY_SHA256 = "b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4"
TABLE_SHA256 = "c69f43d50fbe0d84e41185626703e7596cd734f1c4a6d89ea1734597a5db81e3"
DECODER = {"algorithm": "greedy-ctc", "merge_repeated": True, "blank_id": 0,
           "normalization": "none", "time_direction": "forward", "tie_break": "first-index"}
EVIDENCE_LEVEL = "binary-callsite-pinned"
MAX_JSON = 2 * 1024**2
PROOF_RANGES = (
    ("alphabet-constructor", 0xD46470, 0xB8, "57f3ee0c27290c14139331dc5a873a20ca69891ec81bce2cb12db4a4a995cffc"),
    ("argmax-and-ctc", 0xD45818, 0xD0, "cd5111f4e0af5a228cb86fa4b2efa3e36dd3d248d6acf63d39c363ee234ddae4"),
    ("byte-to-float-input", 0xD456A8, 0x170, "de3af9d122413e63e35d8ef0d2fef91c9346d71f1d30fdbf5d34029087d5636e"),
    ("first-index-max-element", 0xBD84DC, 0x34, "776cb339144a14dcf43ae36620aa7b6b73086ab4db0701dd1159e2479123e7b0"),
    ("algorithm-constructor-model-name", 0xD437D4, 0x134, "ef419446589b8c94e8e75dc5436ae5c1eb3d4265adb0cc283790c53ac160cfd4"),
    ("constructor-link", 0xD44A80, 0x18, "0831dd87384cc67f3711f98ceb7fc62cc513a053c8556fd9a450309ed80b797a"),
    ("recForward-call", 0xD444B0, 0x20, "0e97a143c72c956d30dccbece55d65108a7d5fede46bdb7bfe6b8362d077e0df"),
)


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def mapping_digest(*, tokens):
    return digest(data=json.dumps(tokens, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode())


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"non-finite JSON constant: {value}")


def read_json(*, path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= MAX_JSON:
        raise ValueError("bounded regular JSON file required")
    data = path.read_bytes()
    if len(data) > MAX_JSON:
        raise ValueError("JSON grew beyond limit")
    value = json.loads(data, object_pairs_hook=unique_pairs, parse_constant=reject_constant)
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value, digest(data=data)


def validate_manifest(*, metadata, expected_source_sha256, expected_mapping_sha256):
    required = {"format", "profile", "local_only", "source_model_sha256", "class_count", "tokens",
                "mapping_sha256", "decoder", "evidence"}
    if not isinstance(metadata, dict) or set(metadata) != required:
        raise ValueError("exact alphabet schema required")
    for value in (expected_source_sha256, expected_mapping_sha256):
        if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value):
            raise ValueError("caller must pin source and mapping SHA256")
    if (metadata["format"] != FORMAT or metadata["local_only"] is not True
            or not isinstance(metadata["profile"], str) or not metadata["profile"]
            or metadata["source_model_sha256"] != expected_source_sha256
            or metadata["mapping_sha256"] != expected_mapping_sha256):
        raise ValueError("unrecognized or mismatched alphabet provenance")
    tokens = metadata["tokens"]
    decoder = metadata["decoder"]
    if (not isinstance(tokens, list) or not 2 <= len(tokens) <= 16384 or type(metadata["class_count"]) is not int
            or len(tokens) != metadata["class_count"] or mapping_digest(tokens=tokens) != expected_mapping_sha256):
        raise ValueError("alphabet class table or hash mismatch")
    if (not isinstance(decoder, dict) or set(decoder) != set(DECODER)
            or type(decoder["blank_id"]) is not int or decoder["merge_repeated"] is not True
            or any(decoder[key] != DECODER[key] for key in DECODER if key != "blank_id")):
        raise ValueError("unsupported decoder semantics")
    evidence = metadata["evidence"]
    if (not isinstance(evidence, dict) or set(evidence) != {"level", "file", "sha256"}
            or evidence["level"] != EVIDENCE_LEVEL
            or not isinstance(evidence["file"], str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]+\.json", evidence["file"])
            or not isinstance(evidence["sha256"], str) or not re.fullmatch("[0-9a-f]{64}", evidence["sha256"])):
        raise ValueError("pinned adjacent evidence is mandatory")
    return Alphabet(tokens=tuple(tokens), blank_id=decoder["blank_id"])


def load_pinned_alphabet(*, path):
    metadata, _ = read_json(path=path)
    alphabet = validate_manifest(metadata=metadata, expected_source_sha256=SOURCE_SHA256,
                                 expected_mapping_sha256=MAPPING_SHA256)
    evidence, sha = read_json(path=Path(path).parent / metadata["evidence"]["file"])
    if (sha != metadata["evidence"]["sha256"] or metadata["profile"] != PROFILE
            or len(alphabet.tokens) != 10537 or alphabet.blank_id != 0
            or evidence.get("status") != EVIDENCE_LEVEL or evidence.get("source_model_sha256") != SOURCE_SHA256
            or evidence.get("binary_sha256") != BINARY_SHA256 or evidence.get("table_sha256") != TABLE_SHA256
            or evidence.get("mapping_sha256") != MAPPING_SHA256
            or evidence.get("class_count") != 10537 or evidence.get("table_count") != 10535
            or evidence.get("table_encoding") != "uint32-le Unicode scalars"
            or evidence.get("table_address") != 0x2D0BC2C
            or evidence.get("mapping_derived_from") != "constructor-and-recForward-not-fixture-labels"
            or evidence.get("decoder") != DECODER):
        raise ValueError("unproven recognizer alphabet or decoder")
    check_proof_ranges(proofs=evidence.get("proof_ranges"))
    return alphabet, metadata, evidence


def check_proof_ranges(*, proofs):
    if not isinstance(proofs, list) or len(proofs) != len(PROOF_RANGES):
        raise ValueError("complete reviewed callsite evidence required")
    for row, (name, address, size, expected_sha) in zip(proofs, PROOF_RANGES, strict=True):
        if (not isinstance(row, dict) or row.get("name") != name or row.get("address") != address
                or type(row.get("address")) is not int or row.get("bytes") != size
                or type(row.get("bytes")) is not int or row.get("sha256") != expected_sha
                or not isinstance(row.get("instructions"), list) or len(row["instructions"]) != size // 4
                or not all(isinstance(instruction, str) and 1 <= len(instruction) <= 256
                           for instruction in row["instructions"])):
            raise ValueError("reviewed callsite proof changed or incomplete")
