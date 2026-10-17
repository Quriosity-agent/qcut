"""QCut-owned smart body: controls, the ten-part pipeline against its accepted meshes, faces and the stage."""
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest
import unittest.mock

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_smart_controls as controls
import body_smart_pipeline as smart
import body_smart_render as render
from alignment_pose_heads import compute_pose_heads, pose_dot
from body_face_metadata import FaceMetadata, raw_roll, rectangle
from body_points import normalize_joints
from body_skeleton_model import ASSET

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
HAS_ASSET = (RUNTIME / 'research' / ASSET).is_file()
FACE_MODELS = ('face-detector-dynamic.onnx', 'face-align-120.onnx', 'face-align-160.onnx', 'alignment-assets-v1.npz')
HAS_FACE_MODELS = all((RUNTIME / 'research' / name).is_file() for name in FACE_MODELS)
PHOTO = Path(os.environ.get('QCUT_BODY_PHOTO', '/nonexistent'))
FIXTURE = json.loads(Path(__file__).with_name('body_smart_fixture.json').read_text())


def frame_args(frame, face=True):
    width, height = FIXTURE['size']
    joints = (np.asarray(frame['joints'], np.float32), np.asarray(frame['visibility'], np.uint8), width, height)
    if not face:
        return joints
    return (*joints, np.asarray(frame['faces'], np.float32), np.asarray(frame['rectangles'], np.float32),
            np.asarray(frame['rolls'], np.float32))


def sha256(array):
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


class Controls(unittest.TestCase):
    def test_slider_values_become_float32_part_targets(self):
        targets = controls.internal_targets(values={'StretchLeg': 35, 'SlimHip': -50, 'WidenShoulderTest': -50,
                                                    'SlimBreast': 50})
        self.assertEqual(targets['LongLeg'], np.float32(0.35 * 0.35))  # 0.1225, not 0.35
        self.assertEqual(targets['SlimHip'], np.float32(0.84 * -0.5))
        self.assertEqual(targets['WidenShoulder'], np.float32(-1))
        self.assertEqual(targets['SlimBreast'], np.float32(1.1 * 0.5))
        self.assertEqual(set(targets), set(smart.ORDER))
        self.assertEqual([name for name, value in targets.items() if value == 0],
                         ['SmallHead', 'SlimWaist', 'SlimBody', 'OrthoShoulder', 'SwanNeck', 'SlimArm'])

    def test_controls_are_validated(self):
        self.assertEqual(controls.validate_controls(values={'SlimHip': -50, 'SmallHead': 0}),
                         {'SlimHip': -50.0, 'SmallHead': 0.0})
        for bad in ({}, {'StretchLeg': 101}, {'StretchLeg': -1}, {'SlimHip': -51}, {'StretchLeg': True},
                    {'StretchLeg': math.nan}, {'Unknown': 10}, [], None):
            with self.subTest(controls=bad), self.assertRaises(ValueError):
                controls.validate_controls(values=bad)


