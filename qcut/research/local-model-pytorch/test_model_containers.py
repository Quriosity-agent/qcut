"""Synthetic-only fixtures: no vendor graph, script, tensor or weight data."""
import io
import pathlib
import struct
import tempfile
import unittest
import zipfile

from model_containers import (
    bounded, bytenn_sections, extract_candidates, inspect_container,
    named_records, protobuf_fields, tflite_candidate, zip_container,
)
from container_scan import decode_graph, runtime_graph_table, summarize_records


def bm(*, version=4, partial=False):
    first, weights = b"opaque-graph", b"\0" * 16
    count = 3
    start = 12 + count * 8
    size = start + len(first) + len(weights) + 8
    table = struct.pack("<6I", len(first), start, len(weights), start + len(first),
                        123456 if partial else 0, size - 8)
    return b"BM\0" + bytes([version]) + struct.pack("<II", size, count) + table + first + weights + bytes(8)


def leaf(*, name, payload):
    encoded = name.encode()
    return encoded + bytes(256 - len(encoded)) + bytes(36) + struct.pack("<I", len(payload)) + payload


def named(*, leaves):
    children = b"".join(leaves)
    group = b"script" + bytes(250) + struct.pack("<I", 3) + bytes(28)
    group += struct.pack("<I", len(leaves)) + b"".join(struct.pack("<I", len(x)) for x in leaves) + children
    return struct.pack("<II", len(group) + 44, 3) + bytes(28) + struct.pack("<II", 1, len(group)) + group


def tflite():
    data = bytearray(152)
    struct.pack_into("<I4s", data, 0, 32, b"TFL3")
    struct.pack_into("<7H", data, 12, 14, 24, 4, 8, 12, 0, 20)
    struct.pack_into("<iI", data, 32, 20, 3)
    for field, vector, obj in ((40, 60, 116), (44, 72, 132), (52, 84, 148)):
        struct.pack_into("<I", data, field, vector - field)
        struct.pack_into("<II", data, vector, 1, obj - (vector + 4))
        struct.pack_into("<HH", data, obj - 4, 4, 4)
        struct.pack_into("<i", data, obj, 4)
    return bytes(data)


