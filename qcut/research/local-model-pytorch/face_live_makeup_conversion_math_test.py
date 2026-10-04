"""Synthetic CPU math tests only; no native reads or rendering acceptance."""
from __future__ import annotations

import copy
from fractions import Fraction
import random
import struct
import unittest

from face_live_makeup_conversion_math import audit_conversion


def word(*, value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def exact(*, bits):
    exponent = (bits >> 23) & 0xFF
    significand = bits & 0x7FFFFF
    if exponent:
        significand |= 1 << 23
    sign = -1 if bits & 0x80000000 else 1
    return sign * significand * Fraction(2) ** (exponent - 150 if exponent else -149)


def rounded_word(*, value):
    """Independent exact-rational nearest-even oracle for [0, 4096]."""
    low, high = 0, 0x45800000
    while low < high:
        middle = (low + high + 1) // 2
        if exact(bits=middle) <= value:
            low = middle
        else:
            high = middle - 1
    lower = exact(bits=low)
    if lower == value:
        return low
    lower_distance = value - lower
    upper_distance = exact(bits=low + 1) - value
    if lower_distance < upper_distance:
        return low
    if lower_distance > upper_distance:
        return low + 1
    return low + (low & 1)


def fixture(*, source=None, width=640, height=480):
    if source is None:
        source = [[word(value=(index + 1) / 128), word(value=(106 - index) / 128)]
                  for index in range(106)]
    destination = []
    for x, y in source:
        expected_x = rounded_word(value=exact(bits=x) * width)
        if x == 0x80000000:
            expected_x = 0x80000000
        product_y = rounded_word(value=exact(bits=y) * height)
        expected_y = rounded_word(value=height - exact(bits=product_y))
        destination.append([expected_x, expected_y])
    return dict(source_bits=source, destination_bits=destination, width=width, height=height)


class ConversionMathTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()

    def reject_values(self, *, path, values, pattern=None):
        for value in values:
            data = copy.deepcopy(self.data)
            parent = data
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            before = copy.deepcopy(data)
            with self.subTest(path=path, value=value):
                with self.assertRaisesRegex(ValueError, pattern or ".+"):
                    audit_conversion(**data)
                self.assertEqual(data, before)

    def test_complete_conversion_has_only_narrow_claims_and_no_mutation(self):
        before = copy.deepcopy(self.data)
        self.assertEqual(audit_conversion(**self.data), dict(
            schema="face-live-makeup-conversion-math-v1", point_count=106,
            width=640, height=480, cpu_conversion_math_verified=True,
            target_reads_verified=False, provenance_verified=False,
            renderer_consumption=False, product_parity_verified=False,
        ))
        self.assertEqual(self.data, before)

    def test_keyword_only_api_and_required_arguments(self):
        with self.assertRaises(TypeError):
            audit_conversion(self.data["source_bits"], self.data["destination_bits"], 640, 480)
        for key in self.data:
            data = {name: value for name, value in self.data.items() if name != key}
            with self.subTest(key=key), self.assertRaises(TypeError):
                audit_conversion(**data)
        with self.assertRaises(TypeError):
            audit_conversion(**self.data, target_reads_verified=True)

    def test_dimensions_are_bounded_non_boolean_integers(self):
        for key in ("width", "height"):
            self.reject_values(path=(key,), values=(
                0, -1, 4097, 2**1000, True, False, 1.0, 4096.0, "640", None, [], {},
                float("inf"), float("-inf"),
            ))
            with self.assertRaises(ValueError):
                audit_conversion(**{**self.data, key: float("nan")})

    def test_dimension_extremes_rectangles_and_odd_sizes(self):
        for width, height in ((1, 1), (1, 4096), (4096, 1), (4096, 4096),
                              (3, 127), (641, 4095), (1280, 720)):
            with self.subTest(width=width, height=height):
                proof = audit_conversion(**fixture(width=width, height=height))
                self.assertEqual((proof["width"], proof["height"]), (width, height))

    def test_point_containers_and_exact_count(self):
        for key in ("source_bits", "destination_bits"):
            points = self.data[key]
            self.reject_values(path=(key,), values=(None, True, {}, "points", tuple(points),
                [], points[:1], points[:105], points + [points[0]], points * 2))

    def test_each_pair_must_be_a_two_element_list(self):
        for key in ("source_bits", "destination_bits"):
            for index in (0, 53, 105):
                self.reject_values(path=(key, index), values=(None, True, {}, 0,
                    "xy", [], [0], [0, 0, 0], (0, 0), bytes(8)))

    def test_word_types_and_uint32_bounds_on_both_axes(self):
        for key in ("source_bits", "destination_bits"):
            for index in (0, 105):
                for axis in (0, 1):
                    self.reject_values(path=(key, index, axis), values=(
                        True, False, -1, 2**32, 2**1000, 0.0, 1.0, "0", None, [], {},
                    ))

    def test_builtin_container_and_integer_subclasses_are_rejected(self):
        class IntSubclass(int):
            pass

        class ListSubclass(list):
            pass

        for key in ("source_bits", "destination_bits"):
            self.reject_values(path=(key,), values=(ListSubclass(self.data[key]),))
            self.reject_values(path=(key, 0), values=(ListSubclass(self.data[key][0]),))
            self.reject_values(path=(key, 0, 0), values=(IntSubclass(self.data[key][0][0]),))
        for key in ("width", "height"):
            self.reject_values(path=(key,), values=(IntSubclass(self.data[key]),))

    def test_infinities_and_nan_payloads_in_either_input(self):
        for key in ("source_bits", "destination_bits"):
            for axis in (0, 1):
                self.reject_values(path=(key, 105, axis), values=(
                    0x7F800000, 0xFF800000, 0x7FC00000, 0xFFC00000,
                    0x7F800001, 0xFF800001, 0x7FFFFFFF, 0xFFFFFFFF,
                ), pattern="finite float32")

    def test_sources_must_be_normalized_without_clamping(self):
        for axis in (0, 1):
            self.reject_values(path=("source_bits", 105, axis), values=(
                0x80000001, 0x80800000, 0xBF000000, 0xBF800000,
                0x3F800001, 0x40000000, 0x7F7FFFFF, 0xFF7FFFFF,
            ), pattern=r"normalized \[0, 1\]")

    def test_signed_zero_endpoints_and_axis_geometry(self):
        source = [[0, 0], [0x80000000, 0x80000000],
                  [0x3F800000, 0x3F800000], [0x3F000000, 0x3E800000]]
        destination = [[0, 0x40E00000], [0x80000000, 0x40E00000],
                       [0x40400000, 0], [0x3FC00000, 0x40A80000]]
        data = dict(source_bits=[source[index % 4][:] for index in range(106)],
                    destination_bits=[destination[index % 4][:] for index in range(106)],
                    width=3, height=7)
        self.assertIs(audit_conversion(**data)["cpu_conversion_math_verified"], True)
        for index, axis in ((0, 0), (1, 0), (2, 1)):
            changed = copy.deepcopy(data)
            changed["destination_bits"][index][axis] ^= 0x80000000
            with self.subTest(index=index, axis=axis), self.assertRaises(ValueError):
                audit_conversion(**changed)

    def test_negative_destinations_are_not_compared_by_absolute_value(self):
        for axis in (0, 1):
            value = self.data["destination_bits"][0][axis]
            self.reject_values(path=("destination_bits", 0, axis),
                               values=(value | 0x80000000, 0xFF7FFFFF))

    def test_every_destination_word_is_compared_exactly(self):
        for index in range(106):
            for axis in (0, 1):
                value = self.data["destination_bits"][index][axis]
                self.reject_values(path=("destination_bits", index, axis),
                                   values=(value ^ 1,), pattern="conversion mismatch")

    def test_order_axis_and_duplicate_mismatches(self):
        for key in ("source_bits", "destination_bits"):
            for first, second in ((0, 1), (0, 105), (104, 105)):
                data = copy.deepcopy(self.data)
                data[key][first], data[key][second] = data[key][second], data[key][first]
                with self.subTest(key=key, first=first, second=second), self.assertRaises(ValueError):
                    audit_conversion(**data)
            self.reject_values(path=(key, 105), values=(self.data[key][0],))
            self.reject_values(path=(key, 0), values=(self.data[key][0][::-1],))

    def test_joint_reordering_does_not_establish_landmark_provenance(self):
        for key in ("source_bits", "destination_bits"):
            self.data[key].reverse()
        proof = audit_conversion(**self.data)
        self.assertIs(proof["cpu_conversion_math_verified"], True)
        self.assertIs(proof["provenance_verified"], False)
        self.assertIs(proof["target_reads_verified"], False)

    def test_changed_dimensions_reject_stale_conversion(self):
        for key in ("width", "height"):
            self.reject_values(path=(key,), values=(self.data[key] + 1,))

    def test_y_product_rounding_cannot_be_elided_or_reassociated(self):
        data = dict(source_bits=[[0, 0x3E601B43] for _ in range(106)],
                    destination_bits=[[0, 0x4015FAE4] for _ in range(106)], width=1, height=3)
        self.assertIs(audit_conversion(**data)["cpu_conversion_math_verified"], True)
        y = struct.unpack("<f", struct.pack("<I", 0x3E601B43))[0]
        elided = word(value=3 - y * 3)
        one_minus_y = struct.unpack("<f", struct.pack("<f", 1 - y))[0]
        reassociated = word(value=one_minus_y * 3)
        self.assertEqual(elided, 0x4015FAE3)
        self.assertEqual(reassociated, elided)
        data["destination_bits"][105][1] = elided
        with self.assertRaisesRegex(ValueError, r"\[105\]\[1\].*0x4015fae4.*0x4015fae3"):
            audit_conversion(**data)

    def test_ties_to_even_and_subnormals_have_literal_expectations(self):
        source = [[0x3F000001, 0], [0x3F000003, 0], [1, 1], [0x80000000, 0]]
        destination = [[0x3FC00002, 0x40400000], [0x3FC00004, 0x40400000],
                       [3, 0x40400000], [0x80000000, 0x40400000]]
        data = dict(source_bits=[source[index % 4][:] for index in range(106)],
                    destination_bits=[destination[index % 4][:] for index in range(106)],
                    width=3, height=3)
        self.assertIs(audit_conversion(**data)["cpu_conversion_math_verified"], True)
        data["destination_bits"][2][0] = 0
        with self.assertRaises(ValueError):
            audit_conversion(**data)

    def test_exact_rational_oracle_across_float32_boundaries(self):
        generator = random.Random(106)
        edges = [0, 1, 2, 0x007FFFFE, 0x007FFFFF, 0x00800000, 0x00800001,
                 0x3EFFFFFF, 0x3F000000, 0x3F000001, 0x3F7FFFFE, 0x3F7FFFFF, 0x3F800000]
        words = edges + [generator.randrange(0x3F800001) for _ in range(106 - len(edges))]
        source = [[bits, words[105 - index]] for index, bits in enumerate(words)]
        for width, height in ((1, 4096), (4096, 1), (3, 3), (127, 641), (4095, 4095)):
            with self.subTest(width=width, height=height):
                self.assertIs(audit_conversion(**fixture(source=source, width=width, height=height))
                              ["cpu_conversion_math_verified"], True)

    def test_aliasing_inputs_is_read_only_and_not_native_evidence(self):
        point = [0x3F000000, 0x3F000000]
        points = [point] * 106
        proof = audit_conversion(source_bits=points, destination_bits=points, width=1, height=1)
        self.assertIs(proof["target_reads_verified"], False)
        self.assertEqual(point, [0x3F000000, 0x3F000000])
        self.assertTrue(all(pair is point for pair in points))


if __name__ == "__main__":
    unittest.main()
