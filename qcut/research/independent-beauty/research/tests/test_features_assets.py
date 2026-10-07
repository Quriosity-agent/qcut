from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features_assets import load_assets, validate_assets


class FeaturesAssetsTests(unittest.TestCase):
    def test_pinned_table_is_private_read_only_and_rejects_tampering(self):
        path = Path(__file__).resolve().parents[2] / 'runtime/research/features-corners-v1.npz'
        assets = load_assets(path=path)
        coefficients = assets['mouth_corner']
        self.assertFalse(coefficients.flags.writeable)
        np.testing.assert_array_equal(coefficients[:, 0], np.arange(84, 104, dtype=np.float32))
        changed = coefficients.copy()
        changed[0, 1] += .01
        with self.assertRaises(ValueError):
            validate_assets(values={'mouth_corner': changed})
        with self.assertRaises(ValueError):
            validate_assets(values={**assets, 'capture': np.zeros(1)})


if __name__ == '__main__':
    unittest.main()
