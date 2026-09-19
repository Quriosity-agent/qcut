"""Bounded, non-executing inspection of locally owned binary model containers."""
import hashlib
import io
import json
import pathlib
import re
import struct
import zipfile

MAX_BYTES = 256 * 1024 * 1024
MAX_RECORDS = 4096
MAX_HITS = 128


def u32(*, data, offset):
    if offset < 0 or offset + 4 > len(data):
        raise ValueError("u32 outside container")
    return struct.unpack_from("<I", data, offset)[0]


def bounded(*, data, offset, size):
    if offset < 0 or size < 0 or offset > len(data) or size > len(data) - offset:
        raise ValueError("payload outside container")
    return data[offset:offset + size]


def record(*, kind, offset, size, evidence, **details):
    return {"kind": kind, "offset": offset, "bytes": size,
            "evidence": evidence, "graph_status": "unknown", **details}


def bytenn_sections(*, data, offset):
    header = bounded(data=data, offset=offset, size=12)
    if header[:3] != b"BM\0" or header[3] not in (2, 3, 4, 5):
        raise ValueError("not an observed BM version")
    size, count = struct.unpack_from("<II", header, 4)
    model = bounded(data=data, offset=offset, size=size)
    table_end = 12 + count * 8
    if not 3 <= count <= 32 or table_end > size:
        raise ValueError("invalid BM section count")
    sections = []
    cursor = table_end
    opaque = []
    for index in range(count):
        length, start = struct.unpack_from("<II", model, 12 + index * 8)
        # Observed v2 third words can be opaque rather than a byte length.
        if header[3] == 2 and count == 3 and index == 2 and length > size - min(start, size):
            if start != cursor or start != size - 8:
                raise ValueError("unbounded BM v2 opaque trailer")
            opaque.append({"index": index, "offset": start, "bytes": 8,
                           "uninterpreted_descriptor": length})
            cursor = size
            continue
        if start != cursor or length > size - cursor:
            raise ValueError("noncontiguous or out-of-bounds BM section")
        sections.append({"index": index, "offset": offset + start, "bytes": length})
        cursor += length
    trailer = size - cursor
    if trailer not in (0, 8, 16):
        raise ValueError("unrecognized BM trailing region")
    return record(kind="bytenn-bm", offset=offset, size=size,
                  evidence="bounded-container-partial" if opaque else "bounded-container",
                  version=header[3], sections=sections, opaque_sections=opaque,
                  trailer_bytes=trailer, section_semantics="unverified")


def fixed_name(*, data):
    name, separator, padding = data.partition(b"\0")
    if not name or not separator or any(padding) or any(c < 32 or c > 126 for c in name):
        raise ValueError("invalid fixed-width name")
    return name.decode("ascii")


def named_records(*, data):
    if len(data) < 44 or u32(data=data, offset=0) != len(data):
        raise ValueError("length-prefixed container size mismatch")
    if u32(data=data, offset=4) != 3 or any(data[8:36]):
        raise ValueError("not observed named-record version")
    count = u32(data=data, offset=36)
    if not 1 <= count <= MAX_RECORDS:
        raise ValueError("invalid named group count")
    cursor = 40 + count * 4
    bounded(data=data, offset=0, size=cursor)
    groups, leaves = [], []
    for index in range(count):
        size = u32(data=data, offset=40 + index * 4)
        group = bounded(data=data, offset=cursor, size=size)
        if len(group) < 296 or any(group[260:288]):
            raise ValueError("invalid named group header")
        name = fixed_name(data=group[:256])
        children = u32(data=group, offset=288)
        if not 1 <= children <= MAX_RECORDS or len(leaves) + children > MAX_RECORDS:
            raise ValueError("invalid named child count")
        child_cursor = 292 + 4 * children
        bounded(data=group, offset=0, size=child_cursor)
        for child in range(children):
            child_size = u32(data=group, offset=292 + child * 4)
            payload = bounded(data=group, offset=child_cursor, size=child_size)
            if len(payload) < 296 or any(payload[260:288]):
                raise ValueError("invalid named leaf header")
            leaf_name = fixed_name(data=payload[:256])
            payload_size = u32(data=payload, offset=292)
            if payload_size != child_size - 296:
                raise ValueError("named leaf payload length mismatch")
            kind = "opaque-data"
            body = payload[296:]
            if leaf_name.endswith((".js", ".lua")) and text_value(data=body) is not None:
                kind = "script-text"
            elif json_value(data=body) is not None:
                kind = "json-data"
            leaves.append(record(kind=kind, offset=cursor + child_cursor + 296,
                                 size=payload_size, evidence="length-table-validated",
                                 group=name, name=leaf_name,
                                 storage_type=u32(data=payload, offset=288),
                                 flags=u32(data=payload, offset=256)))
            child_cursor += child_size
        if child_cursor != size:
            raise ValueError("named group has unexplained trailing bytes")
        groups.append({"name": name, "offset": cursor, "bytes": size, "children": children})
        cursor += size
    if cursor != len(data):
        raise ValueError("named container has unexplained trailing bytes")
    return record(kind="named-records-v3", offset=0, size=len(data),
                  evidence="bounded-container", groups=groups, records=leaves)


