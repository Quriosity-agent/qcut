"""Body-video sessions on composited real frames: several bodies, a second person, a lost body."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_smart_sequence import BodySmartSequence
from facefitting_image import decode_image

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
VIDEO_ASSETS = ('body-skeleton-v1.npz', 'body-face-video-policy-v1.json', 'face-detector-dynamic.onnx',
                'face-align-120.onnx', 'face-align-160.onnx', 'alignment-assets-v1.npz')
HAS_VIDEO_RUNTIME = all((RUNTIME / 'research' / name).is_file() for name in VIDEO_ASSETS)
# Ordered PNG frames (frame-*.png) of one upright full-body person filling the frame's centre.
FRAMES = Path(os.environ.get('QCUT_BODY_VIDEO_FRAMES', '/nonexistent'))
CONTROLS = {'SlimBody': 40, 'StretchLeg': 30, 'SmallHead': 20}


def with_second_person(*, rgba):
    """The person again on the right third, mirrored: a second body away from the first."""
    height, width = rgba.shape[:2]
    result = rgba.copy()
    third = width // 3
    person = rgba[:, third:2 * third]
    result[:, 2 * third:2 * third + person.shape[1]] = person[:, ::-1]
    return result


def without_person(*, rgba):
    """The frame's top band (sky and trees) tiled over the whole picture: scenery, no body."""
    height = rgba.shape[0]
    band = rgba[:height // 6]
    repeats = -(-height // band.shape[0])
    return np.ascontiguousarray(np.tile(band, (repeats, 1, 1))[:height])


@unittest.skipUnless(HAS_VIDEO_RUNTIME and len(list(FRAMES.glob('frame-*.png'))) >= 8,
                     'private video runtime or QCUT_BODY_VIDEO_FRAMES (8+ frames of one person) missing')
class CompositedScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = [decode_image(image=path, max_edge=4096)['rgba']
                      for path in sorted(FRAMES.glob('frame-*.png'))[:8]]
        cls.environment = patch.dict(os.environ, {'BEAUTY_RENDER_RESOLUTION': 'original'})
        cls.environment.start()

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()

    def run_sequence(self, frames):
        session = BodySmartSequence(runtime=RUNTIME)
        receipts = []
        for index, rgba in enumerate(frames):
            result, receipt = session.process(rgba=rgba, controls=CONTROLS, stream='scenario', frame=index,
                                              timestamp=index / 24)
            receipts.append({**receipt, 'unchanged': np.array_equal(result, rgba),
                             'compositionFrame': session.composition.frame})
        return receipts

    def test_several_bodies_seed_the_first_eligible_body_then_track_on_the_next_frame(self):
        receipts = self.run_sequence([with_second_person(rgba=self.frames[0]), *self.frames[1:4]])
        self.assertEqual(receipts[0]['skeleton']['state']['objects'], 1)
        self.assertIn('meshSha256', receipts[0])
        self.assertEqual(receipts[0]['compositionFrame'], 1)
        self.assertFalse(receipts[0]['bodyReported'])
        self.assertEqual([receipt['bodyReported'] for receipt in receipts], [False, True, True, True])
        self.assertFalse(receipts[2]['unchanged'])

    def test_second_valid_face_is_kept_while_the_tracked_body_continues(self):
        entering = [*self.frames[:4], *(with_second_person(rgba=frame) for frame in self.frames[4:])]
        session = BodySmartSequence(runtime=RUNTIME)
        receipts = []
        for index, rgba in enumerate(entering):
            result, receipt = session.process(rgba=rgba, controls=CONTROLS, stream='scenario', frame=index,
                                             timestamp=index / 24)
            receipts.append({**receipt, 'unchanged': np.array_equal(result, rgba)})
        self.assertFalse(session.invalid)
        self.assertEqual(session.next_frame, len(entering))
        self.assertEqual([receipt['bodyReported'] for receipt in receipts], [False] + [True] * 7)
        self.assertTrue(any(sum(not slot['new'] for slot in receipt['face']['slots']) >= 2 for receipt in receipts))
        for index, receipt in enumerate(receipts[4:], 4):
            with self.subTest(frame=index):
                self.assertEqual(receipt['skeleton']['plan']['mode'], 1)
                self.assertFalse(receipt['unchanged'])

    def test_a_lost_body_advances_retained_geometry_before_the_person_is_found_again(self):
        frames = [*self.frames[:3], without_person(rgba=self.frames[3]), without_person(rgba=self.frames[4]),
                  *self.frames[5:8]]
        receipts = self.run_sequence(frames)
        reported = [receipt['bodyReported'] for receipt in receipts]
        self.assertEqual(reported[:3], [False, True, True])
        self.assertEqual(reported[3:5], [False, False])
        self.assertEqual([receipt['compositionFrame'] for receipt in receipts], list(range(1, 9)))
        for frame, receipt in enumerate(receipts[3:5], 3):
            with self.subTest(frame=frame):
                self.assertFalse(receipt['unchanged'])
                self.assertFalse(receipt['identity'])
                self.assertGreater(receipt['maximumDisplacementPixels'], 0)
                self.assertIn('meshSha256', receipt)
        # After the loss the skeleton seeds again: one silent coarse frame, then tracking.
        self.assertEqual(receipts[5]['skeleton']['plan']['mode'], 0)
        self.assertEqual(reported[5:], [False, True, True])
        self.assertFalse(receipts[7]['unchanged'])


if __name__ == '__main__':
    unittest.main()
