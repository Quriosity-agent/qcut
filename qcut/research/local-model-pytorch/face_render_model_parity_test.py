"""Synthetic actual-host tensor and head-pairing guards, no native model files."""

import hashlib
from pathlib import Path
import tempfile
import unittest

import numpy as np

import face_render_model_parity as probe


class TensorTests(unittest.TestCase):
    def test_nwhc_metadata_becomes_nhwc_without_channel_swapping(self):
        with tempfile.TemporaryDirectory() as directory:
            source = np.arange(24, dtype=np.int16).reshape(1, 2, 4, 3)
            path = Path(directory) / "tensor.bin"
            path.write_bytes(source.tobytes())
            item = dict(path=str(path), dims_nwhc=[1, 4, 2, 3], raw=[2, 6],
                        sha256=hashlib.sha256(source.tobytes()).hexdigest())
            actual = probe.load_tensor(item=item)
            np.testing.assert_array_equal(actual, source)
            actual[0, 0, 0, 0] = 99
            self.assertEqual(path.read_bytes(), source.tobytes())

    def test_all_storage_types_keep_original_values(self):
        with tempfile.TemporaryDirectory() as directory:
            for kind, dtype in ((1, np.int8), (2, np.int16), (4, np.float32)):
                source = np.array([-1, 0, 1], dtype=dtype).reshape(1, 1, 1, 3)
                path = Path(directory) / f"{kind}.bin"
                path.write_bytes(source.tobytes())
                item = dict(path=str(path), dims_nwhc=[1, 1, 1, 3], raw=[kind, 0],
                            sha256=hashlib.sha256(source.tobytes()).hexdigest())
                np.testing.assert_array_equal(probe.load_tensor(item=item), source)

    def test_truncation_hash_mismatch_and_nonfinite_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tensor.bin"
            for data, identity in ((b"\0", None), (b"\0" * 4, "a" * 64),
                                   (np.array([np.nan], np.float32).tobytes(), None)):
                path.write_bytes(data)
                item = dict(path=str(path), dims_nwhc=[1, 1, 1, 1], raw=[4, 0],
                            sha256=identity or hashlib.sha256(data).hexdigest())
                with self.subTest(data=data), self.assertRaises(ValueError):
                    probe.load_tensor(item=item)

    def test_unknown_or_unbounded_descriptor_is_rejected_before_io(self):
        for raw, dims in (([3, 0], [1, 1, 1, 1]), ([4, 0], [0, 1, 1, 1]),
                          ([4, 0], [1, 4096, 4096, 3]), ([True, 0], [1, 1, 1, 1]),
                          ([1, 25], [1, 1, 1, 1]), ([1, 0], [1, 1.0, 1, 1]),
                          ([1, 0], [1, False, 1, 1]), ([1, 0], [1, -1, -1, 1]),
                          ([1], [1, 1, 1, 1]), ([1, 0], [1, 1, 1])):
            with self.subTest(raw=raw, dims=dims), self.assertRaises(ValueError):
                probe.load_tensor(item=dict(path="/does-not-exist", raw=raw, dims_nwhc=dims))


class HeadTests(unittest.TestCase):
    def records(self):
        return [dict(name=f"head-{index}", inference=0, sha256=f"{index:064x}", raw=[4, 0],
                     dims_nwhc=[1, 1, 1, 1], path=f"/{index}.bin") for index in range(5)]

    def test_only_requested_inference_and_heads_are_selected(self):
        original = self.records()
        names = [item["name"] for item in original]
        unrelated = [dict(**original[0], extra=True), dict(original[0], inference=-1),
                     dict(original[0], name="data", inference=0)]
        result = probe.select_heads(outputs=[*original, *unrelated], inference=0, names=names)
        self.assertEqual(set(result), set(names))

    def test_equal_repeated_extraction_is_accepted(self):
        original = self.records()
        names = [item["name"] for item in original]
        result = probe.select_heads(outputs=[*original, dict(original[0], path="/repeat.bin")],
                                    inference=0, names=names)
        self.assertEqual(result[names[0]]["path"], "/repeat.bin")

    def test_repeated_head_cannot_change_hash_type_or_shape(self):
        original = self.records()
        names = [item["name"] for item in original]
        for key, value in (("sha256", "a" * 64), ("raw", [2, 0]), ("dims_nwhc", [1, 1, 1, 2])):
            changed = dict(original[0], **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.select_heads(outputs=[*original, changed], inference=0, names=names)

    def test_all_five_heads_required(self):
        original = self.records()
        for outputs, names in ((original[:4], [item["name"] for item in original]),
                               (original, [item["name"] for item in original[:4]]),
                               ([], [item["name"] for item in original])):
            with self.subTest(outputs=outputs), self.assertRaises(ValueError):
                probe.select_heads(outputs=outputs, inference=0, names=names)

    def test_completed_integer_inference_and_unique_heads_required(self):
        original = self.records()
        names = [item["name"] for item in original]
        for inference in (-1, False, 0.0):
            with self.subTest(inference=inference), self.assertRaises(ValueError):
                probe.select_heads(outputs=original, inference=inference, names=names)
        with self.assertRaises(ValueError):
            probe.select_heads(outputs=original, inference=0, names=[names[0]] * 5)


if __name__ == "__main__":
    unittest.main()
