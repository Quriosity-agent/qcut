"""Scan all five verified manifests; keep extracted candidates strictly private."""
import argparse
from collections import Counter
import hashlib
import json
import pathlib
import re
import struct

from inventory import manifest_sources
from model_containers import MAX_BYTES, bounded, bytenn_sections, extract_candidates, inspect_container

PRIVATE_ROOT = pathlib.Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
RUNTIME_SHA256 = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0"


def runtime_graph_table(*, path):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != RUNTIME_SHA256:
        raise ValueError("unknown native runtime: refusing fixed graph-table address")
    if data[:4] != b"\xca\xfe\xba\xbe":
        raise ValueError("expected audited fat Mach-O")
    count = struct.unpack_from(">I", data, 4)[0]
    if not 1 <= count <= 16:
        raise ValueError("invalid architecture count")
    architecture = None
    for index in range(count):
        cpu, _, start, size, _ = struct.unpack(">5I", bounded(data=data, offset=8 + 20 * index, size=20))
        if cpu == 0x100000C:
            architecture = bounded(data=data, offset=start, size=size)
    if architecture is None or architecture[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError("missing arm64 Mach-O")
    commands, command_bytes = struct.unpack_from("<II", architecture, 16)
    bounded(data=architecture, offset=32, size=command_bytes)
    cursor, address = 32, 0x3B0E50
    for _ in range(commands):
        command, size = struct.unpack("<II", bounded(data=architecture, offset=cursor, size=8))
        if size < 8 or cursor + size > 32 + command_bytes:
            raise ValueError("invalid Mach-O load command")
        if command == 0x19 and size >= 72:
            vm, _, file_start, file_size = struct.unpack_from("<4Q", architecture, cursor + 24)
            if vm <= address and address + 256 <= vm + file_size:
                table = bounded(data=architecture, offset=file_start + address - vm, size=256)
                if len(set(table)) != 256:
                    raise ValueError("native graph table is not a byte permutation")
                return table
        cursor += size
    raise ValueError("native graph table outside backed segments")


def decode_graph(*, data, offset, table):
    model = bytenn_sections(data=data, offset=offset)
    if len(table) != 256 or len(set(table)) != 256:
        raise ValueError("invalid graph byte permutation")
    graph = model["sections"][0]
    model_data = bounded(data=data, offset=offset, size=model["bytes"])
    key_start = struct.unpack_from("<I", model_data, 32)[0]
    key = bounded(data=model_data, offset=key_start, size=8)
    payload = bounded(data=data, offset=graph["offset"], size=graph["bytes"])
    decoded = bytes(table[value ^ key[index % 8]] for index, value in enumerate(payload))
    text = decoded.rstrip(b"\0").decode("ascii")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        raise ValueError("decoded graph contains control bytes")
    rows = [line.removesuffix("\\n").split() for line in text.splitlines() if line.strip()]
    prefixes = []
    while rows and rows[0] in (["B"], ["D"], ["E"]):
        marker = rows.pop(0)[0]
        if marker in prefixes:
            raise ValueError("duplicate graph prefix")
        prefixes.append(marker)
    if not rows or len(rows[0]) != 3 or not all(item.isdecimal() for item in rows[0]):
        raise ValueError("unknown plaintext graph header")
    input_count, layer_count, _ = map(int, rows.pop(0))
    if not 0 < input_count <= 64 or not 0 < layer_count <= 4096:
        raise ValueError("invalid plaintext graph counts")
    if len(rows) != input_count + layer_count or sum(row[0] == "DataV2" for row in rows) != input_count:
        raise ValueError("plaintext graph layer count mismatch")
    if any(len(row) < 2 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", row[0]) for row in rows):
        raise ValueError("invalid plaintext graph row")
    return text, {"status": "decoded-counts-validated", "input_count": input_count,
                  "layer_count": layer_count, "prefixes": prefixes,
                  "operator_counts": dict(Counter(row[0] for row in rows)),
                  "graph_status": "connections-and-operator-semantics-unverified",
                  "inference_verified": False,
                  "sha256": hashlib.sha256(text.encode()).hexdigest()}


def summarize_records(*, records):
    return {"manifest_records": len(records),
            "unique_assets": sum(item["status"] == "inspected" for item in records),
            "duplicates": sum(item["status"] == "duplicate" for item in records),
            "skipped": sum(item["status"] == "size-limit" for item in records)}


def scan(*, runtime_root, out, extract, graph_runtime=None):
    target = out.resolve()
    if not target.is_relative_to(PRIVATE_ROOT.resolve()) or target == PRIVATE_ROOT.resolve():
        raise ValueError("report must stay beneath .local/jianying-model-pytorch/")
    target.mkdir(parents=True, exist_ok=True)
    table = runtime_graph_table(path=graph_runtime) if graph_runtime is not None else None
    records, seen = [], {}
    for source in manifest_sources(root=runtime_root):
        if source.stat().st_size > MAX_BYTES:
            records.append({"source": str(source), "status": "size-limit"})
            continue
        data = source.read_bytes()
        result = inspect_container(data=data)
        digest = result["sha256"]
        if digest in seen:
            records.append({"source": str(source), "sha256": digest, "status": "duplicate",
                            "duplicate_of": seen[digest], "classification": result["classification"]})
            continue
        seen[digest] = str(source)
        result.update(source=str(source), status="inspected")
        if extract:
            result["extracted"] = extract_candidates(data=data, result=result,
                                                     out=target / digest, private_root=PRIVATE_ROOT)
        if table is not None:
            graph_results = []
            directory = target / digest
            if not directory.resolve().is_relative_to(PRIVATE_ROOT.resolve()):
                raise ValueError("graph directory escapes private output")
            directory.mkdir(exist_ok=True)
            for candidate in result["findings"]:
                if candidate["kind"] != "bytenn-bm":
                    continue
                offset = candidate["offset"]
                try:
                    graph, details = decode_graph(data=data, offset=offset, table=table)
                    destination = directory / f"{offset:08x}-bytenn-graph.private.txt"
                    if destination.is_symlink():
                        raise ValueError("refusing graph output symlink")
                    destination.write_text(graph)
                    graph_results.append({"offset": offset, "path": str(destination), **details})
                except (ValueError, UnicodeDecodeError) as error:
                    graph_results.append({"offset": offset, "status": "decode-rejected", "reason": str(error)})
            result["graph_recovery"] = graph_results
        records.append(result)
    unique = [item for item in records if item["status"] == "inspected"]
    report = {"format": "qcut-private-container-scan", "format_version": 1,
              **summarize_records(records=records),
              "classifications": dict(Counter(item["classification"]["category"] for item in unique)),
              "findings_by_kind": dict(Counter(f["kind"] for r in unique for f in r["findings"])),
              "evidence_levels": dict(Counter(f["evidence"] for r in unique for f in r["findings"])),
              "new_verified_networks": 0, "inference_performed": False,
              "graph_recovery": dict(Counter(g["status"] for r in unique for g in r.get("graph_recovery", []))),
              "graph_runtime_sha256": RUNTIME_SHA256 if table is not None else None,
              "records": records}
    destination = target / "report.json"
    if destination.is_symlink():
        raise ValueError("refusing report symlink")
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    classified = target / "classifications.json"
    if classified.is_symlink():
        raise ValueError("refusing classification report symlink")
    classified.write_text(json.dumps([{key: item[key] for key in
                                      ("source", "sha256", "status", "classification") if key in item}
                                     for item in records], indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", type=pathlib.Path,
                        default=pathlib.Path.home() / "Library/Application Support/QCut/PrivateRuntimes")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--graph-runtime", type=pathlib.Path,
                        help="Audited local libbytenn.dylib; recover graph text only, never execute networks")
    args = parser.parse_args()
    report = scan(runtime_root=args.runtime_root, out=args.out, extract=args.extract, graph_runtime=args.graph_runtime)
    print(json.dumps({key: value for key, value in report.items() if key != "records"}, indent=2))


if __name__ == "__main__":
    main()
