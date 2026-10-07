from pathlib import Path
import struct
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_geometry import MM_SIZE, decode_morphable_model, reconstruct


def synthetic_payload():
    data = bytearray(MM_SIZE)
    struct.pack_into('<9If', data, 2, 956964, 3, 1834, 221, 30, 51, 9168, 82, 1, 2800.0)
    basis = np.ndarray((82, 1834, 3), '<i2', buffer=data, offset=42)
    basis[0] = np.arange(1834 * 3, dtype=np.int16).reshape(1834, 3) % 3000
    basis[1, :, 0] = 280
    basis[31, :, 1] = -560
    np.ndarray(221, '<f4', buffer=data, offset=2 + 902368)[:] = 1
    np.ndarray(30, '<f4', buffer=data, offset=2 + 903252)[:] = 1
    data[2 + 921708:2 + 921708 + 50 * 52] = (b'synthetic\0' + bytes(40)) * 52
    struct.pack_into('<5I', data, 2 + 937212, 1612, 1611, 790, 20, 4416)
    return data


class MorphableModelTests(unittest.TestCase):
    def test_quantization_landmark_tail_and_coefficient_partitions(self):
        model = decode_morphable_model(payload=synthetic_payload())
        expected = np.float32(280) * np.float32(1 / 2800)
        np.testing.assert_array_equal(model.basis[1, :, 0], expected)
        np.testing.assert_array_equal(model.landmark_basis, model.basis[:, -221:])
        self.assertEqual(len(model.expression_names), 52)
        self.assertEqual(model.coefficient_weights[0], 0)
        np.testing.assert_array_equal(model.coefficient_weights[1:31], np.sqrt(np.float32(0.5 / 30)))
        np.testing.assert_array_equal(model.coefficient_weights[31:], np.sqrt(np.float32(5 / 51)))

    def test_reconstruction_combines_identity_and_expression_without_mutation(self):
        model = decode_morphable_model(payload=synthetic_payload())
        coefficients = np.zeros(82, np.float32)
        coefficients[[0, 1, 31]] = [1, 2, 0.5]
        original = coefficients.copy()
        result = reconstruct(model=model, coefficients=coefficients)
        expected = model.basis[0].astype(np.float64) + 2 * model.basis[1] + 0.5 * model.basis[31]
        np.testing.assert_allclose(result['vertices'], expected, atol=1e-7)
        np.testing.assert_array_equal(result['landmarks'], result['vertices'][-221:])
        np.testing.assert_array_equal(coefficients, original)
        for value in (model.basis, model.landmark_basis, model.uv):
            self.assertFalse(value.flags.writeable)
        result['vertices'][0] = 0
        self.assertTrue(model.basis[0, 0, 1] != 0)

    def test_rejects_wrong_envelope_layout_and_truncation(self):
        valid = synthetic_payload()
        for change in (lambda b: b.__setitem__(0, 1), lambda b: struct.pack_into('<I', b, 6, 4),
                       lambda b: struct.pack_into('<I', b, 2 + 937212, 0)):
            data = valid.copy()
            change(data)
            with self.assertRaises(ValueError):
                decode_morphable_model(payload=data)
        for data in (valid[:-1], valid + b'\0'):
            with self.assertRaises(ValueError):
                decode_morphable_model(payload=data)

    def test_rejects_nonfinite_weights_bad_names_and_out_of_range_indices(self):
        for offset, fmt, value in ((2 + 902368, '<f', np.nan), (2 + 902368, '<f', 0),
                                   (2 + 903252, '<f', -1), (2 + 903372, '<H', 1613),
                                   (2 + 937232 + 4740, '<H', 790), (2 + 921708, 'B', 255)):
            data = synthetic_payload()
            struct.pack_into(fmt, data, offset, value)
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                decode_morphable_model(payload=data)

    def test_rejects_invalid_coefficient_shape_type_neutral_and_bounds(self):
        model = decode_morphable_model(payload=synthetic_payload())
        valid = np.r_[np.float32(1), np.zeros(81, np.float32)]
        for coefficients in (valid.astype(np.float64), valid.reshape(1, 82), valid[:-1],
                             np.zeros(82, np.float32), np.full(82, np.nan, np.float32),
                             np.r_[np.float32(1), np.full(81, 101, np.float32)]):
            with self.assertRaises(ValueError):
                reconstruct(model=model, coefficients=coefficients)


if __name__ == '__main__':
    unittest.main()
