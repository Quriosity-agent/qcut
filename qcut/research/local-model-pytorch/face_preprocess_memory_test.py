"""Synthetic remote-memory tests; no LLDB, native code, GPU or models."""

from copy import deepcopy
import inspect
import struct
import unittest

import face_preprocess_memory as memory


class FakeMemory:
    def __init__(self):
        self.blocks = {}
        self.calls = []

    def store(self, *, address, data):
        self.blocks[address] = bytes(data)

    def read(self, *, address, size):
        self.calls.append((address, size))
        for start, data in self.blocks.items():
            offset = address - start
            if 0 <= offset and offset + size <= len(data):
                return data[offset:offset + size]
        raise OSError(f"unmapped synthetic range {address:#x}/{size}")


def mat_header(*, flags=16, dims=2, rows=2, cols=2, data=0x30000, row_stride=6, pixel_stride=3):
    return memory.MAT_HEADER.pack(flags, dims, rows, cols, data, 0, 0, 0, 0, 0, 0, 0,
                                  row_stride, pixel_stride)


def float_bits(*, value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


class CheckedReadTests(unittest.TestCase):
    def test_keyword_only_public_api(self):
        for function in (memory.checked_read, memory.unpack_mat, memory.unpack_rect, memory.unpack_detection_call):
            with self.subTest(function=function.__name__):
                self.assertTrue(all(parameter.kind == inspect.Parameter.KEYWORD_ONLY
                                    for parameter in inspect.signature(function).parameters.values()))

    def test_exact_read_and_keyword_only_reader(self):
        fake = FakeMemory()
        fake.store(address=4096, data=b"abc")
        self.assertEqual(memory.checked_read(read=fake.read, address=4096, size=3), b"abc")
        self.assertEqual(fake.calls, [(4096, 3)])

    def test_bytes_like_reads_are_owned_bytes(self):
        for data in (b"abc", bytearray(b"abc"), memoryview(b"abc"), memoryview(bytearray(4)).cast("I")):
            with self.subTest(type=type(data)):
                def read(*, address, size):
                    return data
                size = data.nbytes if isinstance(data, memoryview) else len(data)
                result = memory.checked_read(read=read, address=4096, size=size)
                self.assertIs(type(result), bytes)
                self.assertEqual(result, bytes(data))
                if isinstance(data, bytearray):
                    data[0] = 0
                    self.assertEqual(result, b"abc")

    def test_invalid_ranges_never_call_reader(self):
        fake = FakeMemory()
        cases = [(value, 1) for value in (None, True, False, 4096.0, float("inf"), -1, 0, 4095,
                                        memory.MAX_ADDRESS + 1)]
        cases += [(4096, value) for value in (None, True, False, 1.0, float("nan"), -1, 0,
                                            memory.MAX_BLOB_BYTES + 1)]
        cases += [(memory.MAX_ADDRESS, 2)]
        for address, size in cases:
            with self.subTest(address=address, size=size), self.assertRaises(ValueError):
                memory.checked_read(read=fake.read, address=address, size=size)
        self.assertEqual(fake.calls, [])

    def test_last_uint64_byte_and_maximum_blob_are_valid(self):
        calls = []
        def read(*, address, size):
            calls.append((address, size))
            return bytes(size)
        for address, size in ((memory.MAX_ADDRESS, 1), (4096, memory.MAX_BLOB_BYTES)):
            self.assertEqual(len(memory.checked_read(read=read, address=address, size=size)), size)
        self.assertEqual(len(calls), 2)

    def test_wrong_types_and_short_or_long_reads_rejected(self):
        for data in (None, "abc", [1, 2, 3], 3, b"", b"ab", b"abcd"):
            with self.subTest(data=data):
                def read(*, address, size):
                    return data
                with self.assertRaises(ValueError):
                    memory.checked_read(read=read, address=4096, size=3)

    def test_reader_failure_has_original_cause(self):
        def read(*, address, size):
            raise OSError("synthetic failure")
        with self.assertRaisesRegex(ValueError, "read failed") as caught:
            memory.checked_read(read=read, address=4096, size=1)
        self.assertIsInstance(caught.exception.__cause__, OSError)

    def test_noncallable_reader_rejected(self):
        with self.assertRaises(ValueError):
            memory.checked_read(read=None, address=4096, size=1)

    def test_interrupt_is_not_suppressed(self):
        def read(*, address, size):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            memory.checked_read(read=read, address=4096, size=1)


class MatTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeMemory()
        self.address = 0x20000
        self.data = 0x30000
        self.fake.store(address=self.address, data=mat_header())
        self.fake.store(address=self.data, data=bytes(range(12)))

    def unpack(self):
        return memory.unpack_mat(read=self.fake.read, address=self.address)

    def test_contiguous_header_metadata_and_packed_pixels(self):
        metadata, pixels = self.unpack()
        expected = dict(address=self.address, flags=16, dims=2, rows=2, cols=2, data=self.data,
                        row_stride=6, pixel_stride=3, packed_bytes=12, raw_hex=mat_header().hex())
        self.assertEqual(metadata, expected)
        self.assertEqual(pixels, bytes(range(12)))
        self.assertEqual(self.fake.calls, [(self.address, 96), (self.data, 12)])

    def test_stride_padding_is_excluded_and_not_read(self):
        self.fake.store(address=self.address, data=mat_header(row_stride=10))
        self.fake.blocks = {self.address: self.fake.blocks[self.address], self.data: b"abcdef",
                            self.data + 10: b"ghijkl"}
        metadata, pixels = self.unpack()
        self.assertEqual(pixels, b"abcdefghijkl")
        self.assertEqual(metadata["packed_bytes"], 12)
        self.assertEqual(self.fake.calls, [(self.address, 96), (self.data, 6), (self.data + 10, 6)])

    def test_high_flags_are_preserved_with_masked_type(self):
        flags = -2147483632
        self.fake.store(address=self.address, data=mat_header(flags=flags))
        self.assertEqual(self.unpack()[0]["flags"], flags)

    def test_invalid_header_fields_fail_before_pixel_reads(self):
        cases = [dict(flags=value) for value in (0, 8, 17, 4095)]
        cases += [dict(dims=value) for value in (-1, 0, 1, 3)]
        cases += [{field: value} for field in ("rows", "cols") for value in (-1, 0, 4097)]
        cases += [dict(row_stride=value) for value in (0, 5, memory.MAX_BLOB_BYTES + 1)]
        cases += [dict(pixel_stride=value) for value in (0, 1, 4)]
        cases += [dict(data=value) for value in (0, 4095, memory.MAX_ADDRESS)]
        for changes in cases:
            self.fake.calls.clear()
            self.fake.store(address=self.address, data=mat_header(**changes))
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.unpack()
            self.assertEqual(self.fake.calls, [(self.address, 96)])

    def test_packed_size_limit_rejected_before_pixel_reads(self):
        self.fake.store(address=self.address, data=mat_header(rows=4096, cols=4096, row_stride=12288))
        with self.assertRaisesRegex(ValueError, "blob limit"):
            self.unpack()
        self.assertEqual(self.fake.calls, [(self.address, 96)])

    def test_strided_extent_limit_rejected_even_for_small_packed_blob(self):
        self.fake.store(address=self.address, data=mat_header(row_stride=memory.MAX_BLOB_BYTES))
        with self.assertRaisesRegex(ValueError, "strided extent"):
            self.unpack()
        self.assertEqual(self.fake.calls, [(self.address, 96)])

    def test_single_row_does_not_require_trailing_stride_padding(self):
        self.fake.store(address=self.address, data=mat_header(rows=1, row_stride=memory.MAX_BLOB_BYTES,
                                                            data=memory.MAX_ADDRESS - 5))
        self.fake.store(address=memory.MAX_ADDRESS - 5, data=b"abcdef")
        self.assertEqual(self.unpack()[1], b"abcdef")

    def test_exact_extent_limit_and_uint64_end_are_allowed(self):
        data = memory.MAX_ADDRESS - (memory.MAX_BLOB_BYTES - 1)
        stride = memory.MAX_BLOB_BYTES - 3
        self.fake.store(address=self.address, data=mat_header(rows=2, cols=1, row_stride=stride, data=data))
        self.fake.store(address=data, data=b"abc")
        self.fake.store(address=data + stride, data=b"def")
        self.assertEqual(self.unpack()[1], b"abcdef")

    def test_dimension_endpoints_are_supported(self):
        for rows, cols in ((1, 1), (4096, 1), (1, 4096)):
            size = rows * cols * 3
            self.fake.store(address=self.address, data=mat_header(rows=rows, cols=cols, row_stride=cols * 3))
            self.fake.store(address=self.data, data=bytes(size))
            with self.subTest(rows=rows, cols=cols):
                self.assertEqual(len(self.unpack()[1]), size)

    def test_large_packed_blob_below_limit_is_supported(self):
        rows, cols = 1365, 4096
        size = rows * cols * 3
        self.fake.store(address=self.address, data=mat_header(rows=rows, cols=cols, row_stride=cols * 3))
        self.fake.store(address=self.data, data=bytes(size))
        metadata, pixels = self.unpack()
        self.assertEqual(metadata["packed_bytes"], size)
        self.assertEqual(len(pixels), size)
        self.assertLess(size, memory.MAX_BLOB_BYTES)

    def test_minimum_data_pointer_is_supported(self):
        self.fake.store(address=self.address, data=mat_header(data=memory.MIN_ADDRESS))
        self.fake.store(address=memory.MIN_ADDRESS, data=b"abcdefghijkl")
        self.assertEqual(self.unpack()[1], b"abcdefghijkl")

    def test_header_and_row_read_failures_never_return_partial_pixels(self):
        self.fake.store(address=self.address, data=b"short")
        with self.assertRaises(ValueError):
            self.unpack()
        self.fake.store(address=self.address, data=mat_header(row_stride=10))
        with self.assertRaises(ValueError):
            self.unpack()
        self.assertEqual(self.fake.calls[-1], (self.data + 10, 6))

    def test_header_overflow_never_reads(self):
        with self.assertRaises(ValueError):
            memory.unpack_mat(read=self.fake.read, address=memory.MAX_ADDRESS - 94)
        self.assertEqual(self.fake.calls, [])


class RectTests(unittest.TestCase):
    def test_raw_float32_bits_and_bounds_are_preserved(self):
        fake = FakeMemory()
        values = [-32768.0, -0.0, 32768.0, 0.125]
        raw = struct.pack("<4f", *values)
        fake.store(address=4096, data=raw)
        self.assertEqual(memory.unpack_rect(read=fake.read, address=4096), dict(values=values, raw_hex=raw.hex()))

    def test_invalid_each_component_and_nonpositive_extent(self):
        fake = FakeMemory()
        cases = [(index, value) for index in range(4) for value in (float("nan"), float("inf"),
                                                                  -float("inf"), 32769.0, -32769.0)]
        cases += [(index, value) for index in (2, 3) for value in (0.0, -0.0, -1.0)]
        for index, value in cases:
            values = [1.0, 2.0, 3.0, 4.0]
            values[index] = value
            fake.store(address=4096, data=struct.pack("<4f", *values))
            with self.subTest(index=index, value=value), self.assertRaises(ValueError):
                memory.unpack_rect(read=fake.read, address=4096)

    def test_short_rect_rejected(self):
        fake = FakeMemory()
        fake.store(address=4096, data=bytes(15))
        with self.assertRaises(ValueError):
            memory.unpack_rect(read=fake.read, address=4096)


class DetectionCallTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeMemory()
        self.alignment, self.source, self.input = 0x10000, 0x20000, 0x40000
        self.configs, self.face, self.runtime, self.frame = 0x50000, 0x60000, 0x70000, 0x80000
        self.slots = [self.runtime, self.face, self.configs, self.input, self.source, self.alignment]
        self.store_slots()
        self.fake.store(address=self.alignment + 0x95c, data=struct.pack("<2i", 160, 160))
        self.fake.store(address=self.input + 0x18, data=struct.pack("<2i", 2, 3))
        self.fake.store(address=self.configs + 0xb, data=b"\x81")
        self.fake.store(address=self.face + 0x24, data=b"\xfe")
        self.fake.store(address=self.face + 0x39, data=b"\xff")
        self.fake.store(address=self.runtime + 0x110, data=b"\x81")
        self.fake.store(address=self.runtime + 0x18, data=struct.pack("<4f", -2.0, 0.5, 3.0, 4.0))
        self.fake.store(address=self.source, data=mat_header())
        self.fake.store(address=0x30000, data=bytes(range(12)))
        self.registers = dict(x0=self.alignment + 0x7800, x1=self.source, x2=self.runtime + 0x18,
                              x29=self.frame, lr=0x123456789abc, w3=160, w4=160, w5=1, w6=0, w7=1,
                              s0_bits=0x3fc00000)

    def store_slots(self):
        self.fake.store(address=self.frame - 0x48, data=struct.pack("<6Q", *self.slots))

    def unpack(self):
        return memory.unpack_detection_call(read=self.fake.read, registers=self.registers)

    def select_branch(self, *, runtime=0, face=0, legacy=0, expansion=1.0, last=1):
        self.fake.store(address=self.runtime + 0x110, data=bytes([runtime]))
        self.fake.store(address=self.face + 0x24, data=bytes([face]))
        self.fake.store(address=self.face + 0x39, data=bytes([legacy]))
        self.fake.store(address=self.configs + 0xb, data=bytes([last]))
        self.registers.update(w5=1 if runtime & 1 else face & 1,
                              w6=0 if runtime & 1 else legacy & 1, w7=last & 1,
                              s0_bits=float_bits(value=expansion))

    def test_complete_runtime_branch_evidence_and_no_mutation(self):
        before = deepcopy((self.registers, self.fake.blocks))
        result = self.unpack()
        for key, value in dict(alignment=self.alignment, preprocessor=self.alignment + 0x7800,
                              input_parameter=self.input, configs=self.configs, face_config=self.face,
                              runtime_info=self.runtime, target=[160, 160], flags=[1, 0, 1], expansion=1.5,
                              expansion_bits=0x3fc00000, branch="runtime_1_5", format=2, orientation=3,
                              lr=self.registers["lr"], source_bytes=bytes(range(12))).items():
            self.assertEqual(result[key], value)
        self.assertEqual(result["source_mat"]["address"], self.source)
        self.assertEqual(result["rect"]["values"], [-2.0, 0.5, 3.0, 4.0])
        for field, address, size in (("target", self.alignment + 0x95c, 8),
                                     ("format_orientation", self.input + 0x18, 8),
                                     ("configs_0x0b", self.configs + 0xb, 1),
                                     ("face_config_0x24", self.face + 0x24, 1),
                                     ("face_config_0x39", self.face + 0x39, 1),
                                     ("runtime_info_0x110", self.runtime + 0x110, 1),
                                     ("caller_slots", self.frame - 0x48, 48)):
            self.assertEqual(result["raw"][field], dict(address=address, raw_hex=self.fake.blocks[address].hex()))
            self.assertIn((address, size), self.fake.calls)
        self.assertEqual((self.registers, self.fake.blocks), before)

    def test_face_config_branch_both_face_flags_and_last_flags(self):
        for face in (0, 1, 0xfe, 0xff):
            for last in (0, 1, 0xfe, 0xff):
                self.select_branch(runtime=0xfe, face=face, legacy=0xff, expansion=1.4, last=last)
                with self.subTest(face=face, last=last):
                    result = self.unpack()
                    self.assertEqual(result["branch"], "face_config_1_4")
                    self.assertEqual(result["flags"], [face & 1, 1, last & 1])
                    self.assertEqual(result["expansion_bits"], 0x3fb33333)

    def test_scale_enlarge_is_observed_not_guessed(self):
        for expansion in (0.0001, 1.0, 1.4, 1.5, 2.75, 4.0):
            for face in (0, 1):
                self.select_branch(runtime=0xfe, face=face, legacy=0xfe, expansion=expansion, last=0)
                with self.subTest(expansion=expansion, face=face):
                    result = self.unpack()
                    self.assertEqual(result["branch"], "ScaleEnlarge")
                    self.assertEqual(result["expansion_bits"], float_bits(value=expansion))
                    self.assertEqual(result["flags"], [face, 0, 0])

    def test_branch_mismatches_rejected_before_pixels(self):
        for branch in ("runtime", "legacy", "scale"):
            for field in ("w5", "w6", "w7"):
                self.select_branch(runtime=int(branch == "runtime"), face=1,
                                   legacy=int(branch == "legacy"), expansion=1.5 if branch == "runtime" else 1.4)
                self.registers[field] ^= 1
                with self.subTest(branch=branch, field=field):
                    self.assert_rejected_before_pixels()

    def assert_rejected_before_pixels(self):
        self.fake.calls.clear()
        with self.assertRaises(ValueError):
            self.unpack()
        self.assertFalse(any(address == self.source or address == 0x30000 for address, _ in self.fake.calls))

    def test_fixed_branch_requires_exact_expansion_bits(self):
        for runtime, expansion in ((1, 1.5), (0, 1.4)):
            self.select_branch(runtime=runtime, legacy=1, expansion=expansion)
            expected = self.registers["s0_bits"]
            for bits in (expected - 1, expected + 1, float_bits(value=1.0)):
                self.registers["s0_bits"] = bits
                with self.subTest(runtime=runtime, bits=bits):
                    self.assert_rejected_before_pixels()

    def test_invalid_scale_expansions_rejected(self):
        self.select_branch()
        for value in (0.0, -0.0, -1.0, 4.0001, float("inf"), -float("inf"), float("nan")):
            self.registers["s0_bits"] = float_bits(value=value)
            with self.subTest(value=value):
                self.assert_rejected_before_pixels()

    def test_missing_and_invalid_registers_rejected_without_reads(self):
        original = dict(self.registers)
        for name in memory.REGISTER_NAMES:
            bad_values = (None, True, 1.0, -1, (1 << 64) if name.startswith("x") or name == "lr" else (1 << 32))
            for value in bad_values:
                self.registers = dict(original, **{name: value})
                self.fake.calls.clear()
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    self.unpack()
                self.assertEqual(self.fake.calls, [])
            self.registers = {key: value for key, value in original.items() if key != name}
            with self.subTest(missing=name), self.assertRaises(ValueError):
                self.unpack()
        for value in (None, [], "registers"):
            with self.assertRaises(ValueError):
                memory.unpack_detection_call(read=self.fake.read, registers=value)

    def test_nonboolean_register_flags_rejected_without_reads(self):
        for field in ("w5", "w6", "w7"):
            original = self.registers[field]
            for value in (2, 255):
                self.registers[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.unpack()
            self.registers[field] = original
        self.assertEqual(self.fake.calls, [])

    def test_caller_identity_mismatches_fail_before_selected_reads(self):
        for field in ("x0", "x1", "x2", "x29"):
            original = self.registers[field]
            self.registers[field] += 8
            self.fake.calls.clear()
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.unpack()
            self.assertEqual(len(self.fake.calls), 1)
            self.registers[field] = original

    def test_invalid_slot_pointers_and_overflow_never_read_pixels(self):
        original = list(self.slots)
        for index in range(6):
            for value in (0, 4095, memory.MAX_ADDRESS):
                self.slots = list(original)
                self.slots[index] = value
                self.store_slots()
                with self.subTest(index=index, value=value):
                    self.assert_rejected_before_pixels()

    def test_frame_underflow_never_calls_reader(self):
        self.registers["x29"] = 4096
        with self.assertRaises(ValueError):
            self.unpack()
        self.assertEqual(self.fake.calls, [])

    def test_actual_targets_and_register_targets_must_both_be_160(self):
        for target in ((120, 120), (160, 120), (-160, 160), (0, 0)):
            self.fake.store(address=self.alignment + 0x95c, data=struct.pack("<2i", *target))
            with self.subTest(target=target):
                self.assert_rejected_before_pixels()
        self.fake.store(address=self.alignment + 0x95c, data=struct.pack("<2i", 160, 160))
        for field in ("w3", "w4"):
            self.registers[field] = 120
            with self.subTest(field=field):
                self.assert_rejected_before_pixels()
            self.registers[field] = 160

    def test_unknown_format_and_orientation_are_preserved_not_inferred(self):
        self.fake.store(address=self.input + 0x18, data=struct.pack("<2i", -2147483648, 2147483647))
        result = self.unpack()
        self.assertEqual((result["format"], result["orientation"]), (-2147483648, 2147483647))

    def test_raw_lr_is_not_masked_or_interpreted_as_branch(self):
        self.registers["lr"] = 0xf123456789abcdef
        self.assertEqual(self.unpack()["lr"], self.registers["lr"])

    def test_high_bit_memory_pointers_are_used_literally(self):
        shift = 0xa000000000000000
        self.fake.blocks = {address + shift: data for address, data in self.fake.blocks.items()}
        self.fake.store(address=self.frame - 0x48 + shift,
                        data=struct.pack("<6Q", *(address + shift for address in self.slots)))
        self.fake.store(address=self.source + shift, data=mat_header(data=0x30000 + shift))
        for name in ("x0", "x1", "x2", "x29", "lr"):
            self.registers[name] += shift
        result = self.unpack()
        self.assertEqual(result["alignment"], self.alignment + shift)
        self.assertEqual(result["source_mat"]["data"], 0x30000 + shift)
        self.assertEqual(result["source_bytes"], bytes(range(12)))
        self.assertTrue(all(address >= shift for address, _ in self.fake.calls))

    def test_detection_mat_failure_never_returns_partial_record(self):
        self.fake.store(address=self.source, data=mat_header(row_stride=10))
        with self.assertRaisesRegex(ValueError, "read failed"):
            self.unpack()
        self.assertEqual(self.fake.calls[-1], (0x30000 + 10, 6))

    def test_all_requests_within_bounds_and_reads_only_selected_fields(self):
        self.unpack()
        self.assertEqual(len(self.fake.calls), 10)
        for address, size in self.fake.calls:
            self.assertTrue(memory.MIN_ADDRESS <= address <= memory.MAX_ADDRESS)
            self.assertTrue(1 <= size <= memory.MAX_BLOB_BYTES)
            self.assertLessEqual(address + size - 1, memory.MAX_ADDRESS)

    def test_missing_selected_field_and_bad_rect_fail_closed(self):
        self.fake.store(address=self.face + 0x24, data=b"")
        self.assert_rejected_before_pixels()
        self.fake.store(address=self.face + 0x24, data=b"\x00")
        self.fake.store(address=self.runtime + 0x18, data=struct.pack("<4f", 0, 0, 0, 1))
        self.assert_rejected_before_pixels()


if __name__ == "__main__":
    unittest.main()
