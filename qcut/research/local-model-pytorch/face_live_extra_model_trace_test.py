"""CPU-only Extra source/crop evidence; no target, debugger, or models."""
import copy
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

import face_live_extra_model_trace as trace


class EvidenceFixture:
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-extra-model-test-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.alignment, self.base, self.source = 0x10000, 0x1000000, 0x20000
        self.source_data, self.crop_data = 0x30000, 0x40000
        self.memory, self.reads = {}, []
        self.source_bytes = bytes(range(1, 25))
        self.put_pixels(address=self.source, data=self.source_data, rows=2, cols=3,
                        channels=4, pixels=self.source_bytes, padding=7)
        self.crop_bytes = bytes((index * 7 + 23) % 256 for index in range(160 * 160 * 3))
        self.put_pixels(address=self.alignment + 0x7ae8, data=self.crop_data, rows=160, cols=160,
                        channels=3, pixels=self.crop_bytes, padding=16)
        self.transforms = {}
        for index, (name, offset) in enumerate((("forward", 0x1b10), ("inverse", 0x1b70),
                ("stage2_forward", 0x7d28), ("stage2_inverse", 0x7d88))):
            data = 0x60000 + index * 0x1000
            values = [[index + row + column / 8 for column in range(3)] for row in range(2)]
            self.transforms[name] = dict(address=self.alignment + offset, data=data, values=values)
            self.put_header(address=self.alignment + offset, data=data, flags=5, rows=2, cols=3,
                            stride=32, step=4)
            for row, coordinates in enumerate(values):
                self.memory[data + row * 32] = bytearray(struct.pack("<3f", *coordinates))
        self.mean = [(index - 240) / 16 for index in range(480)]
        self.memory[self.base + 0x5dd088] = bytearray(struct.pack("<480f", *self.mean))

    def put_header(self, *, address, data, flags, rows, cols, stride, step, dims=2):
        self.memory[address] = bytearray(trace.MAT_HEADER.pack(flags | 0x42ff0000, dims, rows, cols,
            data, 0, 0, 0, 0, 0, 0, 0, stride, step))

    def put_pixels(self, *, address, data, rows, cols, channels, pixels, padding=0):
        row_bytes = cols * channels
        self.put_header(address=address, data=data, flags={3: 16, 4: 24}[channels],
                        rows=rows, cols=cols, stride=row_bytes + padding, step=channels)
        for row in range(rows):
            self.memory[data + row * (row_bytes + padding)] = bytearray(pixels[row * row_bytes:(row + 1) * row_bytes])

    def read(self, *, address, size):
        self.reads.append((address, size))
        for start, value in self.memory.items():
            if start <= address and address + size <= start + len(value):
                return memoryview(value)[address - start:address - start + size]
        raise ValueError("unmapped fixture span")

    def evidence(self, *, directory=None, prediction=0):
        return trace.snapshot(read=self.read, alignment=self.alignment, base=self.base, source=self.source,
            directory=self.directory if directory is None else directory, prediction=prediction)


