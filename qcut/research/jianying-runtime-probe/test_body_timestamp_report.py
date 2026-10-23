"""Reject changed local artifacts rather than trusting their saved hashes."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from body_timestamp_report import difference, frame_record, verified_bytes


class TimestampReportTests(unittest.TestCase):
    def test_tensor_receipt_requires_length_and_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'tensor.bin'
            path.write_bytes(b'abc')
            receipt = {'file': path.name, 'bytes': 3, 'sha256': hashlib.sha256(b'abc').hexdigest()}
            self.assertEqual(verified_bytes(root=root, value=receipt), b'abc')
            path.write_bytes(b'abd')
            with self.assertRaises(ValueError):
                verified_bytes(root=root, value=receipt)
            path.write_bytes(b'ab')
            with self.assertRaises(ValueError):
                verified_bytes(root=root, value=receipt)

    def test_frame_hash_cannot_authorize_wrong_dimensions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = bytes((10, 20, 30, 255))
            (root / 'frame0.rgba').write_bytes(data)
            value = {'frame': 0, 'resultSha256': hashlib.sha256(data).hexdigest()}
            self.assertEqual(frame_record(root=root, value=value, pixels=1), data)
            with self.assertRaises(ValueError):
                frame_record(root=root, value=value, pixels=2)

    def test_pixel_difference_keeps_rgb_and_alpha_semantics_separate(self):
        actual = bytes((13, 20, 30, 255, 0, 0, 0, 100))
        expected = bytes((10, 20, 30, 255, 0, 0, 0, 101))
        result = difference(actual=actual, expected=expected)
        self.assertFalse(result['exact'])
        self.assertEqual(result['rgbMeanAbsoluteError'], .5)
        self.assertEqual(result['maximumChannelError'], 3)
        self.assertEqual(result['differentPixels'], 2)


if __name__ == '__main__':
    unittest.main()
