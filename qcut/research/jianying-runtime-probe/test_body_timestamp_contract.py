"""No-model contracts for the bounded timestamp experiment."""
import hashlib
import tempfile
from pathlib import Path
import unittest

from body_timestamp_contract import CASES, native_microseconds, source_identity


class TimestampContractTests(unittest.TestCase):
    def test_variants_share_prefix_and_keep_backwards_nonnegative(self):
        self.assertEqual({tuple(values[:3]) for values in CASES.values()}, {(0, 1 / 30, 2 / 30)})
        self.assertTrue(all(value >= 0 for values in CASES.values() for value in values))
        self.assertLess(CASES['backward'][3], CASES['backward'][2])

    def test_microseconds_match_positive_llround_not_bankers_round(self):
        self.assertEqual(native_microseconds(value=.0000005), 1)
        self.assertEqual(native_microseconds(value=1 / 30), 33333)
        self.assertEqual(native_microseconds(value=2 / 30), 66667)
        for value in (True, -1, float('nan'), float('inf'), 86400):
            with self.subTest(value=value), self.assertRaises(ValueError):
                native_microseconds(value=value)

    def test_source_hash_size_and_opacity_are_required(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / 'source.rgba'
            raw = bytes((10, 20, 30, 255)) * 16 * 16
            path.write_bytes(raw)
            manifest = {'width': 16, 'height': 16, 'inputs': {str(path): hashlib.sha256(raw).hexdigest()}}
            self.assertEqual(source_identity(manifest=manifest)['path'], str(path.resolve()))
            path.write_bytes(raw[:-1])
            with self.assertRaises(ValueError):
                source_identity(manifest=manifest)
            path.write_bytes(bytes(len(raw)))
            manifest['inputs'][str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                source_identity(manifest=manifest)


if __name__ == '__main__':
    unittest.main()
