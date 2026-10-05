"""Synthetic CPU memory only; no LLDB, vendor runtime, models or GPU."""
import copy
import json
import struct
import unittest
from unittest import mock

import numpy as np

import face_extra_crop_trace as crop
from face_live_extra_trace_test import MemoryFixture


class CropMemoryFixture(MemoryFixture):
    def setUp(self):
        super().setUp()
        self.base, self.source, self.parameter = 0x100000, 0x60000, 0x61000
        self.source_data = 0xdead000
        self.memory[self.source] = crop.MAT_HEADER.pack(0x42ff0010, 2, 480, 640,
            self.source_data, 0, 0, 0, 0, 0, 0, 0, 1936, 3)
        self.memory[self.parameter + 0x18] = struct.pack("<2i", 2, 0)
        for offset in crop.CONFIG_BYTES:
            self.memory[self.registers["x3"] + offset] = bytes([int(offset in (0, 4))])
        for offset in (0x44, 0x4d, 0x96):
            self.memory[self.registers["x4"] + offset] = b"\0"
        for offset, value in ((0x3c, 1), (0x68, 0)):
            self.memory[self.registers["x4"] + offset] = struct.pack("<i", value)
        self.filter = self.alignment + 0x310
        for key, kind, value in (("count", "<i", 106), ("first", "<B", 1),
                                  ("alpha", "<f", 0.5), ("scale", "<f", 4),
                                  ("escale", "<f", 6), ("width", "<i", 480), ("height", "<i", 640)):
            self.memory[self.filter + crop.STATE_ABI[key]] = struct.pack(kind, value)
        for index, key in enumerate(("current", "previous", "delta_x", "delta_y")):
            size = 212 if index < 2 else 106
            begin = 0x70000 + index * 0x1000
            self.memory[self.filter + crop.STATE_ABI[key]] = struct.pack("<3Q", begin, begin + size * 4,
                                                                       begin + size * 4)
            self.memory[begin] = bytearray(struct.pack(f"<{size}f", *[i / 8 for i in range(size)]))
        for index, offset in enumerate(crop.TRANSFORMS.values()):
            address = self.alignment + offset
            self.memory[address + 0x930] = b"\1"
            self.put_matrix(address=address, data=0x80000 + index * 0x2000, cols=3)
            self.put_matrix(address=address + 0x60, data=0x81000 + index * 0x2000, cols=3)
            for table in (0xc0, 0x4f8):
                self.put_auto(address=address + table)
        self.memory[self.base + 0x5dd088] = bytearray(struct.pack("<480f", *[i / 4 for i in range(480)]))

    def put_auto(self, *, address, count=212):
        self.memory[address] = struct.pack("<2Q", address + 16, 264)
        self.memory[address + 0x430] = struct.pack("<Q", count)
        if count:
            self.memory[address + 16] = bytearray(struct.pack(f"<{count}f", *[i / 2 for i in range(count)]))

    def capture(self, *, event="before", prediction=0):
        return crop.snapshot(read=self.read, scope=self.scope(), event=event, prediction=prediction,
            thread=42, base=self.base, source=self.source, input_parameter=self.parameter)