class Pipeline(unittest.TestCase):
    def test_still_mesh_matches_the_accepted_ten_part_mesh(self):
        # The research implementation's mesh for this frame, which matched the effect bit for bit.
        positions = smart.SmartBody().update(*frame_args(FIXTURE['still']), target=0.35)['positions']
        self.assertEqual(sha256(positions), FIXTURE['expected']['stillAllParts035'])

    def test_slider_targets_and_sequences_keep_their_meshes(self):
        expected = FIXTURE['expected']
        for name in ('example', 'full'):
            targets = controls.internal_targets(values=FIXTURE['controls'][name])
            positions = smart.SmartBody().update(*frame_args(FIXTURE['still']), target=targets)['positions']
            key = 'stillExample' if name == 'example' else 'stillFull'
            self.assertEqual(sha256(positions), expected[key], name)
        targets = controls.internal_targets(values=FIXTURE['controls']['example'])
        for mode in (1, 2):
            body = smart.PersistentSmartBody(mode=mode)
            hashes = [sha256(body.update(*frame_args(frame), target=targets)['positions'])
                      for frame in FIXTURE['sequence']]
            self.assertEqual(hashes, expected[f'sequenceMode{mode}'], f'mode {mode}')

    def test_zero_targets_leave_the_grid_alone(self):
        result = smart.SmartBody().update(*frame_args(FIXTURE['still']), target=0.0)
        self.assertFalse(np.any(result['delta']))
        np.testing.assert_array_equal(result['positions'], result['base'])

    def test_the_body_parts_run_without_a_face(self):
        result = smart.SmartBody().update(*frame_args(FIXTURE['still'], face=False), target=0.35)
        self.assertTrue(np.any(result['stages']['LongLeg']))
        self.assertFalse(result['parts']['neck']['valid'])  # the swan neck needs the face

    def test_part_order_and_targets(self):
        self.assertEqual(smart.ORDER, ['SmallHead', 'LongLeg', 'SlimWaist', 'SlimBody', 'OrthoShoulder',
                                       'WidenShoulder', 'SwanNeck', 'SlimHip', 'SlimArm', 'SlimBreast'])
        with self.assertRaisesRegex(ValueError, 'Unknown body target'):
            smart.resolve_targets({'Foo': 1})
        with self.assertRaisesRegex(ValueError, 'Finite'):
            smart.resolve_targets(math.inf)

    def test_joints_are_normalized_with_y_up(self):
        joints = normalize_joints([[90, 160, 0.9, 1], [0, 640, 0.5, 0]], 360, 640)
        np.testing.assert_array_equal(joints['points'], np.float32([[0.25, 0.75], [0, 0]]))
        np.testing.assert_array_equal(joints['visibility'], [1, 0])


class Faces(unittest.TestCase):
    @staticmethod
    def face(points):
        face = np.zeros((106, 2), np.float32)
        for index, point in points.items():
            face[index] = point
        return face

    def test_rectangle_is_normalized_with_y_up_and_truncated(self):
        face = np.full((106, 2), 30, np.float32)
        face[0], face[1] = (10.7, 20.2), (50.9, 80.4)
        np.testing.assert_array_equal(
            rectangle(face, (360, 640)),
            np.float32([10 / 360, (640 - 20 - 60) / 640, 40 / 360, 60 / 640]))

    def test_upright_face_has_no_roll_and_tilts_are_signed(self):
        upright = self.face({55: (100, 100), 58: (120, 100), 84: (105, 140), 90: (115, 140)})
        self.assertAlmostEqual(float(raw_roll(upright)), 0, places=4)  # float32 pi/2 leaves ~2.5e-6
        left = self.face({55: (100, 100), 58: (120, 100), 84: (115, 140), 90: (125, 140)})
        right = self.face({55: (100, 100), 58: (120, 100), 84: (95, 140), 90: (105, 140)})
        self.assertAlmostEqual(float(raw_roll(left)), -float(raw_roll(right)), places=4)
        self.assertNotEqual(raw_roll(left), 0)

    def test_pose_filter_starts_at_zero_and_moves_by_the_step_size(self):
        radians = FaceMetadata().update_degrees(np.float32([3, 0, 0]))
        # A 3-degree step keeps exp(-1) of the old pose (0) on the first frame.
        self.assertAlmostEqual(float(radians[0]), 3 * (1 - math.exp(-1)) * 0.017453294, places=6)
        self.assertEqual(float(radians[1]), 0)

    def test_pose_heads_accumulate_in_four_fused_lanes(self):
        fmaf = ctypes.CDLL(None).fmaf
        fmaf.argtypes, fmaf.restype = [ctypes.c_float] * 3, ctypes.c_float
        rng = np.random.default_rng(7)
        mismatched_sequential = 0
        for _ in range(20):
            features = rng.normal(0, 40, 128).astype(np.float32)
            weights = rng.normal(0, 0.05, 128).astype(np.float32)
            bias = np.float32(rng.normal())
            lanes = [0.0] * 4
            for index in range(128):
                lanes[index % 4] = fmaf(float(features[index]), float(weights[index]), lanes[index % 4])
            lanes = np.float32(lanes)
            expected = np.float32(np.float32(np.float32(lanes[0] + lanes[1]) + np.float32(lanes[2] + lanes[3])) + bias)
            self.assertEqual(pose_dot(features=features, weights=weights, bias=bias), expected)
            sequential = 0.0
            for index in range(128):
                sequential = fmaf(float(features[index]), float(weights[index]), sequential)
            mismatched_sequential += np.float32(np.float32(sequential) + bias) != expected
        self.assertGreater(mismatched_sequential, 0)  # the lane order is observable
        heads = compute_pose_heads(features=np.ones((1, 128), np.float32),
                                   parameters={'fc_yaw': (np.full(128, 0.5, np.float32), np.float32(1)),
                                               'fc_pitch': (np.zeros(128, np.float32), np.float32(-2))})
        self.assertEqual({k: float(v.reshape(-1)[0]) for k, v in heads.items()}, {'fc_yaw': 65.0, 'fc_pitch': -2.0})

    @unittest.skipUnless(HAS_FACE_MODELS, 'runtime face models not installed')
    def test_pose_heads_read_the_alignment_networks_shared_features(self):
        from alignment_infer import Stage1
        for size in (120, 160):
            with self.subTest(size=size):
                plain = Stage1(size=size, model=RUNTIME / 'research' / f'face-align-{size}.onnx')
                pose = Stage1(size=size, model=RUNTIME / 'research' / f'face-align-{size}.onnx', pose_heads=True)
                dtype = np.int8 if size == 160 else np.int16
                tensor = np.random.default_rng(size).integers(-128, 128, (1, size, size, 3)).astype(dtype)
                a, b = plain.infer(tensor=tensor), pose.infer(tensor=tensor)
                self.assertEqual(set(a), set(b))
                for name in set(a) - {'fc_yaw', 'fc_pitch'}:
                    np.testing.assert_array_equal(a[name], b[name])
                for name in ('fc_yaw', 'fc_pitch'):  # recomputed, within ONNX Runtime's rounding of the same dot
                    np.testing.assert_allclose(a[name], b[name], rtol=0, atol=1e-4)