class SourcePixelTests(EvidenceFixture, unittest.TestCase):
    def test_cv8uc3_and_cv8uc4_preserve_packed_bytes_layout_and_hash(self):
        for channels, layout in ((3, "bgr8"), (4, "rgba8")):
            pixels = bytes(range(1, channels * 6 + 1))
            self.put_pixels(address=self.source, data=self.source_data, rows=2, cols=3,
                            channels=channels, pixels=pixels, padding=7)
            self.reads.clear()
            with self.subTest(channels=channels):
                result = trace.source_pixels(read=self.read, address=self.source)
                self.assertEqual(result, dict(width=3, height=2, channels=channels, layout=layout,
                    sha256=hashlib.sha256(pixels).hexdigest(), hex=pixels.hex()))
                self.assertEqual(self.reads, [(self.source, trace.MAT_HEADER.size),
                    (self.source_data, channels * 3), (self.source_data + channels * 3 + 7, channels * 3)])
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_contiguous_and_maximum_stride_do_not_include_padding(self):
        for stride in (12, 16384):
            self.put_pixels(address=self.source, data=self.source_data, rows=2, cols=3,
                            channels=4, pixels=self.source_bytes, padding=stride - 12)
            with self.subTest(stride=stride):
                result = trace.source_pixels(read=self.read, address=self.source)
                self.assertEqual(bytes.fromhex(result["hex"]), self.source_bytes)
                self.assertEqual(self.reads[-1], (self.source_data + stride, 12))

    def test_bad_kind_dimensions_strides_and_extent_fail_before_payload(self):
        original = list(trace.MAT_HEADER.unpack(self.memory[self.source]))
        cases = [{0: kind} for kind in (0, 5, 8, 17, 25)]
        cases += [{index: value} for index, values in ((1, (0, 1, 3)),
            (2, (-1, 0, 4097)), (3, (-1, 0, 4097)), (12, (0, 11, 16385)), (13, (1, 3, 5)))
            for value in values]
        cases.append({2: 1025, 3: 4096, 12: 16384})
        for changes in cases:
            fields = original.copy()
            for index, value in changes.items():
                fields[index] = value
            self.memory[self.source] = trace.MAT_HEADER.pack(*fields)
            self.reads.clear()
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "bounded Extra source"):
                trace.source_pixels(read=self.read, address=self.source)
            self.assertEqual(self.reads, [(self.source, trace.MAT_HEADER.size)])

    def test_exact_16mib_budget_accepts_descriptor_without_allocating_large_fixture(self):
        header = trace.MAT_HEADER.pack(24, 2, 1024, 4096, self.source_data,
                                      0, 0, 0, 0, 0, 0, 0, 16384, 4)
        read = mock.Mock(side_effect=[header, OSError("payload sentinel")])
        with self.assertRaisesRegex(ValueError, "remote memory read failed"):
            trace.source_pixels(read=read, address=self.source)
        self.assertEqual(read.call_args_list, [mock.call(address=self.source, size=trace.MAT_HEADER.size),
                                               mock.call(address=self.source_data, size=16384)])

    def test_bad_header_address_and_invalid_data_pointer_are_rejected(self):
        for address in (0, 4095, True, (1 << 64) - 32):
            read = mock.Mock()
            with self.subTest(address=address), self.assertRaises(ValueError):
                trace.source_pixels(read=read, address=address)
            read.assert_not_called()
        fields = list(trace.MAT_HEADER.unpack(self.memory[self.source]))
        for data in (0, 4095, (1 << 64) - 6):
            fields[4] = data
            self.memory[self.source] = trace.MAT_HEADER.pack(*fields)
            self.reads.clear()
            with self.subTest(data=data), self.assertRaises(ValueError):
                trace.source_pixels(read=self.read, address=self.source)
            self.assertEqual(self.reads, [(self.source, trace.MAT_HEADER.size)])

    def test_short_nonbyte_and_unreadable_header_or_rows_fail_closed(self):
        header = bytes(self.memory[self.source])
        for bad in (header[:-1], header + b"\0", "not bytes", None, OSError("unmapped")):
            read = mock.Mock(side_effect=bad) if isinstance(bad, OSError) else mock.Mock(return_value=bad)
            with self.subTest(header=type(bad).__name__), self.assertRaises(ValueError):
                trace.source_pixels(read=read, address=self.source)
        for bad in (b"\0" * 11, b"\0" * 13, "not bytes", None, OSError("unmapped")):
            with self.subTest(row=type(bad).__name__), self.assertRaises(ValueError):
                trace.source_pixels(read=mock.Mock(side_effect=[header, bad]), address=self.source)

    def test_source_hex_and_sha_do_not_alias_remote_memory(self):
        result = trace.source_pixels(read=self.read, address=self.source)
        original = copy.deepcopy(result)
        self.memory[self.source_data][0] = 255
        self.assertEqual(result, original)
        changed = trace.source_pixels(read=self.read, address=self.source)
        self.assertNotEqual(changed["sha256"], result["sha256"])
        self.assertNotEqual(changed["hex"], result["hex"])