def text_value(*, data):
    if len(data) > 4 * 1024 * 1024 or b"\0" in data:
        return None
    try:
        value = data.decode("utf-8")
        if any(ord(c) < 32 and c not in "\r\n\t" for c in value):
            return None
        return value
    except UnicodeDecodeError:
        return None


def json_value(*, data):
    if not data.lstrip().startswith((b"{", b"[")):
        return None
    text = text_value(data=data)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (ValueError, RecursionError):
        return None


def flatbuffer_table(*, data, offset):
    bounded(data=data, offset=offset, size=4)
    back = struct.unpack_from("<i", data, offset)[0]
    vtable = offset - back
    head = bounded(data=data, offset=vtable, size=4)
    vsize, osize = struct.unpack("<HH", head)
    if vsize < 4 or vsize % 2 or osize < 4:
        raise ValueError("invalid FlatBuffer table dimensions")
    fields = bounded(data=data, offset=vtable + 4, size=vsize - 4)
    bounded(data=data, offset=offset, size=osize)
    result = []
    for (value,) in struct.iter_unpack("<H", fields):
        if value and not 4 <= value < osize:
            raise ValueError("FlatBuffer field outside object")
        result.append(offset + value if value else None)
    return result


def tflite_candidate(*, data, offset):
    model = data[offset:]
    if len(model) < 8 or model[4:8] != b"TFL3":
        raise ValueError("not TFL3")
    root = u32(data=model, offset=0)
    if root < 8 or root % 4:
        raise ValueError("invalid FlatBuffer root")
    fields = flatbuffer_table(data=model, offset=root)
    if len(fields) < 5 or fields[0] is None or u32(data=model, offset=fields[0]) != 3:
        raise ValueError("invalid TFLite version")
    lengths = {}
    for field, label in ((1, "operator_codes"), (2, "subgraphs"), (4, "buffers")):
        if fields[field] is None:
            raise ValueError("missing TFLite vector")
        vector = fields[field] + u32(data=model, offset=fields[field])
        count = u32(data=model, offset=vector)
        if count > MAX_RECORDS or (field != 1 and count == 0):
            raise ValueError("invalid TFLite vector count")
        bounded(data=model, offset=vector + 4, size=count * 4)
        for index in range(count):
            slot = vector + 4 + index * 4
            relative = u32(data=model, offset=slot)
            if relative < 4:
                raise ValueError("invalid FlatBuffer vector reference")
            flatbuffer_table(data=model, offset=slot + relative)
        lengths[label] = count
    return record(kind="tflite", offset=offset, size=len(model), evidence="schema-candidate",
                  graph_status="schema-partial-inference-unverified", vectors=lengths,
                  end_boundary="containing-region-end")


def protobuf_fields(*, data):
    def varint(*, offset):
        value = 0
        for index in range(10):
            if offset >= len(data):
                raise ValueError("truncated protobuf varint")
            byte = data[offset]
            offset += 1
            if index == 9 and byte > 1:
                raise ValueError("overflow protobuf varint")
            value |= (byte & 127) << (7 * index)
            if byte < 128:
                return value, offset
        raise ValueError("oversized protobuf varint")

    cursor, fields = 0, []
    while cursor < len(data):
        key, cursor = varint(offset=cursor)
        number, wire = key >> 3, key & 7
        if number == 0 or number >= 1 << 29 or len(fields) >= MAX_RECORDS:
            raise ValueError("invalid protobuf field")
        if wire == 0:
            value, cursor = varint(offset=cursor)
        elif wire in (1, 2, 5):
            size = 8 if wire == 1 else 4
            if wire == 2:
                size, cursor = varint(offset=cursor)
            bounded(data=data, offset=cursor, size=size)
            value = (cursor, size)
            cursor += size
        else:
            raise ValueError("unsupported protobuf wire type")
        fields.append((number, wire, value))
    return fields


