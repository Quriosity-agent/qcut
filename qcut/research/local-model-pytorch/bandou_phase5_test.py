"""Independent scalar arithmetic, candidate refusal and private replay guard checks."""
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch
from torch import nn

from bandou_phase5_candidate import substitute
from bandou_phase5_numeric import upsample_twox
from bandou_phase5_probe import comparison, kernel_variants, prefix_text, read_tensors
from bandou_phase5_verify import fresh_cases
from portable_smoke import denied_access
from vision_batch_profiles import PROFILES
from vision_batch_replay import dependency_read
from vision_batch_test import conv_row, data_row
from vision_batch_torch import VisionGraph, parse_graph, state_digest


def scalar_blend(*, a, b, ratio):
    first = np.float32(np.float32(1 - ratio) * a)
    return np.float32(float(first) + float(ratio) * float(b))


def scalar_resize(*, array):
    n, channels, height, width = array.shape
    result = np.empty((n, channels, height * 2, width * 2), np.float32)
    for batch in range(n):
        for channel in range(channels):
            for oy in range(height * 2):
                y = min(max(oy / 2 - 0.25, 0), height - 1)
                y0, y1 = int(y), min(int(y) + 1, height - 1)
                for ox in range(width * 2):
                    x = min(max(ox / 2 - 0.25, 0), width - 1)
                    x0, x1 = int(x), min(int(x) + 1, width - 1)
                    top = scalar_blend(a=array[batch, channel, y0, x0], b=array[batch, channel, y0, x1], ratio=x - x0)
                    bottom = scalar_blend(a=array[batch, channel, y1, x0], b=array[batch, channel, y1, x1], ratio=x - x0)
                    result[batch, channel, oy, ox] = scalar_blend(a=top, b=bottom, ratio=y - y0)
    return result


class BandouArithmeticTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    def test_resize_matches_independent_scalar_for_rectangles(self):
        for shape in ((1, 3, 3, 5), (2, 1, 5, 3), (1, 4, 4, 4)):
            array = np.random.default_rng(91).uniform(-100, 100, shape).astype(np.float32)
            actual = upsample_twox(value=torch.from_numpy(array)).numpy()
            np.testing.assert_array_equal(actual, scalar_resize(array=array))

    def test_resize_singleton_rows_and_columns(self):
        for shape in ((1, 3, 1, 5), (1, 3, 5, 1), (1, 3, 1, 1)):
            array = np.random.default_rng(92).normal(size=shape).astype(np.float32)
            np.testing.assert_array_equal(upsample_twox(value=torch.from_numpy(array)), scalar_resize(array=array))

    def test_resize_clamps_edges_exactly(self):
        value = torch.arange(45, dtype=torch.float32).reshape(1, 3, 3, 5)
        actual = upsample_twox(value=value)
        for y, x in ((0, 0), (0, -1), (-1, 0), (-1, -1)):
            self.assertTrue(torch.equal(actual[:, :, y, x], value[:, :, y, x]))

    def test_resize_noncontiguous_does_not_change_values(self):
        value = torch.rand(1, 3, 3, 5)
        actual = upsample_twox(value=value)
        self.assertTrue(torch.equal(actual, upsample_twox(value=value.contiguous(memory_format=torch.channels_last))))

    def test_resize_preserves_constant_channels(self):
        value = torch.tensor([1, -3, 0], dtype=torch.float32)[None, :, None, None].expand(1, 3, 3, 5)
        expected = value[:, :, :1, :1].expand(1, 3, 6, 10)
        self.assertTrue(torch.equal(upsample_twox(value=value), expected))

    def test_resize_invalid_dtype_rank_and_extent(self):
        for value in (torch.ones(1, 3, 3, 5, dtype=torch.float64), torch.ones(3, 3, 5),
                      torch.ones(1, 3, 0, 4), torch.ones(1, 3, 257, 1)):
            with self.assertRaises(ValueError):
                upsample_twox(value=value)

    def test_substitution_does_not_mutate_source_or_state(self):
        model = VisionGraph(nodes=[data_row(), conv_row(kernel=3)], weights=np.arange(84, dtype=np.float32) / 7)
        before = state_digest(state=model.state_dict())
        clone = substitute(model=model, ordered_resize=True)
        self.assertEqual(state_digest(state=clone.state_dict()), before)
        self.assertEqual(type(model.layers["1"]), nn.Conv2d)
        self.assertIsNot(model.layers["1"], clone.layers["1"])
        self.assertFalse(PROFILES["bandou"]["native_verified"])

    def test_candidate_requires_exact_input_dtype_shape_and_names(self):
        model = substitute(model=VisionGraph(nodes=[data_row(), conv_row()]), ordered_resize=True)
        for inputs in ({}, {"other": torch.zeros(1, 3, 4, 4)}, {"data": torch.ones(1, 3, 4, 4, dtype=torch.float64)},
                       {"data": torch.full((1, 3, 4, 4), float("nan"))}, {"data": torch.ones(1, 3, 4, 5)}):
            with self.assertRaises(ValueError):
                model(inputs)

    def test_candidate_only_overrides_bilinear(self):
        nodes = [data_row(), ["UpSampling", "up", "data", "up", "NEAREST"]]
        candidate = substitute(model=VisionGraph(nodes=nodes), ordered_resize=True)
        with self.assertRaisesRegex(ValueError, "bilinear"):
            candidate({"data": torch.ones(1, 3, 4, 4)})

    def test_ordered_kernels_use_independent_scalar_reduction(self):
        generator = torch.Generator().manual_seed(54)
        for channels, outputs, groups, size, stride in ((3, 5, 1, 1, 1), (3, 5, 1, 3, 2), (3, 3, 3, 3, 1)):
            layer = nn.Conv2d(channels, outputs, size, stride=stride, padding=size // 2, groups=groups)
            with torch.no_grad():
                layer.weight.copy_(torch.randn(layer.weight.shape, generator=generator))
                layer.bias.copy_(torch.randn(layer.bias.shape, generator=generator))
            value = torch.randn((1, channels, 4, 5), generator=generator)
            actual = dict(kernel_variants(value=value, layer=layer, limit=outputs))["ordered-ocr-reference"].detach().numpy()
            expected = np.zeros(actual.shape, np.float32)
            source = np.pad(value.numpy(), ((0, 0), (0, 0), (size // 2, size // 2), (size // 2, size // 2)))
            weights, bias = layer.weight.detach().numpy(), layer.bias.detach().numpy()
            for co in range(outputs):
                for y in range(expected.shape[2]):
                    for x in range(expected.shape[3]):
                        total = bias[co] if size != 1 else np.float32(0)
                        for ky in range(size):
                            for kx in range(size):
                                for ci in range(1 if groups != 1 else channels):
                                    channel = co if groups != 1 else ci
                                    total = np.float32(float(source[0, channel, y * stride + ky, x * stride + kx]) * float(weights[co, ci, ky, kx]) + float(total))
                        expected[0, co, y, x] = total if size != 1 else np.float32(total + bias[co])
            np.testing.assert_array_equal(actual, expected)

    def test_kernel_rejects_invalid_channel_limit_and_grouping(self):
        layer = nn.Conv2d(4, 4, 3, groups=2)
        for limit in (0, True, 5, 4):
            with self.assertRaises(ValueError):
                list(kernel_variants(value=torch.ones(1, 4, 4, 4), layer=layer, limit=limit))

    def test_prefix_has_exact_nodes_and_no_original_mutation(self):
        nodes = [data_row(), conv_row(), ["Tanh", "end", "conv", "end", "4", "0"]]
        self.assertEqual(parse_graph(text=prefix_text(nodes=nodes, index=1)), nodes[:2])
        self.assertEqual(len(nodes), 3)
        for index in (0, -1, True, 3, "1"):
            with self.assertRaises(ValueError):
                prefix_text(nodes=nodes, index=index)

    def test_comparison_preserves_fixed_mixed_tolerance(self):
        expected = {"out": torch.tensor([0, 10], dtype=torch.float32)}
        self.assertTrue(comparison(native=expected, actual={"out": torch.tensor([9e-5, 10.001])})["passed"])
        self.assertFalse(comparison(native=expected, actual={"out": torch.tensor([1.1e-4, 10.002])})["passed"])

    def test_comparison_rejects_missing_names_shapes_and_nonfinite(self):
        expected = {"out": torch.ones(2)}
        for actual in ({}, {"other": torch.ones(2)}, {"out": torch.ones(1, 2)}, {"out": torch.ones(2, dtype=torch.float64)},
                       {"out": torch.tensor([1, float("nan")])}):
            self.assertFalse(comparison(native=expected, actual=actual)["passed"])

    def test_fresh_holdouts_are_distinct_reproducible_and_not_original_seeds(self):
        first = fresh_cases(shape=(1, 3, 4, 4))
        self.assertEqual(len(first), 6)
        self.assertEqual(len({value.tobytes() for value in first.values()}), 6)
        for name, array in fresh_cases(shape=(1, 3, 4, 4)).items():
            np.testing.assert_array_equal(array, first[name])
            self.assertTrue(name.startswith("holdout-phase5-"))

    def test_npz_reader_requires_finite_float32(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "values.npz"
            for value in (np.ones(2, np.float64), np.ones(2, np.int16), np.full(2, np.inf, np.float32)):
                np.savez(path, data=value)
                with self.assertRaises(ValueError):
                    read_tensors(path=path)


class ReplayDependencyTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("/tmp/bandou-test-venv/site-packages").resolve()

    def test_runtime_code_and_metadata_are_readonly(self):
        for name in ("numpy/__init__.py", "torch/_C.so", "numpy/x.pyc", "numpy/lib.dylib", "torch-2.dist-info/METADATA",
                     "numpy-2.dist-info/entry_points.txt"):
            self.assertTrue(dependency_read(event="open", args=(str(self.root / name), "r", 0), roots={self.root}))
            for flags in (os.O_WRONLY, os.O_RDWR, os.O_CREAT, os.O_TRUNC, os.O_APPEND):
                self.assertFalse(dependency_read(event="open", args=(str(self.root / name), "w", flags), roots={self.root}))

    def test_assets_and_sibling_environment_remain_denied(self):
        for name in ("torch/model.pt", "torch/raw.npz", "torch/model.model", "torch/model.onnx", "torch/arena.bin", "torch/LICENSE.txt",
                     "../private/model.py"):
            self.assertFalse(dependency_read(event="open", args=(str(self.root / name), "r", 0), roots={self.root}))

    def test_network_events_cannot_be_exempted(self):
        self.assertFalse(dependency_read(event="socket.connect", args=(str(self.root / "numpy.py"), "r", 0), roots={self.root}))
        self.assertEqual(denied_access(event="socket.connect", args=(), allowed=set(), output=Path("/tmp/result")), "network access")

    def test_open_modes_fds_and_missing_flags_are_not_exempted(self):
        for args in ((str(self.root / "code.py"), "r+", 0), (str(self.root / "code.py"), "r"), (17, "r", 0), ()):
            self.assertFalse(dependency_read(event="open", args=args, roots={self.root}))

    def test_dependency_symlink_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "deps"
            root.mkdir()
            target = Path(directory) / "private.py"
            (root / "library.py").symlink_to(target)
            self.assertFalse(dependency_read(event="open", args=(str(root / "library.py"), "r", 0), roots={root}))


if __name__ == "__main__":
    unittest.main()