class ExtraModelSnapshotTests(EvidenceFixture, unittest.TestCase):
    def test_snapshot_has_exact_source_file_crop_sha_transforms_and_mean(self):
        result = self.evidence()
        path = self.directory / "source-0.pixels"
        self.assertEqual(result["source"], dict(width=3, height=2, channels=4, layout="rgba8",
            sha256=hashlib.sha256(self.source_bytes).hexdigest(), path=str(path)))
        self.assertEqual(path.read_bytes(), self.source_bytes)
        self.assertEqual(result["crop"], dict(width=160, height=160,
            sha256=hashlib.sha256(self.crop_bytes).hexdigest(), hex=self.crop_bytes.hex()))
        for name, transform in self.transforms.items():
            self.assertEqual(result[name], transform["values"])
        self.assertEqual(result["mean"], self.mean)
        self.assertIn((self.base + 0x5dd088, 480 * 4), self.reads)
        self.assertIs(result["native_points_sent_to_worker"], False)
        self.assertIs(result["diagnostic_only"], True)
        self.assertEqual(list(self.directory.iterdir()), [path])

    def test_bgr_source_stays_bgr_independent_of_bgr_crop(self):
        pixels = bytes(range(18))
        self.put_pixels(address=self.source, data=self.source_data, rows=2, cols=3,
                        channels=3, pixels=pixels, padding=7)
        result = self.evidence()
        self.assertEqual(result["source"]["layout"], "bgr8")
        self.assertEqual(Path(result["source"]["path"]).read_bytes(), pixels)
        self.assertEqual(result["crop"]["sha256"], hashlib.sha256(self.crop_bytes).hexdigest())
        self.assertNotEqual(result["source"]["sha256"], result["crop"]["sha256"])

    def test_existing_source_is_never_overwritten_or_appended(self):
        path = self.directory / "source-0.pixels"
        path.write_bytes(b"prior evidence")
        with self.assertRaises(FileExistsError):
            self.evidence()
        self.assertEqual(path.read_bytes(), b"prior evidence")
        self.assertNotIn((self.base + 0x5dd088, 480 * 4), self.reads)

    def test_source_symlinks_are_rejected_without_touching_target(self):
        link, target = self.directory / "source-0.pixels", self.directory / "target"
        for exists in (False, True):
            if exists:
                target.write_bytes(b"private original")
            link.symlink_to(target)
            with self.subTest(target_exists=exists), self.assertRaises(FileExistsError):
                self.evidence()
            self.assertTrue(link.is_symlink())
            self.assertEqual(target.exists(), exists)
            if exists:
                self.assertEqual(target.read_bytes(), b"private original")
            link.unlink()

    def test_two_predictions_keep_distinct_exclusive_source_evidence(self):
        first = self.evidence(prediction=0)
        self.memory[self.source_data][0] = 255
        second = self.evidence(prediction=1)
        self.assertEqual(Path(first["source"]["path"]).read_bytes(), self.source_bytes)
        self.assertEqual(Path(second["source"]["path"]).read_bytes(), bytes([255]) + self.source_bytes[1:])
        self.assertNotEqual(first["source"]["sha256"], second["source"]["sha256"])
        self.assertEqual(first["crop"], second["crop"])
        with self.assertRaises(FileExistsError):
            self.evidence(prediction=1)

    def test_changing_crop_does_not_change_source_evidence(self):
        first = self.evidence(prediction=0)
        self.memory[self.crop_data][0] = 255
        second = self.evidence(prediction=1)
        self.assertNotEqual(first["crop"]["sha256"], second["crop"]["sha256"])
        self.assertEqual(first["source"]["sha256"], second["source"]["sha256"])
        for result in (first, second):
            self.assertEqual(Path(result["source"]["path"]).read_bytes(), self.source_bytes)

    def test_snapshots_are_detached_from_source_crop_matrices_and_mean(self):
        first = self.evidence(prediction=0)
        original = copy.deepcopy(first)
        self.memory[self.source_data][0] = 255
        self.memory[self.crop_data][0] = 254
        for transform in self.transforms.values():
            struct.pack_into("<f", self.memory[transform["data"]], 0, 123)
        struct.pack_into("<f", self.memory[self.base + 0x5dd088], 0, 234)
        second = self.evidence(prediction=1)
        self.assertEqual(first, original)
        for name in self.transforms:
            self.assertEqual(second[name][0][0], 123)
            second[name][0][0] = 456
        self.assertEqual(second["mean"][0], 234)
        second["mean"][0] = 567
        self.assertEqual(first, original)
        self.assertEqual(Path(first["source"]["path"]).read_bytes(), self.source_bytes)

    def test_only_160x160_cv8uc3_crop_is_accepted_before_source_write(self):
        address = self.alignment + 0x7ae8
        original = list(trace.MAT_HEADER.unpack(self.memory[address]))
        for index, bad in ((0, 24), (1, 3), (2, 159), (3, 159), (13, 4)):
            fields = original.copy()
            fields[index] = bad
            self.memory[address] = trace.MAT_HEADER.pack(*fields)
            self.reads.clear()
            with self.subTest(index=index, bad=bad), self.assertRaises(ValueError):
                self.evidence()
            self.assertNotIn((self.source, trace.MAT_HEADER.size), self.reads)
            self.assertEqual(list(self.directory.iterdir()), [])

    def test_invalid_source_never_creates_evidence_file(self):
        fields = list(trace.MAT_HEADER.unpack(self.memory[self.source]))
        fields[13] = 1
        self.memory[self.source] = trace.MAT_HEADER.pack(*fields)
        with self.assertRaisesRegex(ValueError, "bounded Extra source"):
            self.evidence()
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_each_transform_rejects_nonfinite_or_unbounded_coordinates(self):
        for name, transform in self.transforms.items():
            for index, value in enumerate((float("nan"), float("inf"), -float("inf"), 32769, -32769)):
                original = bytes(self.memory[transform["data"]])
                struct.pack_into("<f", self.memory[transform["data"]], 0, value)
                directory = self.directory / f"{name}-{index}"
                directory.mkdir()
                with self.subTest(name=name, value=value), self.assertRaisesRegex(ValueError, "finite bounded"):
                    self.evidence(directory=directory)
                self.memory[transform["data"]][:] = original

    def test_each_transform_rejects_bad_shape_type_and_stride(self):
        for name, transform in self.transforms.items():
            address = transform["address"]
            original = list(trace.MAT_HEADER.unpack(self.memory[address]))
            for index, bad in ((0, 16), (1, 3), (2, 1), (3, 4), (12, 11), (12, 4097), (13, 8)):
                fields = original.copy()
                fields[index] = bad
                self.memory[address] = trace.MAT_HEADER.pack(*fields)
                directory = self.directory / f"{name}-{index}-{bad}"
                directory.mkdir()
                with self.subTest(name=name, index=index, bad=bad), self.assertRaisesRegex(ValueError, "descriptor"):
                    self.evidence(directory=directory)
            self.memory[address] = trace.MAT_HEADER.pack(*original)

    def test_mean_is_finite_bounded_and_exactly_480_float32_values(self):
        address = self.base + 0x5dd088
        original = bytes(self.memory[address])
        for index, value in enumerate((float("nan"), float("inf"), 32769, -32769)):
            struct.pack_into("<f", self.memory[address], 479 * 4, value)
            directory = self.directory / f"mean-{index}"
            directory.mkdir()
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "finite bounded"):
                self.evidence(directory=directory)
        self.memory[address] = bytearray(original[:-4])
        directory = self.directory / "mean-short"
        directory.mkdir()
        with self.assertRaisesRegex(ValueError, "remote memory read failed"):
            self.evidence(directory=directory)


if __name__ == "__main__":
    unittest.main()
