import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SPEC = importlib.util.spec_from_file_location(
    "portrait_face_shape_gallery",
    Path(__file__).parents[1] / "create-portrait-face-shape-gallery.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FaceShapeGalleryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.editor = self.root / "editor"
        self.editor.mkdir()
        self.output = self.root / "gallery"
        source = self.root / "source.png"
        Image.new("RGB", (32, 24), (100,) * 3).save(source)
        self.report = {
            "source": str(source),
            "sourceSha256": MODULE.COMPARISON.SKIN.fingerprint(path=source)["sha256"],
            "errors": [], "reopenedHash": "verified-render", "exported": {"decodedFrames": 150},
            "samples": [],
        }
        for control in MODULE.COMPARISON.editor_controls():
            for value in control["values"]:
                name = f"{control['slug']}-{value}"
                result = self.editor / f"{name}-frame.png"
                Image.new("RGB", (32, 24), (110,) * 3).save(result)
                Image.new("RGB", (32, 24), (100,) * 3).save(self.editor / f"{name}-input.png")
                self.report["samples"].append({
                    "name": name, "value": value, "values": {control["key"]: value},
                    "width": 32, "height": 24,
                    "hash": MODULE.COMPARISON.SKIN.fingerprint(path=result)["sha256"],
                })
        self.save_report()

    def save_report(self):
        (self.editor / "report.json").write_text(json.dumps(self.report))

    def test_gallery_keeps_source_and_full_resolution_fixed_gain_maps(self):
        summary = MODULE.create_gallery(editor=self.editor, output=self.output, title="Test")
        self.assertEqual(summary, {"cases": 28, "pages": 15, "jianyingCompared": False})
        source_copy = self.output / "source-original.png"
        self.assertEqual(hashlib.sha256(source_copy.read_bytes()).hexdigest(), self.report["sourceSha256"])
        with Image.open(self.output / "small-face-50/difference-gray.png") as difference:
            self.assertEqual(difference.size, (32, 24))
            self.assertEqual(difference.mode, "L")
            self.assertEqual(difference.getextrema(), (60, 60))
        report = json.loads((self.output / "report.json").read_text())
        self.assertEqual(report["roi"], "whole-frame")
        self.assertEqual(report["gain"], 6)
        self.assertFalse(report["perMapNormalization"])
        self.assertEqual(report["records"][0]["meanRGBDelta"], 10)

    def test_rejects_failed_editor_run_before_writing_gallery(self):
        self.report["errors"] = ["resize changed frame"]
        self.save_report()
        with self.assertRaisesRegex(ValueError, "completed editor run"):
            MODULE.create_gallery(editor=self.editor, output=self.output, title="Test")
        self.assertFalse(self.output.exists())

    def test_rejects_source_changed_after_editor_run(self):
        Image.new("RGB", (32, 24), (99,) * 3).save(self.report["source"])
        with self.assertRaisesRegex(ValueError, "source fingerprint"):
            MODULE.create_gallery(editor=self.editor, output=self.output, title="Test")

    def test_rejects_tampered_result(self):
        sample = self.report["samples"][0]
        (self.editor / f"{sample['name']}-frame.png").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            MODULE.load_pair(editor=self.editor, sample=sample)

    def test_rejects_unexpected_source_dimensions(self):
        sample = self.report["samples"][0]
        Image.new("RGB", (24, 32)).save(self.editor / f"{sample['name']}-input.png")
        with self.assertRaisesRegex(ValueError, "dimensions"):
            MODULE.load_pair(editor=self.editor, sample=sample)

    def test_square_and_portrait_tiles_preserve_aspect_ratio(self):
        for size, content_bounds in [((32, 32), (0, 64, 384, 448)), ((24, 32), (0, 0, 384, 512))]:
            with self.subTest(size=size):
                tile = MODULE.fit_tile(frame=Image.new("RGB", size, "white"), grayscale=True)
                self.assertEqual(tile.size, (384, 512))
                self.assertEqual(tile.getbbox(), content_bounds)

    def test_html_escapes_titles_and_labels(self):
        self.output.mkdir()
        MODULE.write_gallery(output=self.output, title="<portrait>",
                             pages=[{"label": "<Face & tone>", "file": "face.png"}])
        document = (self.output / "index.html").read_text()
        self.assertIn("&lt;portrait&gt;", document)
        self.assertIn("&lt;Face &amp; tone&gt;", document)
        self.assertIn('href="face.png"', document)
        self.assertNotIn("<portrait>", document)

    def test_display_crop_does_not_resize_or_modify_full_size_evidence(self):
        frame = Image.new("RGB", (32, 24), "white")
        cropped = MODULE.display_frame(frame=frame, crop=(8, 0, 24, 24))
        self.assertEqual(cropped.size, (16, 24))
        self.assertEqual(frame.size, (32, 24))
        self.assertIs(MODULE.display_frame(frame=frame), frame)

    def test_rejects_outside_empty_and_noninteger_crops(self):
        frame = Image.new("RGB", (32, 24))
        for crop in [(-1, 0, 24, 24), (8, 0, 33, 24), (8, 0, 8, 24), (8, 0, 24), (8.5, 0, 24, 24)]:
            with self.subTest(crop=crop), self.assertRaises(ValueError):
                MODULE.display_frame(frame=frame, crop=crop)


if __name__ == "__main__":
    unittest.main()