class ContainerTests(unittest.TestCase):
    def test_skipped_records_are_not_duplicates(self):
        records = [{"status": status} for status in ("inspected", "size-limit", "duplicate", "inspected")]
        self.assertEqual(summarize_records(records=records), {
            "manifest_records": 4, "unique_assets": 2, "duplicates": 1, "skipped": 1})

    def test_graph_decode_is_not_inference_proof(self):
        graph = b"D\\n\n1 1 123\\n\nDataV2 synthetic 1 1 1 2 4 0 0\\n\nRelu r synthetic r\\n\n\0"
        size = 36 + len(graph) + 8
        data = b"BM\0\4" + struct.pack("<8I", size, 3, len(graph), 36, 0, size - 8, 8, size - 8) + graph + bytes(8)
        text, result = decode_graph(data=data, offset=0, table=bytes(range(256)))
        self.assertTrue(text.startswith("D"))
        self.assertEqual(result["layer_count"], 1)
        self.assertFalse(result["inference_verified"])
        bad = data.replace(b"1 1 123", b"1 2 123")
        with self.assertRaises(ValueError):
            decode_graph(data=bad, offset=0, table=bytes(range(256)))
        with self.assertRaises(ValueError):
            decode_graph(data=data, offset=0, table=bytes(256))

    def test_native_graph_table_requires_exact_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "runtime"
            path.write_bytes(b"unknown runtime")
            with self.assertRaisesRegex(ValueError, "unknown native runtime"):
                runtime_graph_table(path=path)

    def test_bm_sections_at_nonzero_offset(self):
        item = bytenn_sections(data=b"prefix" + bm() + b"suffix", offset=6)
        self.assertEqual(item["sections"][1]["offset"], 6 + 36 + len(b"opaque-graph"))
        self.assertEqual(item["evidence"], "bounded-container")
        self.assertEqual(item["graph_status"], "unknown")

    def test_v2_opaque_word_is_not_a_weight_size(self):
        item = bytenn_sections(data=bm(version=2, partial=True), offset=0)
        self.assertEqual(item["evidence"], "bounded-container-partial")
        self.assertEqual(len(item["sections"]), 2)
        self.assertEqual(item["opaque_sections"][0]["bytes"], 8)

    def test_v4_rejects_opaque_word(self):
        with self.assertRaises(ValueError):
            bytenn_sections(data=bm(partial=True), offset=0)

    def test_bm_rejects_invalid_tables(self):
        for field, value in ((4, 2**32 - 1), (8, 900), (16, 0), (20, 2**32 - 1), (24, 36)):
            with self.subTest(field=field):
                data = bytearray(bm())
                struct.pack_into("<I", data, field, value)
                with self.assertRaises(ValueError):
                    bytenn_sections(data=bytes(data), offset=0)

    def test_bm_truncations(self):
        data = bm()
        for end in range(len(data)):
            with self.assertRaises(ValueError):
                bytenn_sections(data=data[:end], offset=0)

    def test_magic_alone_is_not_model(self):
        item = inspect_container(data=b"xyzBM\0\4" + bytes(32))
        self.assertEqual(item["findings"], [])
        self.assertEqual(len(item["rejected"]), 1)

    def test_named_scripts_not_neural(self):
        data = named(leaves=[leaf(name="main.js", payload=b"return 1;"), leaf(name="number", payload=bytes(4))])
        item = inspect_container(data=data)
        self.assertEqual(item["classification"]["category"], "scripts-and-small-data")
        self.assertEqual(item["new_verified_networks"], 0)
        self.assertFalse(item["inference_performed"])

    def test_script_with_model_is_mixed(self):
        data = named(leaves=[leaf(name="main.js", payload=b"return 1;"), leaf(name="weights", payload=bm())])
        result = inspect_container(data=data)
        self.assertEqual(result["classification"]["category"], "neural-container-with-scripts")
        self.assertEqual(result["classification"]["bytenn_containers"], 1)

    def test_script_with_opaque_data_does_not_mean_non_neural(self):
        data = named(leaves=[leaf(name="main.js", payload=b"return 1;"), leaf(name="data", payload=bytes(65))])
        self.assertEqual(inspect_container(data=data)["classification"]["category"], "scripts-with-opaque-data")

    def test_named_bad_sizes(self):
        original = named(leaves=[leaf(name="x", payload=b"example")])
        for field in (0, 36, 40, 44 + 288, 44 + 292, 44 + 296 + 292):
            with self.subTest(field=field):
                data = bytearray(original)
                struct.pack_into("<I", data, field, 2**32 - 1)
                with self.assertRaises(ValueError):
                    named_records(data=bytes(data))

    def test_embedded_model_cannot_escape_its_record(self):
        malformed = bytearray(bm())
        struct.pack_into("<I", malformed, 4, len(malformed) + 20)
        data = named(leaves=[leaf(name="model", payload=malformed), leaf(name="suffix", payload=bytes(200))])
        result = inspect_container(data=data)
        self.assertEqual(result["classification"]["bytenn_containers"], 0)

    def test_tflite_partial_schema_and_bad_offsets(self):
        item = tflite_candidate(data=tflite(), offset=0)
        self.assertEqual(item["evidence"], "schema-candidate")
        self.assertEqual(item["vectors"]["subgraphs"], 1)
        for field, value in ((0, 4), (36, 2), (44, 2**32 - 1), (76, 1)):
            data = bytearray(tflite())
            struct.pack_into("<I", data, field, value)
            with self.assertRaises(ValueError):
                tflite_candidate(data=bytes(data), offset=0)

    def test_tfl3_signature_alone_rejected(self):
        result = inspect_container(data=b"TFL3" + bytes(32))
        self.assertEqual(result["findings"], [])

    def test_protobuf_wire_not_onnx(self):
        data = b"\x08\x03\x12\x10" + b"synthetic-string"
        result = inspect_container(data=data)
        self.assertEqual(result["findings"][0]["kind"], "protobuf-wire")
        self.assertEqual(result["findings"][0]["graph_status"], "schema-unverified")

    def test_protobuf_bounds(self):
        for data in (b"\x00", b"\x08\x80", b"\x12\x7fshort", b"\x08" + b"\xff" * 10):
            with self.assertRaises(ValueError):
                protobuf_fields(data=data)

    def test_versioned_wrapper_header_only(self):
        mask = bytes(range(8))
        encoded = bytes((x - y) % 256 for x, y in zip(b"v3\0\0\0\0\0\0", mask))
        data = mask + encoded + struct.pack("<II", 36, 4) + b"name" + struct.pack("<I", 1) + bytes(4)
        item = inspect_container(data=data)["findings"][0]
        self.assertEqual(item["kind"], "versioned-model-wrapper")
        self.assertEqual(item["evidence"], "header-validated")

    def test_sami_bounds(self):
        data = b"SAMI" + struct.pack("<IIIIQ", 12, 2, 1, 0, 8) + bytes(11)
        self.assertEqual(inspect_container(data=data)["findings"][0]["trailing_bytes"], 3)
        self.assertEqual(inspect_container(data=data[:29])["findings"], [])

    def test_zip_prefix_and_traversal(self):
        for name in ("model.espresso.net", "../bad", "/absolute", "a\\b"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(name, b"{}")
            data = b"prefix" + stream.getvalue()
            if name == "model.espresso.net":
                item = zip_container(data=data)
                self.assertEqual(item["offset"], 6)
                self.assertEqual(item["espresso_graphs"], 1)
            else:
                with self.assertRaises(ValueError):
                    zip_container(data=data)

    def test_zip_crc_checked(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("data", b"UNIQUE-CONTENT")
        data = stream.getvalue().replace(b"UNIQUE-CONTENT", b"BROKEN-CONTNT")
        self.assertEqual(inspect_container(data=data)["findings"], [])

    def test_extraction_private_and_idempotent(self):
        data = bm()
        result = inspect_container(data=data)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            out = root / "private" / "run"
            first = extract_candidates(data=data, result=result, out=out, private_root=root / "private")
            self.assertEqual(pathlib.Path(first[0]["path"]).read_bytes(), data)
            self.assertFalse(first[0]["inference_verified"])
            self.assertEqual(first, extract_candidates(data=data, result=result, out=out, private_root=root / "private"))
            with self.assertRaises(ValueError):
                extract_candidates(data=data, result=result, out=root / "elsewhere", private_root=root / "private")

    def test_extraction_rejects_symlinks_and_changed_contents(self):
        data = bm()
        result = inspect_container(data=data)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            out = root / "run"
            item = extract_candidates(data=data, result=result, out=out, private_root=root)[0]
            dest = pathlib.Path(item["path"])
            dest.write_bytes(b"other")
            with self.assertRaises(ValueError):
                extract_candidates(data=data, result=result, out=out, private_root=root)
            dest.unlink()
            dest.symlink_to(root / "elsewhere")
            with self.assertRaises(ValueError):
                extract_candidates(data=data, result=result, out=out, private_root=root)

    def test_bounded_rejects_negative_and_overflow(self):
        for offset, size in ((-1, 0), (0, -1), (5, 0), (2, 2**64)):
            with self.assertRaises(ValueError):
                bounded(data=b"1234", offset=offset, size=size)


if __name__ == "__main__":
    unittest.main()
