import copy
import importlib.util
import unittest
from pathlib import Path

from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "skin_exports", Path(__file__).parents[1] / "compare-portrait-skin-exports.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def manifest():
    return {"sourceSha256": "source", "samples": [
        {"name": name, "values": dict(values), "exportPath": f"{name}.mp4"}
        for name, values in MODULE.EXPECTED.items()
    ]}


class SkinExportTests(unittest.TestCase):
    def test_complete_isolated_matrix(self):
        self.assertEqual(len(MODULE.validate_samples(manifest=manifest(), source_hash="source")), 8)

    def test_rejects_missing_duplicate_combined_cases(self):
        missing = manifest()
        missing["samples"].pop()
        duplicate = manifest()
        duplicate["samples"].append(duplicate["samples"][0])
        combined = manifest()
        combined["samples"][2]["values"]["other"] = 50
        mislabeled = manifest()
        mislabeled["samples"][2]["name"] = "wrong"
        for report in (missing, duplicate, combined, mislabeled):
            with self.subTest(report=report), self.assertRaises(ValueError):
                MODULE.validate_samples(manifest=report, source_hash="source")

    def test_rejects_source_mismatch_and_failed_runs(self):
        with self.assertRaises(ValueError):
            MODULE.validate_samples(manifest=manifest(), source_hash="other")
        report = manifest()
        report["errors"] = ["render failure"]
        with self.assertRaises(ValueError):
            MODULE.validate_samples(manifest=report, source_hash="source")

    def test_stream_contract_does_not_hide_color_differences(self):
        stream = {"width": 1080, "height": 1620, "avg_frame_rate": "30/1",
                  "duration": "5.000000", "codec_name": "h264"}
        MODULE.validate_stream(stream=stream)
        for change in ({"width": 720}, {"height": 1080}, {"avg_frame_rate": "24/1"},
                       {"duration": "1"}, {"codec_name": "hevc"}):
            wrong = copy.copy(stream)
            wrong.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                MODULE.validate_stream(stream=wrong)

    def test_color_contract_retains_missing_metadata(self):
        unknown = MODULE.color_contract(stream={"pix_fmt": "yuvj420p", "color_range": "pc"})
        tagged = MODULE.color_contract(stream={"pix_fmt": "yuv420p", "color_range": "tv",
                                              "color_space": "bt709"})
        self.assertIsNone(unknown["color_space"])
        self.assertNotEqual(unknown, tagged)

    def test_blank_and_wrong_sized_frames_rejected(self):
        for image in (Image.new("RGB", (1080, 1620)), Image.new("RGB", (1080, 1620), "white"),
                      Image.new("RGB", (720, 1080))):
            with self.assertRaises(ValueError):
                MODULE.validate_frame(image=image)
        image = Image.new("RGB", (1080, 1620))
        image.paste("white", (0, 0, 540, 1620))
        MODULE.validate_frame(image=image)


if __name__ == "__main__":
    unittest.main()
