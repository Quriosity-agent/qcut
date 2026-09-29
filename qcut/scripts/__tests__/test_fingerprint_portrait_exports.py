import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "fingerprint_exports", Path(__file__).parents[1] / "fingerprint-portrait-exports.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExportFingerprintTests(unittest.TestCase):
    def test_hashes_empty_and_multiple_chunks_without_python_311_apis(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.mp4"
            with patch.object(hashlib, "file_digest", create=True, side_effect=AssertionError("Python 3.11 API")):
                for content in (b"", b"short", b"chunked export" * 200_000):
                    with self.subTest(size=len(content)):
                        path.write_bytes(content)
                        self.assertEqual(MODULE.sha256(path=path), hashlib.sha256(content).hexdigest())

    def test_records_manual_capture_and_rejects_rebinding_changed_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, video = root / "source.jpg", root / "export.mp4"
            source.write_bytes(b"source")
            video.write_bytes(b"export")
            manifest = {"source": source.name, "sourceSha256": MODULE.sha256(path=source),
                        "samples": [{"name": "neutral", "values": {}, "exportPath": video.name}]}
            original = copy.deepcopy(manifest)
            bound = MODULE.bind_exports(manifest=manifest, directory=root)
            self.assertEqual(manifest, original)
            self.assertEqual(bound["source"], str(source.resolve()))
            self.assertEqual(bound["samples"][0]["exportPath"], str(video.resolve()))
            self.assertEqual(bound["samples"][0]["exportSha256"], MODULE.sha256(path=video))
            self.assertEqual(MODULE.bind_exports(manifest=bound, directory=root), bound)
            video.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
                MODULE.bind_exports(manifest=bound, directory=root)
            for invalid in ({**manifest, "sourceSha256": "different"},
                            {**manifest, "errors": ["capture failed"]},
                            {**manifest, "samples": []},
                            {**manifest, "samples": manifest["samples"] * 2}):
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    MODULE.bind_exports(manifest=invalid, directory=root)
            video.unlink()
            with self.assertRaises(FileNotFoundError):
                MODULE.bind_exports(manifest=manifest, directory=root)


if __name__ == "__main__":
    unittest.main()
