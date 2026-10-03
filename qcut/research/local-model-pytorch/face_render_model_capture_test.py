"""Synthetic capture files exercise inventory contracts without native inference."""

import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import face_render_model_capture as probe


class SyntheticCapture:
    def __init__(self, *, directory: Path):
        self.directory = directory
        self.sequence = 0

    def record(self, *, kind: str, detail: str, size: int = 0, index: int | None = None) -> Path:
        path = self.directory / f"{self.sequence:04d}-{kind}.json"
        value = dict(index=self.sequence if index is None else index, kind=kind, detail=detail, bytes=size)
        self.sequence += 1
        path.write_text(json.dumps(value))
        return path

    def network(self, *, identity: str = "101", outputs: str = "landmarks;", index: int | None = None) -> Path:
        path = self.record(kind="espresso", detail=f"self={identity} outputs={outputs}", index=index)
        path.with_suffix(".graph.txt").write_bytes(b"synthetic graph fixture, not a neural model\n")
        return path

    def tensor(self, *, kind: str = "espresso-input", identity: str = "101", name: str = "input",
               inference: str = "0", dims: str = "1,2,2,1", raw: str = "4,0",
               data: bytes | None = None, declared_size: int | None = None) -> Path:
        payload = struct.pack("<4f", 0.25, 0.5, 0.75, 1.0) if data is None else data
        detail = f"self={identity} name={name} inference={inference} dims={dims} raw={raw}"
        path = self.record(kind=kind, detail=detail, size=len(payload) if declared_size is None else declared_size)
        path.with_suffix(".bin").write_bytes(payload)
        return path

    def complete(self, *, identity: str = "101", inference: str = "0", rc: str = "0") -> Path:
        return self.record(kind="espresso-inference", detail=f"self={identity} inference={inference} rc={rc}")

    def successful(self, *, identity: str = "101", count: int = 1) -> None:
        self.network(identity=identity)
        for inference in range(count):
            self.tensor(identity=identity, inference=str(inference))
            self.complete(identity=identity, inference=str(inference))
            self.tensor(kind="espresso-output", identity=identity, name="landmarks", inference=str(inference))


def amend(*, path: Path, fields: dict) -> None:
    value = json.loads(path.read_text())
    value.update(fields)
    path.write_text(json.dumps(value))


class CaptureTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.capture = SyntheticCapture(directory=self.directory)
        guard = patch.object(probe.subprocess, "run", side_effect=AssertionError("native calls forbidden"))
        guard.start()
        self.addCleanup(guard.stop)


