"""Synthetic reshape registers and memory; no native runtime or debugger required."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

import face_live_reshape_points as points


def packed_bits(*, values):
    return list(struct.unpack(f"<{len(values)}I", struct.pack(f"<{len(values)}f", *values)))


def rounded(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


class ReshapeMemory:
    def __init__(self):
        self.row = dict(event="live_reshape_publication", prediction=1, timestamp_us=0,
            face_id=0, faces=1, candidate_injected=True, renderer_consumption=False,
            source_points_unchanged=True, binding_id=2, graph_id=3, thread=42,
            graph=0x10000, owned_base=0x20000, source_base=0x30000,
            owned_points=0x40000, source_points=0x50000)
        self.memory, self.reads, self.registers, self.scalars, self.vectors = {}, [], {}, {}, {}
        self.descriptor, self.destination, self.rules = 0x60000, 0x70000, 0x80000
        self.put(address=self.row["owned_base"] + 0x20, fmt="Q", values=[self.descriptor])
        self.put(address=self.descriptor + 0x10, fmt="QQ", values=[0x40000, 0x40000 + 848])
        self.put(address=self.row["owned_base"] + 0x40, fmt="i", values=[0])
        for base in (self.row["owned_points"], self.row["source_points"]):
            self.put(address=base, fmt="212f", values=[0.25, 0.6] * 106)

    def put(self, *, address, fmt, values):
        for offset, value in enumerate(struct.pack("<" + fmt, *values)):
            self.memory[address + offset] = value

    def read(self, *, address, size):
        self.reads.append((address, size))
        return bytes(self.memory[address + offset] for offset in range(size))

    def point(self, *, index, values):
        self.put(address=self.row["owned_points"] + index * 8, fmt="2f", values=values)

    def v5(self, *, index=0, source=(0.25, 0.6), width=640, height=480):
        self.point(index=index, values=source)
        x, y = (rounded(value=value) for value in source)
        self.expected = packed_bits(values=[rounded(value=x * width), rounded(value=(1.0 - y) * height)])
        self.registers = dict(x8=index << 32, x9=self.row["owned_points"],
            x12=self.row["owned_points"] + index * 8, x10=106 - index,
            x11=self.destination + index * 8 + 4)
        self.scalars = dict(s0=packed_bits(values=[x])[0], s8=packed_bits(values=[width])[0])
        self.vectors = dict(d12=struct.pack("<d", height))

    def v5_after(self, *, stored):
        index = self.registers["x8"] >> 32
        address = self.destination + index * 8
        self.put(address=address, fmt="2I", values=self.expected)
        self.registers["x11"] = address + (12 if stored else 4)
        self.scalars["s0"] = self.expected[1] if stored else struct.unpack(
            "<I", self.read(address=self.row["owned_points"] + index * 8 + 4, size=4))[0]

    def v6(self, *, index=74, output_index=0, rule_count=1):
        self.point(index=index, values=(0.3333333, 0.7))
        self.expected = [[0x442009b2, 0x443cf4f7], [0x44200cc4, 0x443ce9c4]]
        self.registers = dict(w12=index, x13=self.row["owned_points"], x8=output_index * 36,
            x9=output_index, x10=rule_count * 36, x11=self.rules + output_index * 36,
            x23=0x90000, x22=0x90008)
        self.put(address=self.registers["x11"], fmt="9f",
            values=[0, 0, 0.17, -0.43, 0.37, -0.29, index, 0, 0])
        self.vectors = {name: struct.pack("<2f", *values) for name, values in dict(
            v3=(0.3333333, 0.7), v9=(1920, 1080), v0=(0.31, -0.23), v2=(0.23, 0.31)).items()}
        for i, name in enumerate(("x23", "x22")):
            vector, begin = 0xa0000 + i * 0x1000, self.destination + i * 0x1000
            self.put(address=self.registers[name], fmt="Q", values=[vector])
            self.put(address=vector + 0x10, fmt="QQ", values=[begin, begin + rule_count * 8])

    def v6_after(self):
        for i, name in enumerate(("v7", "v17")):
            self.put(address=self.destination + i * 0x1000 + self.registers["x9"] * 8,
                fmt="2I", values=self.expected[i])
            self.vectors[name] = struct.pack("<2I", *self.expected[i])

    def install(self, *, case):
        case.enterContext(mock.patch.object(points, "register",
            side_effect=lambda **kw: self.registers[kw["name"]]))
        case.enterContext(mock.patch.object(points, "float_register_bits",
            side_effect=lambda **kw: self.scalars[kw["name"]]))
        case.enterContext(mock.patch.object(points, "register_bytes",
            side_effect=lambda **kw: self.vectors[kw["name"]][:kw["size"]]))


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "records.jsonl"
        self.row = ReshapeMemory().row

    def load(self, *, row=None, prediction=1):
        self.path.write_text(json.dumps(self.row if row is None else row) + "\n")
        return points.publication(path=self.path, prediction=prediction)

    def test_final_record_is_pinned_without_rewriting_file(self):
        payload = json.dumps(dict(event="setup")) + "\n" + json.dumps(self.row) + "\n"
        self.path.write_text(payload)
        self.assertEqual(points.publication(path=self.path, prediction=1), self.row)
        self.assertEqual(self.path.read_text(), payload)

    def test_event_cold_prediction_face_and_consumer_flags_are_pinned(self):
        changes = dict(event="live_reshape_exit", prediction=0, timestamp_us=1, face_id=1,
            faces=2, candidate_injected=False, renderer_consumption=True, source_points_unchanged=False)
        for key, value in changes.items():
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "isolated"):
                self.load(row=self.row | {key: value})
            with self.subTest(missing=key), self.assertRaisesRegex(ValueError, "isolated|scope"):
                self.load(row={name: value for name, value in self.row.items() if name != key})

    def test_caller_prediction_must_be_final_integer(self):
        for prediction in (0, 2, True, 1.0, "1", None):
            with self.subTest(prediction=prediction), self.assertRaisesRegex(ValueError, "isolated"):
                self.load(prediction=prediction)

    def test_attestation_flags_require_literal_booleans(self):
        for key in ("candidate_injected", "renderer_consumption", "source_points_unchanged"):
            for value in (int(self.row[key]), str(self.row[key]), None):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "isolated"):
                    self.load(row=self.row | {key: value})

    def test_publication_numeric_scope_rejects_boolean_or_float_impostors(self):
        for key in ("prediction", "timestamp_us", "face_id", "faces"):
            for value in (bool(self.row[key]), float(self.row[key])):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.load(row=self.row | {key: value})

    def test_binding_ids_require_positive_integers(self):
        for key in ("binding_id", "graph_id", "thread"):
            for value in (0, -1, True, 1.0, "1", None):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "identity"):
                    self.load(row=self.row | {key: value})

    def test_publication_pointers_are_bounded_aligned_integers(self):
        for key in ("graph", "owned_base", "source_base", "owned_points", "source_points"):
            for value in (0, 4095, 2**53, 8193, True, 8192.0, None):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "pointer"):
                    self.load(row=self.row | {key: value})

    def test_publication_rejects_alias_and_partial_overlap_in_both_directions(self):
        for offset in (0, 8, -8, 840, -840):
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, "aliased"):
                self.load(row=self.row | dict(source_points=self.row["owned_points"] + offset))
        with self.assertRaisesRegex(ValueError, "aliased"):
            self.load(row=self.row | dict(source_base=self.row["owned_base"]))

    def test_touching_nonoverlapping_spans_are_valid(self):
        for offset in (-848, 848):
            row = self.row | dict(source_points=self.row["owned_points"] + offset)
            self.assertEqual(self.load(row=row), row)

    def test_truncated_empty_or_oversized_journal_is_rejected(self):
        for data in (b"", b"{}", b"\n", b" " * 65 + b"\n"):
            self.path.write_bytes(data)
            with self.subTest(data=data), mock.patch.object(points, "RECORD_LIMIT", 64), \
                    self.assertRaises(ValueError):
                points.publication(path=self.path, prediction=1)

    def test_duplicate_fields_nonobjects_and_nonfinite_json_are_rejected(self):
        for payload in ('{"prediction":1,"prediction":1}', "[]", "null", '{"x":NaN}'):
            self.path.write_text(payload + "\n")
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                points.publication(path=self.path, prediction=1)

    def test_only_last_record_can_authorize_observation(self):
        self.path.write_text(json.dumps(self.row) + '\n{"event":"live_reshape_exit"}\n')
        with self.assertRaisesRegex(ValueError, "isolated|scope"):
            points.publication(path=self.path, prediction=1)


class PointArithmeticTests(unittest.TestCase):
    def setUp(self):
        self.memory = ReshapeMemory()
        self.memory.install(case=self)
        self.frame = mock.Mock()
        self.arguments = dict(frame=self.frame, read=self.memory.read, publication=self.memory.row)

    def start_v5(self, **options):
        self.memory.v5(**options)
        return points.v5_start(**self.arguments)

    def start_v6(self, **options):
        self.memory.v6(**options)
        return points.v6_start(**self.arguments)

    def test_v5_keeps_double_y_until_final_float32_rounding(self):
        pending = self.start_v5()
        self.assertEqual(pending["expected_bits"], [0x43200000, 0x433fffff])
        y = rounded(value=0.6)
        makeup_y = packed_bits(values=[rounded(value=480 - rounded(value=y * 480))])[0]
        self.assertEqual(makeup_y, 0x43400000)
        self.assertNotEqual(pending["expected_bits"][1], makeup_y)

    def test_v5_x_rounds_single_precision_and_y_preserves_boundary_values(self):
        for source, width, height in (((0, 0), 1, 1), ((1, 1), 4096, 4096),
                ((0.3333333, 0.9999999), 1920, 720), ((0.9, 0.8), 4095, 1080)):
            with self.subTest(source=source):
                pending = self.start_v5(source=source, width=width, height=height)
                self.assertEqual(pending["expected_bits"], self.memory.expected)

    def test_v5_first_and_last_points_pair_x_y_and_memory_stores(self):
        for index in (0, 105):
            with self.subTest(index=index):
                pending = self.start_v5(index=index)
                before = dict(self.memory.memory)
                for stored in (False, True):
                    self.memory.v5_after(stored=stored)
                    points.validate_v5(**self.arguments, pending=pending, stored=stored)
                begin = self.memory.row["owned_points"]
                self.assertEqual(bytes(before[begin+i] for i in range(848)), self.memory.read(address=begin, size=848))
                self.assertEqual(pending["destination"], self.memory.destination + index * 8)
        self.frame.EvaluateExpression.assert_not_called()

    def test_v5_bad_indices_load_registers_and_remaining_counts_fail(self):
        for key, value in (("x8", 1), ("x8", -2**32), ("x8", 106 << 32),
                ("x9", 0x50000), ("x12", 0x40008), ("x10", 105)):
            self.memory.v5()
            self.memory.registers[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                points.v5_start(**self.arguments)
        self.memory.v5()
        self.memory.scalars["s0"] += 1
        with self.assertRaisesRegex(ValueError, "X load"):
            points.v5_start(**self.arguments)

    def test_v5_dimensions_reject_nonfinite_fractional_zero_and_oversized(self):
        for value in (0, -1, 0.5, 4097, float("inf"), float("nan")):
            for name in ("s8", "d12"):
                self.memory.v5()
                if name == "s8":
                    self.memory.scalars[name] = packed_bits(values=[value])[0]
                else:
                    self.memory.vectors[name] = struct.pack("<d", value)
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    points.v5_start(**self.arguments)

    def test_source_rejects_foreign_face_span_and_unbounded_coordinates(self):
        for face, end, source in ((1, 848, (0.25, 0.6)), (0, 840, (0.25, 0.6)),
                (0, 856, (0.25, 0.6)), (0, 848, (-0.01, 0.6)),
                (0, 848, (0.25, 1.01)), (0, 848, (float("nan"), 0.6))):
            self.memory.v5(source=source if all(v == v for v in source) else (0.25, 0.6))
            self.memory.point(index=0, values=source)
            self.memory.put(address=self.memory.row["owned_base"] + 0x40, fmt="i", values=[face])
            self.memory.put(address=self.memory.descriptor + 0x10, fmt="QQ", values=[0x40000, 0x40000 + end])
            with self.subTest(face=face, end=end, source=source), self.assertRaises(ValueError):
                points.v5_start(**self.arguments)

    def test_v5_pending_scope_and_point_cannot_change(self):
        for key, value in (("x8", 1 << 32), ("x9", 0x50000), ("x12", 0x40008),
                ("x10", 105), ("x11", self.memory.destination + 16)):
            pending = self.start_v5()
            self.memory.v5_after(stored=True)
            self.memory.registers[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                points.validate_v5(**self.arguments, pending=pending, stored=True)
        pending = self.start_v5()
        self.memory.v5_after(stored=True)
        self.memory.point(index=0, values=(0.5, 0.6))
        with self.assertRaisesRegex(ValueError, "scope changed"):
            points.validate_v5(**self.arguments, pending=pending, stored=True)

    def test_v5_destination_span_cannot_overlap_either_source(self):
        for key in ("owned_points", "source_points"):
            for offset in (-840, 0, 840):
                pending = self.start_v5()
                pending["destination"] = self.memory.row[key] + offset
                with self.subTest(key=key, offset=offset), self.assertRaisesRegex(ValueError, "aliases"):
                    points.validate_v5(**self.arguments, pending=pending, stored=False)

    def test_v5_y_and_stored_register_or_memory_single_bit_errors_fail(self):
        for stored in (False, True):
            for corrupt in ("register", "memory"):
                pending = self.start_v5()
                self.memory.v5_after(stored=stored)
                if corrupt == "register":
                    self.memory.scalars["s0"] ^= 1
                else:
                    self.memory.memory[self.memory.destination] ^= 1
                with self.subTest(stored=stored, corrupt=corrupt), self.assertRaisesRegex(ValueError, "mismatch"):
                    points.validate_v5(**self.arguments, pending=pending, stored=stored)

    def test_v6_rule_arithmetic_rounds_each_multiply_and_add(self):
        pending = self.start_v6()
        self.assertEqual(pending["expected_bits"], self.memory.expected)
        source, shift, perpendicular = (struct.unpack("<2f", self.memory.vectors[name]) for name in ("v3", "v0", "v2"))
        rules = struct.unpack("<9f", self.memory.read(address=self.memory.rules, size=36))
        unrounded = packed_bits(values=[source[0] * 1920 + shift[0] * rules[2] - perpendicular[0] * rules[3]])[0]
        self.assertEqual(unrounded, 0x442009b3)
        self.assertNotEqual(pending["expected_bits"][0][0], unrounded)

    def test_v6_selected_landmarks_first_and_last_output_are_valid(self):
        for index, output_index, rule_count in ((77, 0, 1), (74, 1, 2), (0, 255, 256), (105, 0, 1)):
            with self.subTest(index=index, output_index=output_index):
                pending = self.start_v6(index=index, output_index=output_index, rule_count=rule_count)
                self.memory.v6_after()
                destinations = points.validate_v6(**self.arguments, pending=pending)
                self.assertEqual(destinations, [self.memory.destination + i * 0x1000 + output_index * 8 for i in range(2)])

    def test_v6_register_identity_rule_offsets_and_span_bounds_fail(self):
        for key, value in (("w12", -1), ("w12", 106), ("x13", 0x50000), ("x8", 1),
                ("x9", -1), ("x9", 256), ("x10", 0), ("x10", 37), ("x10", 257 * 36),
                ("x11", 0), ("x11", self.memory.rules + 1)):
            self.memory.v6()
            self.memory.registers[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                points.v6_start(**self.arguments)

    def test_v6_bad_vector_or_rule_values_are_rejected(self):
        for name, values in (("v3", (0.5, 0.7)), ("v9", (0, 1080)), ("v9", (4097, 1080)),
                ("v9", (1920, 1.5)), ("v0", (32769, 0)), ("v2", (float("nan"), 0))):
            self.memory.v6()
            self.memory.vectors[name] = struct.pack("<2f", *values)
            with self.subTest(name=name, values=values), self.assertRaises(ValueError):
                points.v6_start(**self.arguments)
        for index, value in ((6, 75), (6, 74.5), (2, 4097), (3, float("inf"))):
            self.memory.v6()
            self.memory.put(address=self.memory.rules + index * 4, fmt="f", values=[value])
            with self.subTest(index=index, value=value), self.assertRaises(ValueError):
                points.v6_start(**self.arguments)

    def test_v6_pending_source_rules_and_identity_cannot_change(self):
        for corrupt in ("source", "rules", "x8", "x9", "x10", "x23", "x22"):
            pending = self.start_v6()
            self.memory.v6_after()
            if corrupt in ("source", "rules"):
                address = self.memory.rules if corrupt == "rules" else self.memory.row["owned_points"] + 74 * 8
                self.memory.memory[address] ^= 1
            else:
                self.memory.registers[corrupt] += 8
            with self.subTest(corrupt=corrupt), self.assertRaises(ValueError):
                points.validate_v6(**self.arguments, pending=pending)

    def test_v6_each_stored_word_and_register_must_match_expected_bits(self):
        for channel in range(2):
            for word in range(2):
                for corrupt in ("memory", "register"):
                    pending = self.start_v6()
                    self.memory.v6_after()
                    if corrupt == "memory":
                        self.memory.memory[self.memory.destination + channel * 0x1000 + word * 4] ^= 1
                    else:
                        changed = list(self.memory.expected[channel])
                        changed[word] ^= 1
                        self.memory.vectors[("v7", "v17")[channel]] = struct.pack("<2I", *changed)
                    with self.subTest(channel=channel, word=word, corrupt=corrupt), self.assertRaisesRegex(ValueError, "stored"):
                        points.validate_v6(**self.arguments, pending=pending)

    def test_v6_invalid_or_source_aliasing_output_spans_fail(self):
        for begin, size in ((0, 8), (self.memory.destination, 0), (self.memory.destination, -8),
                (self.memory.destination, 9), (self.memory.destination, 257 * 8),
                (0x40000, 8), (0x40000 - 8, 16), (0x50000 + 840, 16)):
            pending = self.start_v6()
            self.memory.v6_after()
            self.memory.put(address=0xa0010, fmt="QQ", values=[begin, begin + size])
            with self.subTest(begin=begin, size=size), self.assertRaises(ValueError):
                points.validate_v6(**self.arguments, pending=pending)

    def test_v6_output_index_must_fit_both_destination_spans(self):
        pending = self.start_v6(output_index=1, rule_count=2)
        self.memory.v6_after()
        self.memory.put(address=0xa1010, fmt="QQ",
            values=[self.memory.destination + 0x1000, self.memory.destination + 0x1000 + 8])
        with self.assertRaisesRegex(ValueError, "output span"):
            points.validate_v6(**self.arguments, pending=pending)

    def aliasing_v6(self, *, offset):
        self.memory.v6(rule_count=2)
        self.memory.put(address=self.memory.rules + 8, fmt="4f", values=[0, 0, 0, 0])
        pending = points.v6_start(**self.arguments)
        xy = packed_bits(values=[rounded(value=rounded(value=0.3333333) * 1920),
            rounded(value=rounded(value=0.7) * 1080)])
        self.memory.expected = [xy, xy]
        self.memory.v6_after()
        begin = self.memory.destination + offset
        self.memory.put(address=0xa1010, fmt="QQ", values=[begin, begin + 16])
        self.memory.put(address=begin, fmt="2I", values=xy)
        return pending

    def test_v6_equal_values_do_not_authorize_same_output_destination(self):
        pending = self.aliasing_v6(offset=0)
        with self.assertRaisesRegex(ValueError, "alias"):
            points.validate_v6(**self.arguments, pending=pending)

    def test_v6_output_buffers_cannot_partially_overlap(self):
        for offset in (-8, 8):
            pending = self.aliasing_v6(offset=offset)
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, "alias"):
                points.validate_v6(**self.arguments, pending=pending)

    def test_v6_adjacent_disjoint_output_buffers_remain_valid(self):
        for offset in (-16, 16):
            pending = self.aliasing_v6(offset=offset)
            self.assertEqual(points.validate_v6(**self.arguments, pending=pending),
                [self.memory.destination, self.memory.destination + offset])


class RawRegisterTests(unittest.TestCase):
    def test_register_bytes_accepts_only_complete_64_or_128_bit_reads(self):
        frame, error = mock.Mock(), mock.Mock()
        error.Fail.return_value = False
        value = frame.FindRegister.return_value
        value.IsValid.return_value = True
        value.GetData.return_value.ReadRawData.side_effect = lambda err, offset, size: bytes(range(size))
        with mock.patch.dict("sys.modules", {"lldb": mock.Mock(SBError=mock.Mock(return_value=error))}):
            for size in (8, 16):
                self.assertEqual(points.register_bytes(frame=frame, name="v3", size=size), bytes(range(size)))
            for size in (0, 4, 32):
                with self.subTest(size=size), self.assertRaisesRegex(ValueError, "missing"):
                    points.register_bytes(frame=frame, name="v3", size=size)
            value.GetData.return_value.ReadRawData.side_effect = None
            value.GetData.return_value.ReadRawData.return_value = b"short"
            with self.assertRaisesRegex(ValueError, "unreadable"):
                points.register_bytes(frame=frame, name="v3", size=8)
            value.GetData.return_value.ReadRawData.return_value = b"12345678"
            error.Fail.return_value = True
            with self.assertRaisesRegex(ValueError, "unreadable"):
                points.register_bytes(frame=frame, name="v3", size=8)
            value.IsValid.return_value = False
            with self.assertRaisesRegex(ValueError, "missing"):
                points.register_bytes(frame=frame, name="v3", size=8)

    def test_nonfinite_words_rejected_and_negative_zero_bits_preserved(self):
        self.assertEqual(points.bits(values=points.values(words=[0x80000000, 0x3f800000])), [0x80000000, 0x3f800000])
        for word in (0x7f800000, 0xff800000, 0x7fc00000):
            with self.subTest(word=word), self.assertRaisesRegex(ValueError, "nonfinite"):
                points.values(words=[word])


if __name__ == "__main__":
    unittest.main()
