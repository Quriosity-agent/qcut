"""Fixture-only checks; no native runtime or model inference."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

import face_live_validation_fixtures as fixtures


class FixtureTests(unittest.TestCase):
    def image_bytes(self, *, size, color=(200, 20, 40, 255)):
        stream = io.BytesIO()
        Image.new("RGBA", size, color).save(stream, format="PNG")
        return stream.getvalue()

    def test_square_preserves_aspect_ratio_and_explicit_padding(self):
        result, transform = fixtures.normalized_image(data=self.image_bytes(size=(512, 512)))
        self.assertEqual(result.size, (1448, 1086))
        self.assertEqual(transform["scaled_size"], [1086, 1086])
        self.assertEqual(transform["offset"], [181, 0])
        self.assertEqual(result.getpixel((0, 0)), (96, 96, 96, 255))
        self.assertEqual(result.getpixel((181, 0)), (200, 20, 40, 255))

    def test_wide_preserves_aspect_ratio(self):
        result, transform = fixtures.normalized_image(data=self.image_bytes(size=(1600, 400)))
        self.assertEqual(transform["scaled_size"], [1448, 362])
        self.assertEqual(transform["offset"], [0, 362])
        self.assertEqual(result.size, fixtures.DIMENSIONS)

    def test_alpha_is_composited_to_opaque_input(self):
        result, _ = fixtures.normalized_image(data=self.image_bytes(size=(8, 8), color=(200, 20, 40, 0)))
        self.assertEqual(result.getpixel((724, 543)), (96, 96, 96, 255))

    def test_existing_fixture_builder_and_feature_contracts_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / "source.png"
            data = self.image_bytes(size=(32, 32))
            source.write_bytes(data)
            with patch.object(fixtures.sequence, "PRIVATE", root):
                report = fixtures.build(image=source, out=root / "fixture")
                for feature, path in report["manifests"].items():
                    manifest = Path(path)
                    frames = fixtures.sequence.validate_manifest(
                        value=json.loads(manifest.read_bytes()), base=manifest.parent)
                    self.assertEqual(len(frames), 7)
                    self.assertEqual([row["parameters"][feature][0]["intensity"] for row in frames],
                                     [1, 1, 1, 1, 1, 0, .5])
                    self.assertEqual([row["expect_change"] for row in frames], [True, True, True, False, True, False, True])
                self.assertEqual(source.read_bytes(), data)
                self.assertEqual(report["source_sha256"], fixtures.digest(data=data))
                with self.assertRaises((ValueError, FileExistsError)):
                    fixtures.build(image=source, out=root / "fixture")


if __name__ == "__main__":
    unittest.main()