class SnapshotTests(CropMemoryFixture, unittest.TestCase):
    def test_complete_read_only_snapshot_and_explicit_offsets(self):
        result = self.capture()
        self.assertEqual(result["schema"], crop.SCHEMA)
        self.assertEqual(result["offset"], crop.CALL)
        self.assertEqual(result["inner_filter"]["count"], 106)
        self.assertEqual(result["source"]["width"], 640)
        self.assertEqual(result["source"]["height"], 480)
        self.assertEqual(result["input_parameter"]["format"], 2)
        self.assertEqual(len(result["mean"]), 480)
        self.assertEqual(crop.TRANSFORMS, {"extra": 0x1b10, "stage2": 0x7d28})
        self.assertTrue(result["diagnostic_only"])
        for key in ("target_memory_written", "target_functions_evaluated",
                    "native_points_sent_to_worker", "product_parity_verified"):
            self.assertIs(result[key], False)
        self.assertLess(result["read_budget"]["bytes"], crop.READ_BYTES)
        self.assertLess(result["read_budget"]["calls"], crop.READ_CALLS)

    def test_no_source_pixels_padding_or_model_payloads_are_read(self):
        self.capture()
        self.assertNotIn(self.source_data, [address for address, _ in self.reads])
        self.assertEqual([size for address, size in self.reads if address == self.source], [96])
        self.assertNotIn("crop", self.capture())

    def test_snapshots_are_independent_of_memory_and_each_other(self):
        before = self.capture()
        saved = copy.deepcopy(before)
        struct.pack_into("<f", self.memory[0x70000], 0, 99)
        struct.pack_into("<f", self.memory[0x80000], 0, 77)
        after = self.capture(event="after")
        self.assertEqual(before, saved)
        self.assertEqual(after["inner_filter"]["current_xy"][0], 99)
        self.assertEqual(after["transforms"]["extra"]["forward"][0][0], 77)
        self.assertEqual(after["offset"], crop.RETURN)
        after["inner_filter"]["current_xy"][0] = 100
        self.assertEqual(before, saved)

    def test_signed_zero_and_subnormals_survive_json_as_float32_bits(self):
        words = [0x80000000, 1, 0x80000001, 0x00800000]
        self.memory[0x70000][:16] = struct.pack("<4I", *words)
        result = json.loads(json.dumps(self.capture(), allow_nan=False))
        actual = np.asarray(result["inner_filter"]["current_xy"][:4], np.float32).view(np.uint32)
        self.assertEqual(actual.tolist(), words)

    def test_snapshot_remains_compatible_with_offline_filter_decoder(self):
        from face_live_stage_audit import filter_state
        state = self.capture()["inner_filter"]
        decoded = filter_state(value=state, count=106, native=True, width=640, height=480)
        self.assertEqual(decoded["current_xy"].tolist(), state["current_xy"])

    def test_empty_inner_state_is_preserved_without_manufactured_seed(self):
        for key in ("count", "width", "height"):
            self.memory[self.filter + crop.STATE_ABI[key]] = struct.pack("<i", 0)
        for key in ("current", "previous", "delta_x", "delta_y"):
            self.memory[self.filter + crop.STATE_ABI[key]] = bytes(24)
        state = self.capture()["inner_filter"]
        self.assertEqual(state["count"], 0)
        self.assertEqual(state["width"], 0)
        self.assertEqual(state["height"], 0)
        self.assertEqual(state["current_xy"], [])

    def test_empty_transform_is_not_read_as_a_previous_output(self):
        address = self.alignment + crop.TRANSFORMS["extra"]
        self.memory[address + 0x930] = b"\0"
        for offset in (0, 0x60):
            self.memory[address + offset] = bytes(96)
        for offset in (0xc0, 0x4f8):
            self.put_auto(address=address + offset, count=0)
        item = self.capture()["transforms"]["extra"]
        self.assertIsNone(item["forward"])
        self.assertIsNone(item["inverse"])
        self.assertEqual(item["cached_xy"], [])
        self.assertFalse(item["ready"])

    def test_missing_or_short_memory_never_becomes_empty_state(self):
        address = self.alignment + crop.TRANSFORMS["extra"]
        for bad in (b"", bytes(95), "not bytes"):
            self.memory[address] = bad
            with self.subTest(bad=type(bad)), self.assertRaises(ValueError):
                self.capture()

    def test_unpaired_or_untyped_capture_arguments_fail(self):
        args = dict(read=self.read, scope=self.scope(), event="before", prediction=0, thread=42,
                    base=self.base, source=self.source, input_parameter=self.parameter)
        for key, value in (("event", "predict"), ("prediction", True), ("prediction", 2),
                           ("thread", 0), ("base", -1), ("base", 2**64),
                           ("input_parameter", 0), ("input_parameter", True)):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                crop.snapshot(**dict(args, **{key: value}))

    def test_changed_scope_identity_fails_before_geometry_reads(self):
        scope = dict(self.scope(), face_id=8)
        self.reads.clear()
        with self.assertRaisesRegex(ValueError, "identity"):
            crop.snapshot(read=self.read, scope=scope, event="after", prediction=0, thread=42,
                          base=self.base, source=self.source, input_parameter=self.parameter)
        self.assertNotIn(self.filter, [address for address, _ in self.reads])

    def test_filter_bad_counts_flags_dimensions_scalars_and_nan_fail(self):
        for key, kind, bad in (("count", "<i", -1), ("count", "<i", 107), ("first", "<B", 2),
                               ("width", "<i", 640), ("height", "<i", 0),
                               ("alpha", "<f", -0.1), ("alpha", "<f", 1.1),
                               ("alpha", "<f", float("nan")), ("scale", "<f", float("inf"))):
            address = self.filter + crop.STATE_ABI[key]
            original = self.memory[address]
            self.memory[address] = struct.pack(kind, bad)
            with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                self.capture()
            self.memory[address] = original

    def test_filter_vector_invalid_layouts_fail_before_payload(self):
        begin = 0x70000
        bads = [(0, 848, 848), (begin + 1, begin + 849, begin + 849),
                (begin, begin - 8, begin), (begin, begin + 848, begin + 840),
                (begin, begin + 840, begin + 848), (begin, begin + 848, begin + 4097)]
        for pointers in bads:
            self.memory[self.filter] = struct.pack("<3Q", *pointers)
            self.reads.clear()
            with self.subTest(pointers=pointers), self.assertRaisesRegex(ValueError, "filter vector"):
                crop.vector(read=self.read, address=self.filter, count=106, pairs=True)
            self.assertEqual(self.reads, [(self.filter, 24)])

    def test_allocated_empty_filter_vector_does_not_read_capacity(self):
        self.memory[self.filter] = struct.pack("<3Q", 0x70000, 0x70000, 0x70400)
        self.reads.clear()
        self.assertEqual(crop.vector(read=self.read, address=self.filter, count=106, pairs=True), [])
        self.assertEqual(self.reads, [(self.filter, 24)])

    def test_zero_vector_count_with_payload_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "filter vector"):
            crop.vector(read=self.read, address=self.filter, count=0, pairs=True)

    def test_filter_delta_pair_lengths_must_match(self):
        self.memory[self.filter + crop.STATE_ABI["delta_y"]] = bytes(24)
        with self.assertRaisesRegex(ValueError, "delta dimensions"):
            self.capture()

    def test_nonfinite_or_unbounded_vector_payload_rejected(self):
        for value in (float("nan"), float("inf"), 32769, -32769):
            struct.pack_into("<f", self.memory[0x70000], 0, value)
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "finite bounded"):
                self.capture()

    def test_autovector_layout_is_not_std_vector(self):
        address = self.alignment + crop.TRANSFORMS["extra"] + 0xc0
        for pointer, capacity, count in ((0, 264, 212), (address + 17, 264, 212),
                                       (address + 16, 265, 212), (address + 16, 264, 211),
                                       (address + 16, 210, 212), (0x90000, 264, 212)):
            self.memory[address] = struct.pack("<2Q", pointer, capacity)
            self.memory[address + 0x430] = struct.pack("<Q", count)
            with self.subTest(pointer=pointer, count=count), self.assertRaisesRegex(ValueError, "AutoVector"):
                crop.auto_vector(read=self.read, address=address)

    def test_autovector_accepts_observed_212_capacity_without_reading_spare_storage(self):
        address = self.alignment + crop.TRANSFORMS["extra"] + 0xc0
        for capacity in (212, 264):
            self.memory[address] = struct.pack("<2Q", address + 16, capacity)
            self.reads.clear()
            self.assertEqual(len(crop.auto_vector(read=self.read, address=address)), 212)
            self.assertEqual(self.reads[-1], (address + 16, 212 * 4))

    def test_initialized_transform_requires_matrices_and_both_point_caches(self):
        address = self.alignment + crop.TRANSFORMS["extra"]
        self.memory[address] = bytes(96)
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.capture()

    def test_transform_boolean_is_not_coerced(self):
        self.memory[self.alignment + crop.TRANSFORMS["extra"] + 0x930] = b"\2"
        with self.assertRaisesRegex(ValueError, "cache flag"):
            self.capture()

    def test_source_descriptor_rejects_bad_dims_flags_strides_and_pointer_overflow(self):
        fields = list(crop.MAT_HEADER.unpack(self.memory[self.source]))
        for index, value in ((0, 5), (1, 1), (2, 0), (3, 4097), (4, 0),
                             (4, 2**64 - 1), (12, 1919), (12, 16385), (13, 4)):
            changed = fields.copy()
            changed[index] = value
            self.memory[self.source] = crop.MAT_HEADER.pack(*changed)
            with self.subTest(index=index, value=value), self.assertRaisesRegex(ValueError, "source descriptor"):
                crop.source_descriptor(read=self.read, source=self.source)

    def test_rgba_source_descriptor_is_accepted_without_pixel_reads(self):
        self.memory[self.source] = crop.MAT_HEADER.pack(24, 2, 480, 640, self.source_data,
                                                      0, 0, 0, 0, 0, 0, 0, 2560, 4)
        self.assertEqual(self.capture()["source"]["channels"], 4)


