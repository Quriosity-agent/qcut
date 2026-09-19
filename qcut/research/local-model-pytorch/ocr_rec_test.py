"""Synthetic recognizer contracts; private full-model oracle reports stay separate."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

import ocr_rec_torch as rec
from ocr_rec_cases import build_cases
from ocr_rec_numeric import PinnedSigmoid, SpatialSum, ordered_convolution


def small_graph(*, activation=2):
    rows = ["DataV2 data 1 32 512 3 4 0 0",
            f"Convolution conv 1 1 1 1 1 0 0 1 {activation} 4 0 4 0 4 0 data out"]
    return "E\\n\n1 1 99\\n\n" + "\\n\n".join(rows) + "\\n\n"


def small_model(*, activation=2, profile=rec.EXECUTION_PROFILE):
    return rec.OCRRecognizer(nodes=rec.parse_graph(text=small_graph(activation=activation)),
                             weights=np.array([1, 0, 0, 0], dtype=np.float32), execution_profile=profile).eval()


class RecognizerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def setUp(self):
        self.model = small_model()
        self.inputs = {"data": torch.zeros(rec.INPUT_SHAPE)}
        self.graph = small_graph()
        self.state = self.model.state_dict()
        self.bundle = {"format": rec.VALIDATED_FORMAT, "execution_profile": rec.EXECUTION_PROFILE,
                       "source_sha256": rec.SOURCE_SHA256, "runtime_sha256": rec.RUNTIME_SHA256,
                       "local_only": True, "graph": self.graph, "state_dict": self.state}

    def restore(self, *, bundle=None, expected_sha256=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.pt"
            torch.save(self.bundle if bundle is None else bundle, path)
            with patch.object(rec, "GRAPH_SHA256", hashlib.sha256(self.graph.encode()).hexdigest()), \
                    patch.object(rec, "STATE_SHA256", rec.state_digest(state=self.state)):
                return rec.load_validated_model(path=path, expected_sha256=expected_sha256)

    def test_validated_roundtrip_is_exact(self):
        clone = self.restore()
        with torch.inference_mode():
            self.assertTrue(torch.equal(self.model(self.inputs)["out"], clone(self.inputs)["out"]))
        self.assertTrue(all(torch.equal(value, clone.state_dict()[key]) for key, value in self.state.items()))

    def test_hard8_fused_activation(self):
        value = torch.linspace(-8, 8, 32 * 512).reshape(1, 1, 32, 512)
        inputs = {"data": value.expand(-1, 3, -1, -1).clone()}
        with torch.inference_mode():
            self.assertTrue(torch.equal(self.model(inputs)["out"], (value + 4).clamp(0, 8) / 8))

    def test_legacy_relu6_is_preserved(self):
        model = small_model(profile=rec.LEGACY_PROFILE)
        self.inputs["data"].fill_(7)
        with torch.inference_mode():
            self.assertTrue(torch.equal(model(self.inputs)["out"], torch.full((1, 1, 32, 512), 6.0)))

    def test_legacy_loader_still_requires_explicit_opt_in(self):
        with self.assertRaisesRegex(ValueError, "failed native parity"):
            rec.load_model(path="not-used.pt")

    def test_hard8_and_ordered_candidates_require_opt_in(self):
        for ordered in (False, True):
            with self.subTest(ordered=ordered), self.assertRaisesRegex(ValueError, "failed native parity"):
                rec.load_candidate_model(path="not-used.pt", ordered=ordered)

    def test_all_failed_formats_are_rejected_by_validated_loader(self):
        for name in (rec.FORMAT, rec.FAILED_FORMAT, rec.ORDERED_FAILED_FORMAT):
            bundle = dict(self.bundle, format=name)
            with self.subTest(format=name), self.assertRaises(ValueError):
                self.restore(bundle=bundle)

    def test_relabeling_profile_does_not_pass(self):
        for profile in (rec.LEGACY_PROFILE, rec.CANDIDATE_PROFILE, rec.ORDERED_PROFILE, None):
            with self.subTest(profile=profile), self.assertRaisesRegex(ValueError, "profile"):
                self.restore(bundle=dict(self.bundle, execution_profile=profile))

    def test_provenance_fields_are_pinned(self):
        for key, value in (("source_sha256", "0" * 64), ("runtime_sha256", "0" * 64),
                           ("graph", self.graph + "\n"), ("local_only", False)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.restore(bundle=dict(self.bundle, **{key: value}))

    def test_expected_artifact_hash(self):
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.restore(expected_sha256="0" * 64)

    def test_state_hash_rejects_weight_tampering(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["state_dict"]["layers.1.bias"].add_(0.1)
        with self.assertRaisesRegex(ValueError, "state hash"):
            self.restore(bundle=bundle)

    def test_state_dtype_and_nonfinite_are_rejected(self):
        for value in (torch.zeros(1, dtype=torch.float64), torch.tensor([float("nan")]), "not-a-tensor"):
            bundle = copy.deepcopy(self.bundle)
            bundle["state_dict"]["layers.1.bias"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "invalid recognizer state"):
                self.restore(bundle=bundle)

    def test_nonstring_state_name_is_rejected(self):
        bundle = copy.deepcopy(self.bundle)
        bundle["state_dict"][9] = torch.ones(1)
        with self.assertRaisesRegex(ValueError, "invalid recognizer state"):
            self.restore(bundle=bundle)

    def test_missing_state_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid recognizer state"):
            self.restore(bundle=dict(self.bundle, state_dict=None))

    def test_unknown_execution_profile(self):
        with self.assertRaisesRegex(ValueError, "execution profile"):
            small_model(profile="generic-mobilenet")

    def test_input_keys_exact(self):
        for inputs in ({}, {"unknown": torch.zeros(rec.INPUT_SHAPE)}, {**self.inputs, "extra": torch.ones(1)}):
            with self.subTest(keys=list(inputs)), self.assertRaises(ValueError):
                self.model(inputs)

    def test_input_dtype_shape_and_finite(self):
        values = [torch.zeros(rec.INPUT_SHAPE, dtype=torch.int16), torch.zeros(1, 3, 32, 256),
                  torch.full(rec.INPUT_SHAPE, float("inf")), np.zeros(rec.INPUT_SHAPE, dtype=np.float32)]
        for value in values:
            with self.subTest(dtype=value.dtype), self.assertRaises(ValueError):
                self.model({"data": value})

    def test_graph_header_count_is_strict(self):
        for graph in ("", self.graph.replace("1 1 99", "1 2 99"), self.graph.replace("E", "D", 1)):
            with self.subTest(graph=graph[:12]), self.assertRaises(ValueError):
                rec.parse_graph(text=graph)

    def test_unknown_operator_rejected(self):
        with self.assertRaises(ValueError):
            rec.OCRRecognizer(nodes=rec.parse_graph(text=self.graph.replace("Convolution conv", "Unknown conv")))

    def test_weight_count_is_exact(self):
        for count in (3, 5):
            with self.subTest(count=count), self.assertRaises(ValueError):
                rec.OCRRecognizer(nodes=rec.parse_graph(text=self.graph), weights=np.zeros(count, dtype=np.float32))

    def test_duplicate_blob_and_missing_input(self):
        for graph in (self.graph.replace("data out", "data data"), self.graph.replace("data out", "missing out")):
            with self.subTest(graph=graph[-25:]), self.assertRaises(ValueError):
                rec.OCRRecognizer(nodes=rec.parse_graph(text=graph))

    def test_unsupported_grouping(self):
        with self.assertRaises(ValueError):
            ordered_convolution(value=torch.ones(1, 4, 2, 2), weight=torch.ones(6, 2, 1, 1), bias=torch.zeros(6),
                                stride=(1, 1), padding=(0, 0), groups=2)

    def test_ordered_sum_matches_float32_sequence(self):
        values = np.random.default_rng(42).normal(size=(1, 17, 8, 32)).astype(np.float32)
        expected = values.reshape(1, 17, -1).cumsum(axis=2)[:, :, -1, None, None]
        actual = SpatialSum(ordered=True)(torch.from_numpy(values))
        self.assertTrue(np.array_equal(actual.numpy(), expected))

    def test_ordered_sum_does_not_promote_or_reassociate(self):
        value = torch.tensor([1e8, 1, -1e8, 1]).reshape(1, 1, 1, 4)
        self.assertEqual(float(SpatialSum(ordered=True)(value)), 1.0)
        self.assertEqual(float(value.double().sum()), 2.0)

    def test_ordered_convolution_and_depthwise_shapes(self):
        for groups, weight in ((1, torch.ones(4, 3, 3, 3)), (3, torch.ones(3, 1, 3, 3))):
            value = torch.arange(3 * 8 * 10, dtype=torch.float32).reshape(1, 3, 8, 10)
            bias = torch.ones(weight.shape[0])
            actual = ordered_convolution(value=value, weight=weight, bias=bias, stride=(2, 2), padding=(1, 1), groups=groups)
            expected = torch.nn.functional.conv2d(value, weight, bias, stride=2, padding=1, groups=groups)
            self.assertTrue(torch.equal(actual, expected))

    def test_pinned_sigmoid_is_finite_monotonic_and_bounded(self):
        value = torch.linspace(-20, 20, 1024).reshape(1, 16, 4, 16)
        result = PinnedSigmoid()(value).flatten()
        self.assertTrue(torch.isfinite(result).all())
        self.assertTrue((result >= 0).all() and (result <= 1).all())
        self.assertTrue((result[1:] >= result[:-1]).all())
        self.assertLess(float((result - value.sigmoid().flatten()).abs().max()), 2e-6)

    def test_fixture_quick_set_is_reproducible(self):
        first, _ = build_cases(quick=True)
        second, _ = build_cases(quick=True)
        self.assertEqual(len(first), 2)
        self.assertTrue(all(np.array_equal(value, second[key]) for key, value in first.items()))

    @unittest.skipUnless(Path("/System/Library/Fonts/Hiragino Sans GB.ttc").is_file(), "macOS fixture fonts unavailable")
    def test_bilingual_fixtures_are_real_nonblank_pixels(self):
        cases, metadata = build_cases(quick=False)
        self.assertEqual(len(cases), 20)
        self.assertEqual(len(metadata), 11)
        self.assertTrue(any(any(ord(character) > 127 for character in item["text"]) for item in metadata.values()))
        for key, value in cases.items():
            self.assertEqual(value.shape, rec.INPUT_SHAPE)
            self.assertEqual(value.dtype, np.float32)
            self.assertTrue(np.isfinite(value).all())
            if key in metadata:
                self.assertGreater(np.unique(value).size, 8)


if __name__ == "__main__":
    unittest.main()
