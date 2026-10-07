from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_input import alignment_matrix, load_mean_face, prepare_input  # noqa: E402


class FittingInputTests(unittest.TestCase):
    def setUp(self):
        self.mean = np.random.default_rng(17).uniform(30, 220, (106, 2)).astype(np.float32)

    def test_canonical_points_preserve_their_order(self):
        result = prepare_input(points=self.mean, mean=self.mean)
        np.testing.assert_allclose(result["matrix"], np.array([[1, 0, 0], [0, 1, 0]], np.float32), atol=1e-7, rtol=0)
        np.testing.assert_array_equal(result["input"], (self.mean / 128 - 1).reshape(1, 212))

    def test_translation_scale_and_rotation_are_removed(self):
        angle = 0.4
        rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
        source = np.float32(self.mean @ rotation.T * 1.7 + [300, 180])
        result = prepare_input(points=source, mean=self.mean)
        np.testing.assert_allclose(result["aligned"], self.mean, atol=0.0002, rtol=0)

    def test_rejects_invalid_points(self):
        invalid = (np.zeros((105, 2)), np.zeros((106, 3)), np.full((106, 2), np.nan),
                   np.full((106, 2), np.inf), np.full((106, 2), 2e6))
        for points in invalid:
            with self.subTest(shape=points.shape), self.assertRaises(ValueError):
                prepare_input(points=points, mean=self.mean)

    def test_rejects_degenerate_source(self):
        with self.assertRaises(ValueError):
            alignment_matrix(points=np.zeros((106, 2)), mean=self.mean)

    def test_rejects_singular_target(self):
        with self.assertRaises(ValueError):
            alignment_matrix(points=self.mean, mean=np.zeros((106, 2)))

    def test_does_not_mutate_input(self):
        original = self.mean.copy()
        prepare_input(points=self.mean, mean=self.mean)
        np.testing.assert_array_equal(self.mean, original)

    def test_rejects_unpinned_model(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "bad.model"
            model.write_bytes(b"wrong")
            with self.assertRaisesRegex(ValueError, "size"):
                load_mean_face(model=model)
            model.write_bytes(bytes(3_354_200))
            with self.assertRaisesRegex(ValueError, "identity"):
                load_mean_face(model=model)


if __name__ == "__main__":
    unittest.main()
