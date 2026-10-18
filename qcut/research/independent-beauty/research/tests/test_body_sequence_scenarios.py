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
            receipts.append({**receipt, 'unchanged': np.array_equal(result, rgba)})
        return receipts

    def test_several_bodies_on_the_seed_frame_keep_the_frame_and_seed_on_the_next(self):
        receipts = self.run_sequence([with_second_person(rgba=self.frames[0]), *self.frames[1:4]])
        self.assertTrue(receipts[0]['skeleton']['state'].get('ambiguous'))
        self.assertTrue(receipts[0]['unchanged'])
        self.assertFalse(receipts[0]['bodyReported'])
        # Frame 1 seeds silently, frame 2 reports the tracked body.
        self.assertEqual([receipt['bodyReported'] for receipt in receipts], [False, False, True, True])
        self.assertFalse(receipts[2]['unchanged'])

    def test_a_second_person_entering_does_not_disturb_the_tracked_body(self):
        plain = self.run_sequence(self.frames)
        entering = self.run_sequence([*self.frames[:4], *(with_second_person(rgba=frame) for frame in self.frames[4:])])
        self.assertEqual([receipt['bodyReported'] for receipt in entering], [False] + [True] * 7)
        for index in range(4, 8):
            with self.subTest(frame=index):
                self.assertEqual(entering[index]['skeleton']['plan']['mode'], 1)
                self.assertNotIn('ambiguous', entering[index]['skeleton']['state'])
                # The tracked body's geometry is the first person's: the same mesh as without the newcomer.
                self.assertEqual(entering[index]['meshSha256'], plain[index]['meshSha256'])

    def test_a_lost_body_keeps_its_frames_and_the_person_is_found_again(self):
        frames = [*self.frames[:3], without_person(rgba=self.frames[3]), without_person(rgba=self.frames[4]),
                  *self.frames[5:8]]
        receipts = self.run_sequence(frames)
        reported = [receipt['bodyReported'] for receipt in receipts]
        self.assertEqual(reported[:3], [False, True, True])
        self.assertEqual(reported[3:5], [False, False])
        self.assertTrue(all(receipt['unchanged'] for receipt in receipts[3:5]))
        # After the loss the skeleton seeds again: one silent coarse frame, then tracking.
        self.assertEqual(receipts[5]['skeleton']['plan']['mode'], 0)
        self.assertEqual(reported[5:], [False, True, True])
        self.assertFalse(receipts[7]['unchanged'])


if __name__ == '__main__':
    unittest.main()
