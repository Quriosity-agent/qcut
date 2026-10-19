"""Sparse-history key union, first-frame retention and native removal boundary."""

import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_composition.vertex_history import VertexHistory


class VertexHistoryTests(unittest.TestCase):
    def test_first_frame_keeps_small_displacements_then_later_frames_prune_them(self):
        history = VertexHistory(degree=.2)
        raw = np.array([[[.02, .02], [.025, .025]]], np.float32)
        first = history.update(current=raw, width=400, height=600)
        np.testing.assert_array_equal(first, raw)
        second = history.update(current=raw, width=400, height=600)
        np.testing.assert_array_equal(second[0, 0], [0, 0])
        np.testing.assert_array_equal(second[0, 1], raw[0, 1])
        np.testing.assert_array_equal(first, raw)

    def test_keys_leaving_and_entering_share_one_global_history_weight(self):
        history = VertexHistory(degree=.2)
        history.update(current=np.array([[[1000, 0], [0, 0]]], np.float32), width=400, height=600)
        raw = np.array([[[0, 0], [1000, 0]]], np.float32)
        result = history.update(current=raw, width=400, height=600)
        np.testing.assert_allclose(result[0, :, 0], [900, 100], rtol=0, atol=.0001)
        np.testing.assert_array_equal(result[..., 1], [[0, 0]])
        np.testing.assert_array_equal(raw, [[[0, 0], [1000, 0]]])

    def test_empty_current_map_decays_existing_keys_instead_of_freezing_them(self):
        history = VertexHistory(degree=.2)
        history.update(current=np.array([[[1000, 0]]], np.float32), width=400, height=600)
        result = history.update(current=np.zeros((1, 1, 2), np.float32), width=400, height=600)
        self.assertAlmostEqual(float(result[0, 0, 0]), 800, places=3)
        for _ in range(10):
            result = history.update(current=np.zeros((1, 1, 2), np.float32), width=400, height=600)
        np.testing.assert_array_equal(result, np.zeros((1, 1, 2), np.float32))

    def test_new_stream_does_not_reuse_the_previous_streams_history(self):
        previous = VertexHistory(degree=.2)
        previous.update(current=np.ones((2, 2, 2), np.float32) * 1000, width=400, height=600)
        fresh = VertexHistory(degree=.2)
        raw = np.full((2, 2, 2), .01, np.float32)
        np.testing.assert_array_equal(fresh.update(current=raw, width=400, height=600), raw)

    def test_configuration_assignment_keeps_history_until_the_leaf_executes_again(self):
        history = VertexHistory(degree=.2)
        history.update(current=np.full((2, 2, 2), 1000, np.float32), width=400, height=600)
        history.mark_dirty()
        self.assertTrue(history.dirty)
        np.testing.assert_array_equal(history.values, np.full((2, 2, 2), 1000, np.float32))
        current = np.full((2, 2, 2), .01, np.float32)
        np.testing.assert_array_equal(history.update(current=current, width=400, height=600), current)
        self.assertFalse(history.dirty)

    def test_mode2_execution_copies_raw_without_blending_or_pruning(self):
        history = VertexHistory(degree=.2)
        history.update(current=np.full((2, 2, 2), 1000, np.float32), width=400, height=600)
        current = np.full((2, 2, 2), .01, np.float32)
        result = history.update(current=current, width=400, height=600, reset=True)
        np.testing.assert_array_equal(result, current)
        self.assertFalse(history.dirty)
        subsequent = history.update(current=current, width=400, height=600)
        np.testing.assert_array_equal(subsequent, np.zeros_like(current))

    def test_warm_reset_keeps_stored_values_and_dirty_until_the_next_execution(self):
        for dirty in (False, True):
            with self.subTest(dirty=dirty):
                history = VertexHistory(degree=.2)
                stored = np.full((2, 2, 2), 1000, np.float32)
                history.update(current=stored, width=400, height=600)
                if dirty:
                    history.mark_dirty()
                history.reset_filter()
                self.assertFalse(history.initialized)
                self.assertEqual(history.dirty, dirty)
                np.testing.assert_array_equal(history.values, stored)
                current = np.full((2, 2, 2), .01, np.float32)
                result = history.update(current=current, width=400, height=600)
                np.testing.assert_array_equal(result, current)
                self.assertTrue(history.initialized)
                self.assertFalse(history.dirty)


if __name__ == '__main__':
    unittest.main()
