"""Unit checks for the espresso parser, arena accounting and the measured fixed-point rules."""
import unittest

import numpy as np

import espresso_fixed
import espresso_graph

INT8_GRAPH = "1 2\ndata 1 4 4 2 1 6\nConvolution conv 2 3 3 1 1 1 1 1 1 1 7 4 13 1 5 data conv\nDepthwiseSeparableConvolution dw 2 3 3 2 2 1 1 1 0 1 4 4 9 1 4 conv dw\n"
PACKED_GRAPH = "B\n1 2 12345\nDataV2 data 1 4 4 2 2 6 0\nConvolution conv 2 3 3 1 1 1 1 1 1 2 11 4 17 2 7 data conv\nInnerProduct fc 3 1 0 4 0 4 0 4 0 conv fc\n"


class ParserTest(unittest.TestCase):
    def test_int8_accounting(self):
        result = espresso_graph.analyze(INT8_GRAPH)
        # conv: 2*2*9 int8 + 2 int32 bias; depthwise: 2*9 int8 + 2 int32 bias; no stamp.
        self.assertEqual(result["arena_bytes"], 36 + 8 + 18 + 8)
        self.assertEqual(result["shapes"]["dw"], (1, 2, 2, 2))
        self.assertEqual(result["descriptors"]["conv"], {"type": 1, "fraction": 5})

    def test_packed_accounting_and_stamp(self):
        result = espresso_graph.analyze(PACKED_GRAPH)
        # 36 packed elements -> 54 bytes, 2 int32 bias, dense 3*32 floats + 3 floats, 4-byte stamp.
        self.assertEqual(result["arena_bytes"], 54 + 8 + (96 + 3) * 4 + 4)
        self.assertEqual(result["stamp"], 12345)
        self.assertTrue(result["layers"][1]["packed"])

    def test_odd_packed_count_rejected(self):
        with self.assertRaises(ValueError):
            espresso_graph.analyze("B\n1 1 1\nDataV2 data 1 4 4 1 2 6 0\nConvolution conv 1 1 1 1 1 0 0 0 0 2 11 4 17 2 7 data conv\n")

    def test_crop_and_upsample_rows(self):
        text = "1 2\ndata 1 10 10 1 1 6\nCrop crop 3 2 0 4 5 1 data crop\nUpsample up 4.0 linear 0 1 crop up\n"
        result = espresso_graph.analyze(text)
        self.assertEqual(result["shapes"]["crop"], (1, 4, 5, 1))
        self.assertEqual(result["shapes"]["up"], (1, 16, 20, 1))


