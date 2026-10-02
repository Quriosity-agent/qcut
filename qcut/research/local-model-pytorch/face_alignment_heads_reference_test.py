"""Self-authored reference fixtures and provenance rejection for Stage1 heads."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import espresso_oracle
from face_alignment_backbone_test import synthetic_reference
from face_alignment_backbone_verify import reference_case
from face_alignment_heads_verify import decode_tables, point_reference, run, visual
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


class AlignmentReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        guard = patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path))
        guard.start()
        self.addCleanup(guard.stop)

    def write_summary(self, *, summary):
        (self.root / "summary.json").write_text(json.dumps(summary))

    def points(self, *, size=120):
        directory, summary = synthetic_reference(root=self.root, size=size)
        arrays = {"stage1": np.zeros((106, 2), np.float32),
                  "inverse": np.array([[2, 0, 10], [0, 2, 20]], np.float32),
                  "original-points": np.tile(np.array([10, 20], np.float32), (106, 1))}
        record = summary["cases" if size == 120 else "seeds"][0]
        for name, value in arrays.items():
            path = directory / f"{name}.npy"
            np.save(path, value)
            record[name + "_sha256"] = espresso_oracle.sha256(path=path)
        self.write_summary(summary=summary)
        return directory, summary, reference_case(root=self.root, size=size)

    def tables(self):
        path = self.root / "original-base.npy"
        np.save(path, np.full((106, 2), 128, np.float32))
        np.save(self.root / "original-order.npy", np.arange(106, dtype=np.int32))
        summary = {"passed": True, "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
                   "loaded_bytenn": {"sha256": BYTENN_SHA256}, "order_is_identity": True,
                   "means": {"base": espresso_oracle.sha256(path=path)}}
        self.write_summary(summary=summary)
        return summary

    def test_both_point_profiles_and_hashes(self):
        for size in (120, 160):
            _, _, reference = self.points(size=size)
            result = point_reference(root=self.root, size=size, reference=reference)
            self.assertEqual(set(result["arrays"]), {"stage1", "inverse", "original-points"})
            self.assertEqual(result["arrays"]["stage1"].shape, (106, 2))
            self.assertTrue(all(len(digest) == 64 for digest in result["files"].values()))

    def test_changed_summary_and_unsupported_profile_rejected(self):
        _, summary, reference = self.points()
        with self.assertRaisesRegex(ValueError, "profile"):
            point_reference(root=self.root, size=121, reference=reference)
        self.write_summary(summary={**summary, "passed": False})
        with self.assertRaisesRegex(ValueError, "summary hash"):
            point_reference(root=self.root, size=120, reference=reference)

    def test_missing_ambiguous_and_bad_record_contract_rejected(self):
        _, original, reference = self.points()
        records = original["cases"]
        for candidate in (None, [], records * 2, records * 65, [None],
                          [{**records[0], "passed": 1}], [{**records[0], "optimized": True}],
                          [{**records[0], "step": 2}], [{**records[0], "threshold": 0}],
                          [{**records[0], "expansion": 1.8}], [{**records[0], "raw_sha256": "bad"}]):
            self.write_summary(summary={**original, "cases": candidate})
            changed = {**reference, "summary_sha256": espresso_oracle.sha256(path=self.root / "summary.json")}
            with self.assertRaises(ValueError):
                point_reference(root=self.root, size=120, reference=changed)

    def test_changed_array_hash_rejected(self):
        directory, _, reference = self.points()
        np.save(directory / "stage1.npy", np.ones((106, 2), np.float32))
        with self.assertRaisesRegex(ValueError, "hash"):
            point_reference(root=self.root, size=120, reference=reference)

    def test_matching_hash_still_rejects_bad_points_and_singular_inverse(self):
        directory, original, reference = self.points()
        candidates = (("stage1", np.zeros((105, 2), np.float32)),
                      ("stage1", np.zeros((106, 2), np.float64)),
                      ("stage1", np.full((106, 2), np.nan, np.float32)),
                      ("inverse", np.zeros((2, 3), np.float32)),
                      ("inverse", np.zeros((2, 2), np.float32)),
                      ("original-points", np.full((106, 2), np.inf, np.float32)))
        for name, value in candidates:
            path = directory / f"{name}.npy"
            snapshot = path.read_bytes()
            np.save(path, value)
            summary = copy.deepcopy(original)
            summary["cases"][0][name + "_sha256"] = espresso_oracle.sha256(path=path)
            self.write_summary(summary=summary)
            changed = {**reference, "summary_sha256": espresso_oracle.sha256(path=self.root / "summary.json")}
            with self.assertRaises(ValueError):
                point_reference(root=self.root, size=120, reference=changed)
            path.write_bytes(snapshot)

    def test_decode_tables_profile_and_digests(self):
        self.tables()
        actual = decode_tables(root=self.root)
        np.testing.assert_array_equal(actual["order"], np.arange(106))
        self.assertEqual(actual["mean"].dtype, np.float32)
        self.assertEqual(set(actual["files"]), {"mean", "order"})
        self.assertEqual(len(actual["summary_sha256"]), 64)

    def test_decode_table_provenance_and_mean_hash_rejected(self):
        original = self.tables()
        for key, value in (("passed", 1), ("runtime_sha256", "bad"), ("model_sha256", "bad"),
                           ("loaded_bytenn", []), ("loaded_bytenn", {"sha256": "bad"}),
                           ("order_is_identity", False), ("means", {}), ("means", [])):
            self.write_summary(summary={**original, key: value})
            with self.assertRaises(ValueError):
                decode_tables(root=self.root)
        self.write_summary(summary=[])
        with self.assertRaises(ValueError):
            decode_tables(root=self.root)
        self.write_summary(summary=original)
        np.save(self.root / "original-base.npy", np.ones((106, 2), np.float32))
        with self.assertRaisesRegex(ValueError, "hash"):
            decode_tables(root=self.root)

    def test_decode_table_shape_dtype_range_finiteness_and_order_rejected(self):
        original = self.tables()
        candidates = (("original-base", np.zeros((106, 2), np.float32)),
                      ("original-base", np.full((106, 2), 256, np.float32)),
                      ("original-base", np.full((106, 2), np.nan, np.float32)),
                      ("original-base", np.ones((105, 2), np.float32)),
                      ("original-base", np.ones((106, 2), np.float64)),
                      ("original-order", np.arange(106, dtype=np.int32)[::-1]),
                      ("original-order", np.arange(106, dtype=np.int64)),
                      ("original-order", np.arange(105, dtype=np.int32)))
        for name, value in candidates:
            path = self.root / f"{name}.npy"
            snapshot = path.read_bytes()
            np.save(path, value)
            summary = copy.deepcopy(original)
            summary["means"]["base"] = espresso_oracle.sha256(path=self.root / "original-base.npy")
            self.write_summary(summary=summary)
            with self.assertRaisesRegex(ValueError, "unsupported"):
                decode_tables(root=self.root)
            path.write_bytes(snapshot)

    def test_existing_output_and_missing_reference_do_not_write(self):
        with self.assertRaisesRegex(ValueError, "overwrite"):
            run(networks=self.root, reference=self.root, decode_reference=self.root, output=self.root)
        output = self.root / "output"
        with self.assertRaises(FileNotFoundError):
            run(networks=self.root, reference=self.root, decode_reference=self.root, output=output)
        self.assertFalse(output.exists())

    def test_chart_keeps_identical_points_black_and_labels_scope(self):
        points = np.tile(np.array([30, 40], np.float32), (106, 1))
        path = self.root / "points.png"
        visual(pixels=np.full((120, 120, 3), 100, np.uint8), native=points, pytorch=points,
               portable=points, size=120, output=path)
        with Image.open(path) as image:
            self.assertEqual(image.size, (1550, 360))
            self.assertFalse(np.asarray(image)[30:330, 1245:1545].any())


if __name__ == "__main__":
    unittest.main()
