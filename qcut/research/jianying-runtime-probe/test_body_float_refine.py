"""Small owned fixtures; no private model, native runtime, or oracle required."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from body_coreml_normalization import normalize_body_coreml_input
from body_float_refine_model import BodyFloatRefine
from body_float_refine_probe import MODEL_SHA256, compare, load_owned_input, verified_file


def float_blob(*, values):
    return np.asarray(values, dtype="<f4").tobytes()


def example_graph():
    layers = [
        {"name": "conv", "type": "convolution", "bottom": "x", "top": "conv", "K": 1, "C": 1,
         "Nx": 1, "Ny": 1, "n_groups": 1, "has_biases": 1, "blob_weights": 1, "blob_biases": 2, "fused_relu": 1},
        {"name": "add", "type": "elementwise", "bottom": "conv,x", "top": "add", "operation": 0},
        {"name": "relu", "type": "activation", "bottom": "add", "top": "relu", "mode": 0},
        {"name": "cat", "type": "concat", "bottom": "conv,relu", "top": "cat"},
        {"name": "up", "type": "upsample", "bottom": "cat", "top": "out", "mode": 1,
         "scaling_factor_x": 2, "scaling_factor_y": 2},
    ]
    shapes = {name: {"n": 1, "k": channels, "h": size, "w": size}
              for name, channels, size in (("conv", 1, 2), ("add", 1, 2), ("relu", 1, 2), ("cat", 2, 2), ("out", 2, 4))}
    return {"layers": layers, "shapes": shapes, "inputs": {"x": {"shape": [1, 1, 2, 2]}},
            "outputs": ["out"], "quantization_profile": "espresso-u8-fma-f32-to-f16"}, {
                1: float_blob(values=[2]), 2: float_blob(values=[-0.5])}


class FloatGraphTests(unittest.TestCase):
    def test_all_five_ops_residual_lifetime_and_half_pixel_upsample(self):
        spec, blobs = example_graph()
        expected = np.array([[
            [[0, 0, 0, 0], [.375, .5, .75, .875], [1.125, 1.5, 2.25, 2.625], [1.5, 2, 3, 3.5]],
            [[0, 0, 0, 0], [.625, .8125, 1.1875, 1.375], [1.875, 2.4375, 3.5625, 4.125], [2.5, 3.25, 4.75, 5.5]],
        ]], np.float32)
        for precision in ("float32", "float16"):
            with self.subTest(precision=precision), torch.inference_mode():
                model = BodyFloatRefine(spec=spec, blobs=blobs, precision=precision)
                actual = model({"x": torch.tensor([[[[-1., 0.], [1., 2.]]]])})["out"].numpy()
                np.testing.assert_array_equal(actual, expected)

    def test_quantized_per_channel_weights_use_affine_then_half_rounding(self):
        spec, _ = example_graph()
        layer = copy.deepcopy(spec["layers"][0])
        layer.pop("blob_weights")
        layer.update(C=2, top="y", fused_relu=0, weights={"W_U8": 3, "per_ch_qscale": 4, "per_ch_qbias": 5})
        spec.update(layers=[layer], outputs=["y"], shapes={"y": {"n": 1, "k": 2, "h": 2, "w": 2}})
        blobs = {2: float_blob(values=[0, 0]), 3: bytes([255, 127]),
                 4: float_blob(values=[0.003, 0.004]), 5: float_blob(values=[-0.1, -0.2])}
        model = BodyFloatRefine(spec=spec, blobs=blobs)
        expected_weights = np.array([.6650390625, .30810546875], np.float32)
        with torch.inference_mode():
            actual = model({"x": torch.ones((1, 1, 2, 2))})["y"].numpy()
        np.testing.assert_array_equal(actual[0, :, 0, 0], expected_weights)

    def test_grouped_convolution_and_asymmetric_padding(self):
        spec = {"inputs": {"x": {"shape": [1, 2, 1, 2]}}, "outputs": ["y"],
            "quantization_profile": "espresso-u8-fma-f32-to-f16",
            "shapes": {"y": {"n": 1, "k": 2, "h": 1, "w": 3}},
            "layers": [{"name": "group", "type": "convolution", "bottom": "x", "top": "y",
                "K": 2, "C": 2, "Nx": 1, "Ny": 1, "n_groups": 2, "blob_weights": 1, "pad_l": 1}]}
        model = BodyFloatRefine(spec=spec, blobs={1: float_blob(values=[2, 3])})
        with torch.inference_mode():
            actual = model({"x": torch.tensor([[[[1., 2.]], [[3., 4.]]]])})["y"].numpy()
        np.testing.assert_array_equal(actual, [[[[0, 2, 4]], [[0, 9, 12]]]])

    def test_unknown_operator_or_fields_rejected(self):
        for change in ({"type": "mystery"}, {"pad_mode": 1}, {"weights_invented": 1}, {"stride_x": 0}, {"n_groups": 2}):
            with self.subTest(change=change):
                spec, blobs = example_graph()
                spec["layers"][0].update(change)
                with self.assertRaises(ValueError):
                    BodyFloatRefine(spec=spec, blobs=blobs)

    def test_missing_dependency_and_shape_mismatch_fail_closed(self):
        spec, blobs = example_graph()
        spec["layers"][1]["bottom"] = "missing,x"
        with self.assertRaisesRegex(ValueError, "dependency"):
            BodyFloatRefine(spec=spec, blobs=blobs)
        spec, blobs = example_graph()
        spec["shapes"]["conv"]["h"] = 3
        model = BodyFloatRefine(spec=spec, blobs=blobs)
        with self.assertRaisesRegex(ValueError, "output shape"):
            model({"x": torch.ones(1, 1, 2, 2)})

    def test_inputs_and_precision_are_strict(self):
        spec, blobs = example_graph()
        with self.assertRaisesRegex(ValueError, "precision"):
            BodyFloatRefine(spec=spec, blobs=blobs, precision="invented")
        model = BodyFloatRefine(spec=spec, blobs=blobs)
        for inputs in ({"wrong": torch.ones(1, 1, 2, 2)}, {"x": torch.ones(1, 1, 2, 2).half()},
                       {"x": torch.ones(1, 1, 2, 3)}, {"x": torch.full((1, 1, 2, 2), float("nan"))}):
            with self.subTest(inputs=list(inputs)):
                with self.assertRaises(ValueError):
                    model(inputs)

    def test_unobserved_upsample_semantics_rejected(self):
        for change in ({"mode": 0}, {"align_corners": 1}, {"scaling_factor_y": 0},
                       {"use_fractional_scale_factors": True}, {"scaling_factor_x": 1.5}):
            spec, blobs = example_graph()
            spec["layers"][-1].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                BodyFloatRefine(spec=spec, blobs=blobs)


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "owned").mkdir()
        self.source = self.root / "original.rgba"
        self.source.write_bytes(bytes([20, 30, 40, 255]))
        raster = self.root / "owned/algorithm-000.rgba"
        raster.write_bytes(self.source.read_bytes())
        raster.with_suffix(".json").write_text(json.dumps({"privateNativeImages": [], "pixelBytes": 4}))
        pixels = np.arange(192 * 144 * 3, dtype=np.int32).reshape(192, 144, 3) % 256
        self.integer = (pixels - 128).astype(np.int16)[None]
        self.normalized = normalize_body_coreml_input(bgr=pixels.astype(np.uint8))[None]
        self.archive = self.root / "owned/cold-001-pass0.npz"
        self.write_archive()
        self.report = {"nativePointsUsedAsInput": False, "nativeAlgorithmUsedAsInput": False,
            "networkProvenance": {"source": {"modelSha256": MODEL_SHA256}},
            "rows": [{}, {"call": 1, "source": str(self.source), "ownedAlgorithmFile": "owned/algorithm-000.rgba",
                "ownedAlgorithmSha256": self.digest(path=raster), "ownedPoints": {"cold": {"inferences": [{
                    "file": "owned/cold-001-pass0.npz", "sha256": self.digest(path=self.archive), "network": "refine"}]}}}]}
        (self.root / "provenance.json").write_text(json.dumps({"inputs": {str(self.source): self.digest(path=self.source)}, "width": 1, "height": 1}))
        self.write_report()

    def digest(self, *, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write_archive(self):
        np.savez_compressed(self.archive, input=self.integer, owned_coreml_input=self.normalized,
                            output_0=np.full((1, 24, 18, 34), np.nan, np.float32))

    def write_report(self):
        (self.root / "owned-comparison.json").write_text(json.dumps(self.report))

    def test_input_rebuilt_without_native_trace_or_output_tensor(self):
        actual, receipt = load_owned_input(evidence=self.root)
        np.testing.assert_array_equal(actual, self.normalized)
        self.assertTrue(receipt["inputReconstructedFromOwnedIntegerPixels"])
        self.assertFalse((self.root / "default/trace.json").exists())

    def test_mutated_original_raster_or_npz_rejected(self):
        for path in (self.source, self.root / "owned/algorithm-000.rgba", self.archive):
            with self.subTest(path=path):
                original = path.read_bytes()
                path.write_bytes(original + b"x")
                with self.assertRaisesRegex(ValueError, "identity"):
                    load_owned_input(evidence=self.root)
                path.write_bytes(original)

    def test_normalization_mismatch_rejected_even_with_updated_archive_hash(self):
        self.normalized[0, 0, 0, 0] += 0.1
        self.write_archive()
        self.report["rows"][1]["ownedPoints"]["cold"]["inferences"][0]["sha256"] = self.digest(path=self.archive)
        self.write_report()
        with self.assertRaisesRegex(ValueError, "normalization"):
            load_owned_input(evidence=self.root)

    def test_native_derived_input_receipt_rejected(self):
        self.report["nativeAlgorithmUsedAsInput"] = True
        self.write_report()
        with self.assertRaisesRegex(ValueError, "independently"):
            load_owned_input(evidence=self.root)

    def test_path_escape_rejected_even_for_matching_hash(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            verified_file(root=self.root / "owned", name="../original.rgba", expected=self.digest(path=self.source))

    def test_nonfinite_and_shape_mismatch_cannot_pass_metrics(self):
        for expected in (np.array([np.nan]), np.zeros((2, 1))):
            with self.assertRaises(ValueError):
                compare(actual=np.zeros(1), expected=expected)


if __name__ == "__main__":
    unittest.main()