class RuleTest(unittest.TestCase):
    def test_requantize_rounds_half_up(self):
        values = np.array([128, -128, 126, -126, 130, -130, 254, -254, -256])
        self.assertEqual(espresso_fixed.requantize(values, 8).tolist(), [1, 0, 0, 0, 1, -1, 1, -1, -1])

    def test_packed_kernel_decode(self):
        arena = bytes([0x12, 0x3A, 0xBC]) + bytes([0x00, 0x0F, 0xFF])
        values, cursor = espresso_fixed.decode_kernel(arena, 0, 4, {"type": 2, "fraction": 11}, True)
        # raw 4095 decodes to 2048: the runtime does not clamp kernel values (probe D4095).
        self.assertEqual(values.tolist(), [0x123 - 2047, 0xABC - 2047, -2047, 2048])
        self.assertEqual(cursor, 6)

    def test_rounding_shift_after_a_single_wrap(self):
        # INT32_MIN bias plus a small negative sum wraps to a large positive int32; the rounding
        # shift must not wrap again (heatmap net, channel with bias -2^31).
        text = "1 1\ndata 1 1 1 1 1 4\nConvolution conv 1 1 1 1 1 0 0 1 0 1 11 4 15 1 6 data conv\n"
        arena = np.array([-99], dtype=np.int8).tobytes() + np.array([-(2**31)], dtype="<i4").tobytes()
        out = espresso_fixed.run(text, arena, {"data": (np.array([1]).reshape(1, 1, 1, 1), [1, 4])})["conv"]["data"]
        self.assertEqual(int(out.reshape(-1)[0]), 127)

    def test_upsampling_modes(self):
        text = "1 2\ndata 1 2 2 1 2 6\nUpSampling lin data lin LINEAR\nUpSampling bil data bil BILINEAR\n"
        x = np.array([0, 64, -64, 127]).reshape(1, 2, 2, 1)
        out = espresso_fixed.run(text, b"\0", {"data": (x, [2, 6])})
        self.assertEqual(out["lin"]["data"][0, :, :, 0].tolist()[0], [0, 12, 36, 36])
        self.assertEqual(out["bil"]["data"][0, :, :, 0].tolist()[0], [0, 16, 48, 64])

    def test_shufflenet_int16_lane_clamp_and_concat_passthrough(self):
        # Probe OOR-SN: the int16 ShuffleNet clamps channels 0-3 of each 8 from above and 4-7 from below,
        # even without rescaling; Concat at the same scale passes out-of-range values through.
        text = ("2 2\na 1 1 1 8 2 7\nb 1 1 1 8 2 7\nShuffleNet sn 2 a b 4 2 o0 7 o1 7\n"
                "Concat cat 2 a b cat 2 7\n")
        vals = np.array([3000, -4094, 2047, -2047, 100, -100, 4094, -3000]).reshape(1, 1, 1, 8)
        out = espresso_fixed.run(text, b"\0", {"a": (vals, [2, 7]), "b": (vals, [2, 7])})
        self.assertEqual(out["o0"]["data"].reshape(-1).tolist(), [2047, -4094, 2047, -2047, 3000, -2047, 2047, -2047])
        self.assertEqual(out["o1"]["data"].reshape(-1).tolist(), [100, -100, 2047, -3000, 100, -100, 4094, -2047])
        self.assertEqual(out["cat"]["data"].reshape(-1).tolist(), vals.reshape(-1).tolist() * 2)

    def test_two_class_fixed_point_softmax(self):
        # Probe micro12: x=(64,65)@6 -> p0 = 0.49511719 (frecpe of 1 + exp(1/64)), p1 = 1 - p0.
        text = "1 1\ndata 1 1 1 2 2 6\nSoftmax sm data sm\n"
        out = espresso_fixed.run(text, b"\0", {"data": (np.array([64, 65]).reshape(1, 1, 1, 2), [2, 6])})["sm"]["data"]
        self.assertEqual(out.reshape(-1).tolist(), [0.4951171875, 0.5048828125])

    def test_shufflenet_int8_saturates(self):
        text = "2 1\na 1 1 1 8 1 3\nb 1 1 1 8 1 3\nShuffleNet sn 2 a b 4 2 o0 3 o1 4\n"
        vals = np.array([100, -100, 64, -64, 127, -128, 30, -30]).reshape(1, 1, 1, 8)
        out = espresso_fixed.run(text, b"\0", {"a": (vals, [1, 3]), "b": (vals, [1, 3])})
        self.assertEqual(out["o1"]["data"].reshape(-1).tolist(), [127, -128, 60, -60, 127, -128, 60, -60])

    def test_int32_wrap(self):
        self.assertEqual(espresso_fixed.wrap32(np.array([2**31, -(2**31) - 1, 5])).tolist(), [-(2**31), 2**31 - 1, 5])

    def test_reciprocal_estimate_matches_frecpe(self):
        estimate = espresso_fixed.reciprocal_estimate(np.array([1.0, 2.0, 4.0, 1.367879], dtype=np.float32))
        self.assertEqual(estimate.tolist(), [0.998046875, 0.49902343750, 0.24951171875, 0.73046875])

    def test_shuffle_lanes(self):
        data = np.arange(1, 17).reshape(1, 1, 1, 16)
        self.assertEqual(espresso_fixed.shuffle_lanes(data, 2)[0, 0, 0].tolist(), [1, 2, 3, 4, 9, 10, 11, 12, 5, 6, 7, 8, 13, 14, 15, 16])

    def test_upsample_x2_zero_padded_table(self):
        blob = {"data": np.array([[0, 64], [-64, 127]]).reshape(1, 2, 2, 1), "type": 1, "frac": 6}
        expected = [[0, 12, 36, 36], [-12, 7, 55, 59], [-36, -9, 71, 83], [-36, -13, 59, 71]]
        self.assertEqual(espresso_fixed.upsample_x2(blob)["data"][0, :, :, 0].tolist(), expected)

    def test_upsample_linear_edge_clamped_table(self):
        blob = {"data": np.array([[0, 64], [-64, 127]]).reshape(1, 2, 2, 1), "type": 2, "frac": 6}
        rows = espresso_fixed.upsample_linear(blob, 4.0)["data"][0, :, :, 0].tolist()
        self.assertEqual(rows[0], [0, 0, 8, 24, 40, 56, 64, 64])
        self.assertEqual(rows[6], [-64, -64, -41, 7, 55, 103, 127, 127])

    def test_conv_probe_values(self):
        # Probe A: co=2 ci=2 1x1 int8, arena [12,24,36,48], pixel(0,0) ci0=1.0 -> [3, 9]; pixel(0,1) ci1=1.0 -> [6, 12].
        text = "1 1\ndata 1 2 2 2 1 6\nConvolution conv 2 1 1 1 1 0 0 0 0 1 7 4 13 1 5 data conv\n"
        arena = np.array([12, 24, 36, 48], dtype=np.int8).tobytes()
        x = np.zeros((1, 2, 2, 2), dtype=np.int64)
        x[0, 0, 0, 0] = 64
        x[0, 0, 1, 1] = 64
        out = espresso_fixed.run(text, arena, {"data": (x, [1, 6])})["conv"]["data"]
        self.assertEqual(out[0, 0, 0].tolist(), [3, 9])
        self.assertEqual(out[0, 0, 1].tolist(), [6, 12])

    def test_eltwise_common_scale(self):
        # Probe EL: a@7=[1,2,3,6], b@6=[1,1,1,1] -> out@5 = [1,1,1,2].
        text = "2 1\na 1 2 2 1 1 7\nb 1 2 2 1 1 6\nEltwise sum a b sum 1 5 0\n"
        a = np.array([1, 2, 3, 6]).reshape(1, 2, 2, 1)
        b = np.ones((1, 2, 2, 1), dtype=np.int64)
        out = espresso_fixed.run(text, b"\0", {"a": (a, [1, 7]), "b": (b, [1, 6])})["sum"]["data"]
        self.assertEqual(out.reshape(-1).tolist(), [1, 1, 1, 2])


if __name__ == "__main__":
    unittest.main()