class ReadBudgetTests(unittest.TestCase):
    def test_single_oversized_read_rejected_before_reader(self):
        reader = mock.Mock()
        bounded = crop.BoundedReader(read=reader)
        for size in (0, -1, True, crop.READ_BYTES + 1):
            with self.subTest(size=size), self.assertRaises(ValueError):
                bounded.read(address=4096, size=size)
        reader.assert_not_called()

    def test_aggregate_bytes_limited_before_next_reader(self):
        reader = mock.Mock(return_value=bytes(crop.READ_BYTES))
        bounded = crop.BoundedReader(read=reader)
        bounded.read(address=4096, size=crop.READ_BYTES)
        with self.assertRaisesRegex(ValueError, "budget"):
            bounded.read(address=4096, size=1)
        self.assertEqual(reader.call_count, 1)

    def test_aggregate_calls_limited_before_next_reader(self):
        reader = mock.Mock(return_value=b"\0")
        bounded = crop.BoundedReader(read=reader)
        for _ in range(crop.READ_CALLS):
            bounded.read(address=4096, size=1)
        with self.assertRaisesRegex(ValueError, "budget"):
            bounded.read(address=4096, size=1)
        self.assertEqual(reader.call_count, crop.READ_CALLS)

    def test_short_read_wrong_type_and_reader_failure_fail_closed(self):
        for value in (bytes(3), bytes(5), "0000", None):
            bounded = crop.BoundedReader(read=mock.Mock(return_value=value))
            with self.subTest(value=value), self.assertRaises(ValueError):
                bounded.read(address=4096, size=4)
        with self.assertRaisesRegex(ValueError, "read failed"):
            crop.BoundedReader(read=mock.Mock(side_effect=OSError())).read(address=4096, size=4)


if __name__ == "__main__":
    unittest.main()