def protobuf_candidate(*, data, offset):
    fields = protobuf_fields(data=data)
    if not fields:
        raise ValueError("empty protobuf")
    kind = "protobuf-wire"
    versions = [v for n, w, v in fields if n == 1 and w == 0]
    graphs = [v for n, w, v in fields if n == 7 and w == 2]
    if len(versions) == 1 and 1 <= versions[0] <= 100 and len(graphs) == 1:
        start, size = graphs[0]
        graph_fields = protobuf_fields(data=bounded(data=data, offset=start, size=size))
        if all(any(n == k and w == 2 for n, w, _ in graph_fields) for k in (1, 11, 12)):
            kind = "onnx"
    return record(kind=kind, offset=offset, size=len(data), evidence="schema-candidate",
                  field_count=len(fields), graph_status="schema-unverified")


def zip_container(*, data):
    members = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= MAX_RECORDS:
            raise ValueError("invalid ZIP member count")
        total, names = 0, set()
        for entry in entries:
            name = pathlib.PurePosixPath(entry.filename)
            if (name.is_absolute() or ".." in name.parts or "\\" in entry.filename
                    or entry.filename in names or (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("unsafe ZIP member")
            names.add(entry.filename)
            total += entry.file_size
            if total > MAX_BYTES or entry.flag_bits & 1:
                raise ValueError("oversized or encrypted ZIP member")
            bounded(data=data, offset=entry.header_offset, size=30 + entry.compress_size)
            if data[entry.header_offset:entry.header_offset + 4] != b"PK\x03\x04":
                raise ValueError("ZIP local header mismatch")
            with archive.open(entry) as stream:
                actual = 0
                while chunk := stream.read(1024 * 1024):
                    actual += len(chunk)
                    if actual > entry.file_size:
                        raise ValueError("ZIP expanded size mismatch")
            if actual != entry.file_size:
                raise ValueError("ZIP truncated member")
            members.append({"name": entry.filename, "bytes": entry.file_size})
        start = min(entry.header_offset for entry in entries)
    return record(kind="zip", offset=start, size=len(data) - start,
                  evidence="archive-crc-validated", members=members,
                  espresso_graphs=sum(item["name"].endswith(".espresso.net") for item in members))


def inspect_container(*, data):
    if len(data) > MAX_BYTES:
        raise ValueError("container exceeds size limit")
    findings, rejected = [], []
    if len(data) >= 44 and u32(data=data, offset=0) == len(data) and data[4:8] == b"\x03\0\0\0":
        try:
            findings.append(named_records(data=data))
        except ValueError as error:
            rejected.append({"kind": "named-records-v3", "offset": 0, "reason": str(error)})
    if len(data) >= 28 and data.startswith(b"SAMI"):
        declared = struct.unpack_from("<Q", data, 20)[0]
        if data[4:16] == struct.pack("<III", 12, 2, 1) and 0 < declared <= len(data) - 28:
            findings.append(record(kind="sami", offset=0, size=len(data), evidence="header-validated",
                                   payload_offset=28, payload_bytes=declared,
                                   trailing_bytes=len(data) - 28 - declared))
    if len(data) >= 28 and u32(data=data, offset=16) == len(data):
        version = bytes((data[i] + data[i + 8]) % 256 for i in range(8))
        if version in (b"v2\0\0\0\0\0\0", b"v3\0\0\0\0\0\0"):
            length = u32(data=data, offset=20)
            if 0 < length <= 1024 and 24 + length + 4 <= len(data):
                name = data[24:24 + length].rstrip(b"\0")
                if name and all(32 <= c <= 126 for c in name):
                    findings.append(record(kind="versioned-model-wrapper", offset=0, size=len(data),
                                           evidence="header-validated", version=version[:2].decode(),
                                           name=name.decode(), records_count=u32(data=data, offset=24 + length)))
    signatures = ((rb"BM\x00[\x02-\x05]", "bytenn-bm", bytenn_sections, 0),
                  (rb"TFL3", "tflite", tflite_candidate, -4))
    for pattern, kind, parser, adjust in signatures:
        for index, match in enumerate(re.finditer(pattern, data)):
            if index >= MAX_HITS:
                rejected.append({"kind": kind, "reason": "signature hit limit reached"})
                break
            offset = match.start() + adjust
            try:
                if offset < 0:
                    raise ValueError("signature lacks root offset")
                containing_ends = [leaf["offset"] + leaf["bytes"] for f in findings
                                   for leaf in f.get("records", [])
                                   if leaf["offset"] <= offset < leaf["offset"] + leaf["bytes"]]
                end = min(containing_ends, default=len(data))
                findings.append(parser(data=data[:end], offset=offset))
            except (ValueError, struct.error) as error:
                rejected.append({"kind": kind, "offset": offset, "reason": str(error)})
    if b"PK\x05\x06" in data[-65557:]:
        try:
            findings.append(zip_container(data=data))
        except (ValueError, zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError) as error:
            rejected.append({"kind": "zip", "reason": str(error)})
    regions = [{"offset": 0, "bytes": len(data)}]
    for finding in findings:
        regions.extend(finding.get("records", []))
        if finding["kind"] == "bytenn-bm":
            regions.extend(finding["sections"][:1])
    for region in regions[:MAX_RECORDS]:
        offset, size = region["offset"], region["bytes"]
        payload = data[offset:offset + size]
        value = json_value(data=payload)
        if value is not None:
            findings.append(record(kind="json-data", offset=offset, size=size, evidence="syntax-validated",
                                   graph_status="not-established", root_type=type(value).__name__))
        if payload[:1] in (b"\x08", b"\x0a", b"\x12") and size > 16:
            try:
                findings.append(protobuf_candidate(data=payload, offset=offset))
            except ValueError:
                pass
        if payload.startswith(b"7767517\n"):
            text = text_value(data=payload)
            lines = text.splitlines() if text is not None else []
            if len(lines) > 2 and re.fullmatch(r"\d+\s+\d+", lines[1].strip()):
                layers, blobs = map(int, lines[1].split())
                if 0 < layers <= MAX_RECORDS and 0 < blobs <= MAX_RECORDS and len(lines) == layers + 2:
                    findings.append(record(kind="ncnn-param", offset=offset, size=size,
                                           evidence="schema-candidate", layers=layers, blobs=blobs))
    unique = {(f["kind"], f["offset"], f["bytes"]): f for f in findings}
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "findings": list(unique.values()), "rejected": rejected,
            "classification": classify_findings(findings=list(unique.values())),
            "new_verified_networks": 0, "inference_performed": False}


def classify_findings(*, findings):
    kinds = {item["kind"] for item in findings}
    leaves = [leaf for finding in findings for leaf in finding.get("records", [])]
    scripts = sum(item["kind"] == "script-text" for item in leaves)
    opaque = sum(item["kind"] == "opaque-data" and item["bytes"] > 64 for item in leaves)
    neural = sum(item["kind"] == "bytenn-bm" for item in findings)
    espresso = sum(item.get("espresso_graphs", 0) for item in findings)
    if neural or espresso:
        category = "neural-container-with-scripts" if scripts else "neural-container"
    elif scripts and not opaque:
        category = "scripts-and-small-data"
    elif scripts:
        category = "scripts-with-opaque-data"
    elif "sami" in kinds:
        category = "audio-container-opaque-payload"
    elif "versioned-model-wrapper" in kinds or "named-records-v3" in kinds:
        category = "structured-container-opaque-payload"
    elif kinds & {"tflite", "onnx", "ncnn-param"}:
        category = "portable-graph-candidate"
    elif "json-data" in kinds:
        category = "structured-data-role-unknown"
    else:
        category = "unknown-binary-or-data"
    return {"category": category, "bytenn_containers": neural, "espresso_graphs": espresso,
            "script_records": scripts, "opaque_records_over_64_bytes": opaque,
            "new_verified_networks": 0,
            "unknown_is_not_non_neural": True,
            "counts_are_payloads_not_distinct_networks": True}


def extract_candidates(*, data, result, out, private_root):
    root, target = pathlib.Path(private_root).resolve(), pathlib.Path(out).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError("extraction must stay beneath the private output root")
    target.mkdir(parents=True, exist_ok=True)
    extracted = []
    candidates = list(result["findings"])
    for finding in result["findings"]:
        candidates.extend(finding.get("records", []))
    seen, total = set(), 0
    for item in candidates:
        key = item["offset"], item["bytes"]
        if key in seen or item["kind"] in {"named-records-v3", "versioned-model-wrapper", "sami"}:
            continue
        seen.add(key)
        payload = bounded(data=data, offset=item["offset"], size=item["bytes"])
        total += len(payload)
        if total > MAX_BYTES * 2:
            raise ValueError("extraction byte budget exceeded")
        name = f"{item['offset']:08x}-{item['kind']}.bin"
        destination = target / name
        if destination.is_symlink():
            raise ValueError("refusing output symlink")
        digest = hashlib.sha256(payload).hexdigest()
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                raise ValueError("refusing to replace a different extracted payload")
        else:
            with destination.open("xb") as stream:
                stream.write(payload)
        extracted.append({"path": str(destination), "sha256": digest,
                          "kind": item["kind"], "bytes": len(payload),
                          "evidence": item["evidence"], "inference_verified": False})
    return extracted