class MetadataTests(CaptureTestCase):
    def test_valid_metadata_extracts_fields_and_local_path(self):
        path = self.capture.record(kind="espresso-input", size=16,
                                   detail="self=101 name=input inference=0 dims=1,2,2,1 raw=4,0 note=a=b")
        result = probe.metadata(path=path)
        self.assertEqual(result["index"], 0)
        self.assertEqual(result["bytes"], 16)
        self.assertEqual(result["path"], str(path))
        self.assertEqual(result["fields"], {
            "self": "101", "name": "input", "inference": "0", "dims": "1,2,2,1", "raw": "4,0", "note": "a=b"})

    def test_byte_bounds_are_inclusive(self):
        for size in (0, 256 * 1024**2):
            with self.subTest(size=size):
                path = self.capture.record(kind="other", detail="", size=size)
                self.assertEqual(probe.metadata(path=path)["bytes"], size)

    def test_invalid_index_or_byte_bounds_and_numeric_types(self):
        for key, values in (
            ("index", (-1, True, 0.0, 1.5, float("nan"), float("inf"), "0", None)),
            ("bytes", (-1, 256 * 1024**2 + 1, True, 16.0, float("nan"), float("inf"), "16", None)),
        ):
            for replacement in values:
                path = self.capture.record(kind="other", detail="")
                amend(path=path, fields={key: replacement})
                with self.subTest(key=key, replacement=replacement), self.assertRaises(ValueError):
                    probe.metadata(path=path)

    def test_missing_required_fields(self):
        for key in ("index", "kind", "detail", "bytes"):
            path = self.capture.record(kind="other", detail="")
            value = json.loads(path.read_text())
            value.pop(key)
            path.write_text(json.dumps(value))
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.metadata(path=path)

    def test_wrong_top_level_shape(self):
        for value in (None, [], [1], 0, "metadata"):
            path = self.capture.record(kind="other", detail="")
            path.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.metadata(path=path)

    def test_kind_and_detail_must_be_strings(self):
        for key in ("kind", "detail"):
            for value in (None, 0, False, [], {}):
                path = self.capture.record(kind="other", detail="")
                amend(path=path, fields={key: value})
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    probe.metadata(path=path)

    def test_duplicate_detail_fields_are_rejected(self):
        for detail in ("self=101 self=101", "self=101 self=202", "inference=0 inference=1",
                       "name=input name=other", "raw=4,0 raw=1,0"):
            path = self.capture.record(kind="other", detail=detail)
            with self.subTest(detail=detail), self.assertRaisesRegex(ValueError, "duplicate"):
                probe.metadata(path=path)

    def test_missing_and_truncated_metadata_do_not_pass(self):
        with self.assertRaises(FileNotFoundError):
            probe.metadata(path=self.directory / "missing.json")
        path = self.capture.record(kind="other", detail="")
        for content in (b"", b"{", b'{"index": 0,'):
            path.write_bytes(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                probe.metadata(path=path)

    def test_metadata_file_byte_limit(self):
        path = self.capture.record(kind="other", detail="")
        path.write_bytes(b" " * 65537)
        with self.assertRaisesRegex(ValueError, "byte limit"):
            probe.metadata(path=path)

    def test_directory_is_not_a_metadata_file(self):
        with self.assertRaises(ValueError):
            probe.metadata(path=self.directory)


class InventoryTests(CaptureTestCase):
    def test_successful_inference_sequence_has_real_inputs_outputs_and_hashes(self):
        self.capture.successful(count=3)
        result = probe.inventory(capture=self.directory)
        self.assertEqual(result["successful_inferences"], 3)
        self.assertEqual(result["metadata_records"], 10)
        self.assertEqual(set(result["networks"]), {"101"})
        network = result["networks"]["101"]
        self.assertEqual(network["successful_inferences"], [0, 1, 2])
        self.assertEqual(network["declared_outputs"], ["landmarks", ""])
        self.assertEqual(network["graph_sha256"], hashlib.sha256(Path(network["graph_path"]).read_bytes()).hexdigest())
        for key, name in (("inputs", "input"), ("outputs", "landmarks")):
            self.assertEqual([item["inference"] for item in network[key]], [0, 1, 2])
            for item in network[key]:
                self.assertEqual(item["name"], name)
                self.assertEqual(item["dims_nwhc"], [1, 2, 2, 1])
                self.assertEqual(item["raw"], [4, 0])
                self.assertEqual(item["sha256"], hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest())

    def test_multiple_networks_and_named_inputs_are_kept_separate(self):
        self.capture.successful(identity="101")
        self.capture.tensor(identity="101", name="mean")
        self.capture.successful(identity="202", count=2)
        result = probe.inventory(capture=self.directory)
        self.assertEqual(result["successful_inferences"], 3)
        self.assertEqual(set(result["networks"]), {"101", "202"})
        self.assertEqual([item["name"] for item in result["networks"]["101"]["inputs"]], ["input", "mean"])

    def test_empty_directory_or_only_unknown_records_cannot_pass(self):
        with self.assertRaises(ValueError):
            probe.inventory(capture=self.directory)
        self.capture.record(kind="diagnostic", detail="result=success")
        with self.assertRaisesRegex(ValueError, "no actual successful"):
            probe.inventory(capture=self.directory)

    def test_record_count_bound_precedes_metadata_reads(self):
        with patch.object(Path, "glob", return_value=[self.directory / "x.json"] * 4097):
            with patch.object(probe, "metadata") as reader, self.assertRaisesRegex(ValueError, "bounded"):
                probe.inventory(capture=self.directory)
            reader.assert_not_called()

    def test_duplicate_capture_indices_are_rejected(self):
        self.capture.successful()
        self.capture.record(kind="diagnostic", detail="", index=0)
        with self.assertRaisesRegex(ValueError, "duplicate model capture index"):
            probe.inventory(capture=self.directory)

    def test_reused_network_object_is_rejected(self):
        self.capture.successful()
        self.capture.network()
        with self.assertRaisesRegex(ValueError, "reused"):
            probe.inventory(capture=self.directory)

    def test_invalid_network_identity(self):
        for identity in ("", "0", "-1", "1.0", "nan", "0x123"):
            with self.subTest(identity=identity), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network(identity=identity)
                with self.assertRaisesRegex(ValueError, "network object"):
                    probe.inventory(capture=capture.directory)

    def test_missing_or_oversized_network_graph_is_rejected(self):
        self.capture.successful()
        graph = next(self.directory.glob("*.graph.txt"))
        graph.unlink()
        with self.assertRaises(FileNotFoundError):
            probe.inventory(capture=self.directory)
        graph.write_bytes(b"x" * (1024**2 + 1))
        with self.assertRaisesRegex(ValueError, "byte limit"):
            probe.inventory(capture=self.directory)

    def test_tensor_or_completion_requires_matching_network_graph(self):
        for kind in ("espresso-input", "espresso-output", "espresso-inference"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.successful(identity="101")
                if kind == "espresso-inference":
                    capture.complete(identity="999")
                else:
                    capture.tensor(kind=kind, identity="999")
                with self.assertRaisesRegex(ValueError, "matching network graph"):
                    probe.inventory(capture=capture.directory)

    def test_missing_completion_cannot_be_inferred_from_tensor_files(self):
        self.capture.network()
        self.capture.tensor()
        self.capture.tensor(kind="espresso-output", name="landmarks")
        with self.assertRaisesRegex(ValueError, "successful inference"):
            probe.inventory(capture=self.directory)

    def test_network_creation_and_preinference_extract_are_not_success(self):
        self.capture.network()
        self.capture.tensor(kind="espresso-output", inference="-1", name="input")
        with self.assertRaisesRegex(ValueError, "no actual successful"):
            probe.inventory(capture=self.directory)

    def test_completion_without_input_and_output_only_completion_cannot_pass(self):
        self.capture.network()
        self.capture.complete()
        with self.assertRaisesRegex(ValueError, "missing or duplicate inputs"):
            probe.inventory(capture=self.directory)
        self.capture.tensor(kind="espresso-output", name="landmarks")
        with self.assertRaisesRegex(ValueError, "missing or duplicate inputs"):
            probe.inventory(capture=self.directory)

    def test_failed_or_missing_return_code_cannot_pass(self):
        for rc in ("1", "-1", "0.0", "nan", "false", ""):
            with self.subTest(rc=rc), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                capture.tensor()
                capture.complete(rc=rc)
                with self.assertRaisesRegex(ValueError, "failed or duplicate"):
                    probe.inventory(capture=capture.directory)
        self.capture.network()
        self.capture.tensor()
        self.capture.record(kind="espresso-inference", detail="self=101 inference=0")
        with self.assertRaisesRegex(ValueError, "failed or duplicate"):
            probe.inventory(capture=self.directory)

    def test_duplicate_completion_is_rejected(self):
        self.capture.successful()
        self.capture.complete()
        with self.assertRaisesRegex(ValueError, "failed or duplicate"):
            probe.inventory(capture=self.directory)

    def test_inference_sequence_cannot_start_late_skip_or_reverse(self):
        for inferences in ((1,), (0, 2), (1, 0)):
            with self.subTest(inferences=inferences), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                for inference in inferences:
                    capture.tensor(inference=str(inference))
                    capture.complete(inference=str(inference))
                with self.assertRaisesRegex(ValueError, "sequence has gaps"):
                    probe.inventory(capture=capture.directory)

    def test_duplicate_input_name_in_completed_inference_is_rejected(self):
        self.capture.successful()
        self.capture.tensor()
        with self.assertRaisesRegex(ValueError, "duplicate inputs"):
            probe.inventory(capture=self.directory)

    def test_same_input_name_on_different_inferences_is_not_duplicate(self):
        self.capture.successful(count=2)
        result = probe.inventory(capture=self.directory)
        self.assertEqual(result["successful_inferences"], 2)
        self.assertEqual([item["name"] for item in result["networks"]["101"]["inputs"]], ["input", "input"])

    def test_uncompleted_input_or_output_poison_cannot_hide_behind_success(self):
        for kind in ("espresso-input", "espresso-output"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.successful()
                capture.tensor(kind=kind, inference="1")
                with self.assertRaisesRegex(ValueError, "lacks a successful inference"):
                    probe.inventory(capture=capture.directory)

    def test_invalid_inference_bounds_double_and_nan(self):
        for inference in ("-2", "129", "0.0", "nan", "inf", "true", "", "--1"):
            with self.subTest(inference=inference), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.successful()
                capture.tensor(inference=inference, name="other")
                with self.assertRaises(ValueError):
                    probe.inventory(capture=capture.directory)

    def test_negative_completion_is_rejected_even_with_preinference_tensor(self):
        self.capture.network()
        self.capture.tensor(inference="-1")
        self.capture.complete(inference="-1")
        with self.assertRaisesRegex(ValueError, "failed or duplicate"):
            probe.inventory(capture=self.directory)

    def test_capture_error_markers_reject_otherwise_valid_tensor(self):
        for marker in (" skipped", " requested=32 written=16"):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                path = capture.tensor()
                value = json.loads(path.read_text())
                amend(path=path, fields={"detail": value["detail"] + marker})
                capture.complete()
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    probe.inventory(capture=capture.directory)

    def test_invalid_tensor_dimensions(self):
        for dims in ("", "1,2,2", "1,2,2,1,1", "0,2,2,1", "-1,2,2,1", "4097,1,1,1",
                     "1.0,2,2,1", "nan,2,2,1", "1,2,2,true"):
            with self.subTest(dims=dims), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                capture.tensor(dims=dims)
                capture.complete()
                with self.assertRaisesRegex(ValueError, "tensor descriptor"):
                    probe.inventory(capture=capture.directory)

    def test_invalid_tensor_storage_descriptor(self):
        for raw in ("", "4", "4,0,1", "0,0", "3,0", "8,0", "4.0,0", "4,-17", "4,25", "4,0.0", "4,nan"):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                capture.tensor(raw=raw)
                capture.complete()
                with self.assertRaisesRegex(ValueError, "tensor descriptor"):
                    probe.inventory(capture=capture.directory)

    def test_storage_sizes_and_exponent_boundaries(self):
        for storage, exponent in ((1, -16), (2, 24), (4, 0)):
            with self.subTest(storage=storage), tempfile.TemporaryDirectory() as temporary:
                capture = SyntheticCapture(directory=Path(temporary))
                capture.network()
                capture.tensor(raw=f"{storage},{exponent}", data=b"\x01" * (storage * 4))
                capture.complete()
                item = probe.inventory(capture=capture.directory)["networks"]["101"]["inputs"][0]
                self.assertEqual(item["raw"], [storage, exponent])

    def test_tensor_dimension_upper_boundary(self):
        self.capture.network()
        self.capture.tensor(dims="1,4096,1,1", data=b"\0" * 16384)
        self.capture.complete()
        item = probe.inventory(capture=self.directory)["networks"]["101"]["inputs"][0]
        self.assertEqual(item["dims_nwhc"], [1, 4096, 1, 1])

    def test_computed_tensor_size_bound_and_declared_size_mismatch(self):
        self.capture.network()
        path = self.capture.tensor(dims="1,4096,4096,1")
        self.capture.complete()
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            probe.inventory(capture=self.directory)
        amend(path=path, fields={"detail": "self=101 name=input inference=0 dims=1,2,2,1 raw=4,0", "bytes": 15})
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            probe.inventory(capture=self.directory)

    def test_missing_truncated_or_oversized_tensor_file(self):
        self.capture.successful()
        path = next(self.directory.glob("*-espresso-input.bin"))
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            probe.inventory(capture=self.directory)
        path.write_bytes(b"\0" * 15)
        with self.assertRaisesRegex(ValueError, "truncated"):
            probe.inventory(capture=self.directory)
        path.write_bytes(b"\0" * 17)
        with self.assertRaisesRegex(ValueError, "byte limit"):
            probe.inventory(capture=self.directory)

    def test_missing_tensor_name_is_rejected(self):
        self.capture.network()
        self.capture.tensor(name="")
        self.capture.complete()
        with self.assertRaisesRegex(ValueError, "tensor descriptor"):
            probe.inventory(capture=self.directory)

    def test_tensor_metadata_duplicate_field_cannot_pass(self):
        self.capture.successful()
        path = next(self.directory.glob("*-espresso-input.json"))
        value = json.loads(path.read_text())
        amend(path=path, fields={"detail": value["detail"] + " inference=1"})
        with self.assertRaisesRegex(ValueError, "duplicate model capture metadata"):
            probe.inventory(capture=self.directory)


if __name__ == "__main__":
    unittest.main()
