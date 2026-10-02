"""Synthetic lane-shuffle, fixed-profile export and explicit integer-prefix tests."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

import espresso_fixed
from espresso_integer_export import export_onnx, session
from espresso_integer_torch import EspressoIntegerGraph, shuffle_lanes
from espresso_integer_test import graph


def shuffle_graph(*, storage=2, fractions=(7, 7), targets=(7, 7), lanes=4, channels=(8, 8), spatial=(1, 1)):
    return (f"2 1\na 1 {spatial[0]} {spatial[1]} {channels[0]} {storage} {fractions[0]}\n"
            f"b 1 {spatial[0]} {spatial[1]} {channels[1]} {storage} {fractions[1]}\n"
            f"ShuffleNet mix 2 a b {lanes} 2 left {targets[0]} right {targets[1]}\n")


def synthetic_values(*, channels=(8, 8), spatial=(1, 1)):
    base = np.array([3000, -4094, 2047, -2047, 100, -100, 4094, -3000], np.int64)
    return tuple(np.resize(base + index, (1, *spatial, count)) for index, count in enumerate(channels))


class ShuffleReplayTest(unittest.TestCase):
    def compare(self, *, text, values):
        model = EspressoIntegerGraph(text=text, arena=b"")
        inputs = {name: (value, (model.graph["descriptors"][name]["type"], model.graph["descriptors"][name]["fraction"]))
                  for name, value in zip(model.input_names, values)}
        expected = espresso_fixed.run(text, b"", inputs)
        actual = model.intermediate(inputs={name: torch.from_numpy(value) for name, value in zip(model.input_names, values)})
        for name, tensor in actual.items():
            np.testing.assert_array_equal(tensor.numpy(), expected[name]["data"], err_msg=name)
        return model

    def test_four_lane_channel_order_has_explicit_expected_sequence(self):
        value = torch.arange(1, 17, dtype=torch.int64).reshape(1, 1, 1, 16)
        actual = shuffle_lanes(value=value, groups=2, lanes=4)
        self.assertEqual(actual.flatten().tolist(), [1, 2, 3, 4, 9, 10, 11, 12, 5, 6, 7, 8, 13, 14, 15, 16])

    def test_lane_shuffle_batch_spatial_and_group_variations(self):
        value = np.arange(2 * 3 * 5 * 24, dtype=np.int64).reshape(2, 3, 5, 24)
        for groups, lanes in ((2, 4), (3, 2), (4, 3), (1, 4), (6, 1)):
            with self.subTest(groups=groups, lanes=lanes):
                actual = shuffle_lanes(value=torch.from_numpy(value), groups=groups, lanes=lanes)
                np.testing.assert_array_equal(actual, espresso_fixed.shuffle_lanes(value, groups, lanes))

    def test_invalid_lane_groups_and_nondivisible_channels_rejected(self):
        value = torch.zeros((1, 1, 1, 15), dtype=torch.int64)
        for groups, lanes in ((2, 4), (0, 4), (2, 0), (-1, 4), (True, 4), (2, 2.0)):
            with self.subTest(groups=groups, lanes=lanes), self.assertRaises(ValueError):
                shuffle_lanes(value=value, groups=groups, lanes=lanes)

    def test_shuffle_graph_is_unclamped_permutation(self):
        value = np.arange(-4096, -4096 + 32, dtype=np.int64).reshape(1, 2, 1, 16)
        model = self.compare(text=graph(rows=["Shuffle order 4 2 data output"], shape=value.shape, storage=(2, 7)), values=(value,))
        self.assertLess(int(model(torch.from_numpy(value))[0].min()), -2047)

    def test_int16_clamps_one_side_per_lane_not_symmetric_range(self):
        value = np.array([3000, -4094, 2047, -2047, 100, -100, 4094, -3000], np.int64).reshape(1, 1, 1, 8)
        model = self.compare(text=shuffle_graph(), values=(value, value))
        left, right = model(torch.from_numpy(value), torch.from_numpy(value))
        self.assertEqual(left.flatten().tolist(), [2047, -4094, 2047, -2047, 3000, -2047, 2047, -2047])
        self.assertEqual(right.flatten().tolist(), [100, -100, 2047, -3000, 100, -100, 4094, -2047])

    def test_int8_saturates_both_sides_after_target_scaling(self):
        value = np.array([100, -100, 64, -64, 127, -128, 30, -30], np.int64).reshape(1, 1, 1, 8)
        model = self.compare(text=shuffle_graph(storage=1, fractions=(3, 3), targets=(3, 4)), values=(value, value))
        self.assertEqual(model(torch.from_numpy(value), torch.from_numpy(value))[1].flatten().tolist(),
                         [127, -128, 60, -60, 127, -128, 60, -60])

    def test_different_source_and_target_fractions_follow_channel_origin(self):
        for storage in (1, 2):
            for fractions, targets in (((7, 4), (6, 5)), ((3, 6), (3, 4)), ((7, 7), (4, 8))):
                for lanes in (1, 2, 4):
                    values = tuple(value // 32 for value in synthetic_values(spatial=(2, 3)))
                    with self.subTest(storage=storage, fractions=fractions, targets=targets, lanes=lanes):
                        self.compare(text=shuffle_graph(storage=storage, fractions=fractions, targets=targets,
                                                        lanes=lanes, spatial=(2, 3)), values=values)

    def test_unequal_source_channels_and_more_than_two_sources(self):
        self.compare(text=shuffle_graph(channels=(4, 12)), values=synthetic_values(channels=(4, 12)))
        text = ("3 1\na 1 1 1 4 2 7\nb 1 1 1 4 2 6\nc 1 1 1 8 2 4\n"
                "ShuffleNet mix 3 a b c 4 2 left 6 right 5\n")
        self.compare(text=text, values=(*synthetic_values(channels=(4, 4)), synthetic_values(channels=(8,))[0]))

    def test_noncontiguous_input_and_source_ownership(self):
        originals = synthetic_values(spatial=(2, 4))
        values = tuple(value[:, :, ::2, :] for value in originals)
        snapshots = tuple(value.copy() for value in values)
        self.compare(text=shuffle_graph(spatial=(2, 2)), values=values)
        for value, snapshot in zip(values, snapshots):
            np.testing.assert_array_equal(value, snapshot)

    def test_shuffle_validation_rejects_spatial_mismatch_and_float_sources(self):
        text = "2 1\na 1 1 1 8 2 7\nb 1 2 1 8 2 7\nShuffleNet mix 2 a b 4 2 left 7 right 7\n"
        with self.assertRaisesRegex(ValueError, "shuffle shape"):
            EspressoIntegerGraph(text=text, arena=b"")
        with self.assertRaises(ValueError):
            EspressoIntegerGraph(text=shuffle_graph(storage=4, fractions=(0, 0)), arena=b"")
        for row in ("Shuffle order 4 3 data output", "ShuffleNet mix 1 data 4 2 left 7 right 7"):
            with self.assertRaisesRegex(ValueError, "shuffle shape"):
                EspressoIntegerGraph(text=graph(rows=[row], shape=(1, 1, 1, 10), storage=(2, 7)), arena=b"")


class ExplicitPrefixTest(unittest.TestCase):
    def text(self):
        return graph(rows=["Eltwise add data data features 1 6 0", "Softmax head features probability 4 0"])

    def test_default_full_graph_still_rejects_float_head(self):
        with self.assertRaisesRegex(ValueError, "Softmax"):
            EspressoIntegerGraph(text=self.text(), arena=b"")

    def test_explicit_prefix_stops_without_claiming_terminal_head(self):
        model = EspressoIntegerGraph(text=self.text(), arena=b"", prefix_output="features")
        self.assertEqual(len(model.graph["layers"]), 3)
        self.assertEqual(len(model.execution_layers), 2)
        self.assertEqual(model.output_names, ("features",))
        blobs = model.intermediate(inputs={"data": torch.ones((1, 4, 4, 2), dtype=torch.int64)})
        self.assertEqual(set(blobs), {"data", "features"})
        self.assertNotIn("probability", model.output_names)

    def test_prefix_rejects_missing_input_and_invalid_name_types(self):
        for prefix in ("missing", "data", [], True, 1):
            with self.subTest(prefix=prefix), self.assertRaisesRegex(ValueError, "prefix output"):
                EspressoIntegerGraph(text=self.text(), arena=b"", prefix_output=prefix)

    def test_prefix_cannot_request_unexecuted_later_output(self):
        with self.assertRaisesRegex(ValueError, "unique existing"):
            EspressoIntegerGraph(text=self.text(), arena=b"", prefix_output="features", output_names=["probability"])

    def test_prefix_does_not_skip_earlier_unsupported_layer(self):
        text = graph(rows=["Softmax early data probability 4 0", "Eltwise add data data features 1 6 0"])
        with self.assertRaisesRegex(ValueError, "Softmax"):
            EspressoIntegerGraph(text=text, arena=b"", prefix_output="features")

    def test_prefix_still_checks_entire_original_arena_and_stamp(self):
        text = ("B\n1 2 1234\nDataV2 data 1 1 1 2 2 6 6\n"
                "Slice split data 1 1 1 2 left 6 right 6\n"
                "Convolution conv 2 1 1 1 1 0 0 0 0 2 5 4 11 2 6 data later\n")
        arena = bytes([0, 15, 255, 127, 248, 0]) + (1234).to_bytes(4, "little")
        model = EspressoIntegerGraph(text=text, arena=arena, prefix_output="left")
        self.assertEqual(model.output_names, ("left",))
        for invalid in (arena[:-1], arena + b"0", arena[:-4] + bytes(4)):
            with self.assertRaisesRegex(ValueError, "byte count|stamp"):
                EspressoIntegerGraph(text=text, arena=invalid, prefix_output="left")

    def test_pytorch_and_standard_onnx_reloads_use_runtime_values_not_traced_inputs(self):
        text = shuffle_graph(fractions=(7, 4), targets=(6, 5), spatial=(2, 3))
        model = EspressoIntegerGraph(text=text, arena=b"")
        values = tuple(torch.from_numpy(value) for value in synthetic_values(spatial=(2, 3)))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "shuffle.onnx"
            export_onnx(model=model, inputs=values, path=path)
            portable = session(path=path)
            artifact = Path(directory) / "shuffle.pt2"
            torch.export.save(torch.export.export(model, values), artifact)
            reloaded = torch.export.load(artifact).module()
            for candidate in (values, tuple(torch.full_like(value, -4094) for value in values),
                              tuple(torch.full_like(value, 3000) for value in values), tuple(-value for value in values)):
                expected = model(*candidate)
                feed = dict(zip(model.input_names, (value.numpy() for value in candidate)))
                for actual, recorded, reference in zip(portable.run(None, feed), reloaded(*candidate), expected):
                    np.testing.assert_array_equal(actual, reference)
                    np.testing.assert_array_equal(recorded, reference)

    def test_prefix_standard_onnx_and_pt2_reload_exclude_later_float_head(self):
        model = EspressoIntegerGraph(text=self.text(), arena=b"", prefix_output="features")
        value = torch.arange(-16, 16, dtype=torch.int64).reshape(1, 4, 4, 2)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prefix.onnx"
            export_onnx(model=model, inputs=(value,), path=path)
            portable = session(path=path)
            self.assertEqual([output.name for output in portable.get_outputs()], ["features"])
            artifact = Path(directory) / "prefix.pt2"
            torch.export.save(torch.export.export(model, (value,)), artifact)
            reloaded = torch.export.load(artifact).module()
            for candidate in (value, -value, torch.full_like(value, 127)):
                np.testing.assert_array_equal(portable.run(None, {"data": candidate.numpy()})[0], model(candidate)[0])
                np.testing.assert_array_equal(reloaded(candidate)[0], model(candidate)[0])


if __name__ == "__main__":
    unittest.main()