class Renderer(unittest.TestCase):
    def test_zero_keeps_the_photo_without_models(self):
        rgba = np.random.default_rng(1).integers(0, 256, (12, 10, 4), np.uint8)
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = render.run(rgba=rgba, controls={'StretchLeg': 0}, runtime=root / 'missing-runtime',
                                 output=root / 'out.png', report=root / 'out.json')
            self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
            self.assertFalse(receipt['privateAssetDependency'])
            with self.assertRaisesRegex(ValueError, 'not installed'):
                render.run(rgba=rgba, controls={'SlimWaist': 50}, runtime=root / 'missing-runtime',
                           output=root / 'b.png', report=root / 'b.json')
            with self.assertRaisesRegex(ValueError, 'unsupported smart body controls'):
                render.run(rgba=rgba, controls={'Whiten': 50}, runtime=root / 'missing-runtime',
                           output=root / 'c.png', report=root / 'c.json')

    def test_a_still_searches_for_a_face_once_and_tracks_a_found_one_every_update(self):
        class Body:
            def __init__(self):
                self.faces = []

            def update(self, points, visibility, width, height, faces, rectangles, rolls, target):
                self.faces.append(faces)
                return {'faces': list(self.faces)}

        for found in (None, {'faces': 'f', 'rectangles': 'r', 'rolls': 'o'}):
            calls = []

            class Faces:
                detection = {'faces': 0}

                def __init__(self, model_root):
                    pass

                def update(self, algorithm):
                    calls.append(algorithm)
                    return found

            with unittest.mock.patch.object(render, 'BodyFaceSequence', Faces), \
                    unittest.mock.patch.object(render, 'SmartBody', Body), \
                    unittest.mock.patch.object(render, 'algorithm_image', lambda rgba: 'image'), \
                    unittest.mock.patch.object(render, 'normalize_joints',
                                               lambda points, width, height: {'points': 0, 'visibility': 0}):
                result, faces = render.still_frame(rgba=np.zeros((4, 4, 4), np.uint8), points=[], algorithm_size=(4, 4),
                                                   targets={}, runtime=Path('runtime'))
            # The body always takes every update; a frame without one usable face is searched once.
            self.assertEqual(len(result['faces']), render.STILL_UPDATES)
            self.assertEqual(len(calls), 1 if found is None else render.STILL_UPDATES)
            self.assertEqual(faces['faceFound'], found is not None)

    @unittest.skipUnless(HAS_ASSET, 'private body skeleton asset not installed')
    def test_photo_without_a_person_is_unchanged(self):
        rgba = np.full((256, 192, 4), 128, np.uint8)
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = render.run(rgba=rgba, controls={'StretchLeg': 100, 'SmallHead': 50}, runtime=RUNTIME,
                                 output=root / 'out.png', report=root / 'out.json')
            self.assertEqual(receipt['reason'], 'no person detected')
            self.assertEqual(receipt['changedPixels'], 0)
            self.assertTrue(receipt['privateAssetDependency'])

    @unittest.skipUnless(HAS_ASSET and HAS_FACE_MODELS and PHOTO.is_file(),
                         'private assets or QCUT_BODY_PHOTO (a full-body photo with one face) missing')
    def test_real_photo_moves_every_part(self):
        rgba = np.asarray(Image.open(PHOTO).convert('RGBA')).copy()
        values = {'SmallHead': 100, 'SwanNeck': 100, 'SlimArm': 100, 'OrthoShoulder': 100, 'WidenShoulderTest': 50,
                  'SlimBody': 100, 'SlimWaist': 100, 'StretchLeg': 100, 'SlimBreast': 50, 'SlimHip': 50}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = render.run(rgba=rgba, controls=values, runtime=RUNTIME, output=root / 'out.png',
                                 report=root / 'out.json')
            written = json.loads((root / 'out.json').read_text())
        self.assertFalse(receipt['identity'])
        self.assertTrue(receipt['faces']['faceFound'])
        self.assertEqual(receipt['updates'], render.STILL_UPDATES)
        self.assertEqual([name for name, part in receipt['parts'].items() if not part['moved']], [])
        self.assertEqual(written['controls'], {name: float(value) for name, value in values.items()})


