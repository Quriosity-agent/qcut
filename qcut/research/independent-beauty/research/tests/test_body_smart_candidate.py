"""Boundary, state isolation and single-raster contracts for intelligent body."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_smart_candidate as renderer
from body_face_metadata import rectangle, raw_roll
from body_video_face_metadata import RollFilter
from body_composition.grid import make_grid
from body_mesh_renderer import draw_mesh
from body_skeleton_decode import pose_from_algorithm


def opaque_frame():
    result = np.zeros((64, 32, 4), np.uint8)
    result[..., 3] = 255
    return result


class Controls(unittest.TestCase):
    def test_stage_names_are_unprefixed_and_percentages_are_scaled_once(self):
        values, targets = renderer.validate_controls(controls={'StretchLeg': 60, 'SlimHip': -50})
        self.assertEqual(values, {'StretchLeg': 60.0, 'SlimHip': -50.0})
        self.assertEqual(targets['LongLeg'], np.float32(.21))
        self.assertEqual(targets['SlimHip'], np.float32(-.42))
        self.assertEqual(targets['SmallHead'], 0)

    def test_rejects_bad_controls_before_perception(self):
        for controls in (None, [], {'body_adjust_SlimArm': 20}, {'TotalFace': 20},
                         {'SlimArm': True}, {'SlimHip': float('nan')}, {'SmallHead': -1},
                         {'OrthoShoulder': -1}, {'WidenShoulderTest': 51}):
            with self.subTest(controls=controls), self.assertRaises(ValueError):
                renderer.validate_controls(controls=controls)


class Renderer(unittest.TestCase):
    def test_zero_avoids_models_and_preserves_every_byte(self):
        rgba = opaque_frame()
        rgba[2, 3, :3] = [45, 99, 12]
        _, targets = renderer.validate_controls(controls={'SlimHip': 0})
        with patch.object(renderer, 'perceive', side_effect=AssertionError('models should not load')):
            result, details = renderer.render(rgba=rgba, targets=targets, runtime=Path('/absent'))
        np.testing.assert_array_equal(result, rgba)
        self.assertTrue(details['identity'])
        self.assertFalse(np.shares_memory(result, rgba))

    def test_missing_person_does_not_draw_or_create_shared_state(self):
        rgba = opaque_frame()
        with patch.object(renderer, 'perceive', return_value=(None, {})), patch.object(renderer, 'draw_mesh') as draw:
            result, details = renderer.render(rgba=rgba, targets={'LongLeg': .35}, runtime=Path('/absent'))
        np.testing.assert_array_equal(result, rgba)
        self.assertEqual(details['reason'], 'no person detected')
        draw.assert_not_called()

    def test_combination_samples_once_and_reinitializes_descriptors_per_frame(self):
        rgba = opaque_frame()
        base, uv, tri = make_grid(32, 64)
        delta = np.ones_like(base)
        mesh = {'base': base, 'uv': uv, 'tri': tri, 'positions': base + delta,
                'stages': {key: delta.copy() for key in renderer.ORDER}}
        with patch.object(renderer, 'perceive', return_value=({}, {})), \
                patch.object(renderer, 'create_composition') as combined, \
                patch.object(renderer, 'draw_mesh', return_value=(rgba.copy(), {})) as draw:
            combined.return_value.update.return_value = mesh
            for _ in range(2):
                result, details = renderer.render(rgba=rgba, targets={'SlimArm': .2}, runtime=Path('/absent'))
                self.assertEqual(details['draws'], 1)
            self.assertEqual(combined.call_count, 2)
            self.assertEqual(draw.call_count, 2)
            self.assertEqual(draw.call_args.kwargs['vertices'].shape, (961, 5))

    def test_identity_receipt_has_complete_hash_chain(self):
        rgba = opaque_frame()
        with tempfile.TemporaryDirectory() as directory:
            output, report = Path(directory) / 'image.png', Path(directory) / 'report.json'
            with patch.object(renderer, 'process_images', return_value={'private_native_images': []}):
                receipt = renderer.run(rgba=rgba, controls={}, runtime=Path('/absent'), output=output, report=report)
            np.testing.assert_array_equal(np.asarray(Image.open(output)), rgba)
            self.assertEqual(json.loads(report.read_text()), receipt)
            self.assertEqual(receipt['inputRgbaSha256'], hashlib.sha256(rgba.tobytes()).hexdigest())
            self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
            self.assertFalse(receipt['videoVerified'])

    def test_transparency_is_rejected_before_perception(self):
        rgba = opaque_frame()
        rgba[0, 0, 3] = 0
        with self.assertRaisesRegex(ValueError, 'opaque'):
            renderer.run(rgba=rgba, controls={}, runtime=Path('/absent'), output=None, report=None)


class InputBoundaries(unittest.TestCase):
    def test_identity_and_validation_do_not_import_darwin_geometry(self):
        script = '''
import ctypes
original = ctypes.CDLL
class WithoutDarwin:
    def __init__(self, *args, **kwargs): self.library = original(*args, **kwargs)
    def __getattr__(self, name):
        if name == '__sincosf_stret': raise AttributeError(name)
        return getattr(self.library, name)
ctypes.CDLL = WithoutDarwin
import numpy as np
import body_smart_candidate as renderer
_, targets = renderer.validate_controls(controls={})
source = np.full((32, 32, 4), 255, np.uint8)
output, details = renderer.render(rgba=source, targets=targets, runtime=None)
assert details['identity'] and np.array_equal(source, output)
'''
        subprocess.run([sys.executable, '-B', '-c', script], check=True, capture_output=True,
                       cwd=Path(__file__).resolve().parents[1], timeout=30)

    def test_invalid_mesh_never_launches_gpu(self):
        rgba = opaque_frame()
        vertices = np.zeros((3, 5), np.float32)
        for triangle in ([[0, 1, 3]], [[0, -1, 2]], [[0., 1., 2.]]):
            with self.assertRaisesRegex(ValueError, 'indexed'):
                draw_mesh(rgba=rgba, vertices=vertices, triangles=triangle, runtime=Path('/absent'))

    def test_algorithm_profile_rejects_bad_size_and_pass_count(self):
        for algorithm, passes in ((np.zeros((8, 32, 3), np.uint8), 1),
                                  (np.zeros((32, 32, 3), np.float32), 1),
                                  (np.zeros((32, 32, 3), np.uint8), 0)):
            with self.assertRaises(ValueError):
                pose_from_algorithm(algorithm=algorithm, networks=None, refinement_passes=passes)


class FaceMetadata(unittest.TestCase):
    def test_rectangle_truncates_before_y_up_normalization(self):
        points = np.full((106, 2), [10.7, 20.4], np.float32)
        points[-1] = [40.8, 60.9]
        np.testing.assert_array_equal(rectangle(points=points, size=(100, 200)),
                                      np.asarray([.1, .7, .3, .2], np.float32))

    def test_roll_retains_history_but_a_new_request_starts_fresh(self):
        points = np.zeros((106, 2), np.float32)
        points[[84, 90]] = [10, 20]
        first_filter = RollFilter()
        first = first_filter.update(points=points)
        second = first_filter.update(points=points)
        self.assertGreater(abs(second), abs(first))
        self.assertEqual(first, RollFilter().update(points=points))
        self.assertGreater(raw_roll(points=points), 0)


if __name__ == '__main__':
    unittest.main()