class StagePipeline(unittest.TestCase):
    @unittest.skipUnless(HAS_ASSET, 'private body skeleton asset not installed')
    def test_canonical_pipeline_runs_the_smart_body_stage_as_a_subprocess_and_resident(self):
        import independent_pipeline as pipeline
        from independent_stage_runner import run_stage
        rgba = np.full((256, 192, 4), 128, np.uint8)
        rgba[..., 3] = 255
        request = {'values': {'body_adjust_StretchLeg': 60, 'body_adjust_SlimHip': -20}, 'makeup': {}}
        for runner, execution in ((None, 'subprocess'), (run_stage, 'resident')):
            with self.subTest(execution=execution), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                Image.fromarray(rgba).save(directory / 'in.png')
                (directory / 'request.json').write_text(json.dumps(request))
                receipt = pipeline.run(image=directory / 'in.png', request=directory / 'request.json', runtime=RUNTIME,
                                       output=directory / 'out.png', report=directory / 'out.json', stage_runner=runner)
                written = np.asarray(Image.open(directory / 'out.png').convert('RGBA'))
            np.testing.assert_array_equal(written, rgba)  # no person: the photo comes back unchanged
            self.assertEqual(receipt['adjustments'], {'values': {'StretchLeg': 60, 'SlimHip': -20}, 'makeup': {}})
            self.assertEqual([stage['id'] for stage in receipt['stages']], ['smart-body'])
            self.assertEqual(receipt['stages'][0]['execution'], execution)


if __name__ == '__main__':
    unittest.main()
