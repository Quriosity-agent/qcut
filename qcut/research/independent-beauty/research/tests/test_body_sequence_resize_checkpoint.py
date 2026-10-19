"""Mask retention and resize transitions remain replayable after cancellation."""
from pathlib import Path
import pickle
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_sequence_checkpoint as checkpoint
import body_smart_sequence as sequence
from body_algorithm_size import body_algorithm_size
from body_composition.native_video import NativeVideoBody
import test_body_sequence_checkpoint as fixtures
from test_body_sequence_native_reset import SyntheticFace, SyntheticSkeleton


CONTROLS = {'SmallHead': 25, 'SlimArm': 25, 'WidenShoulderTest': 25, 'OrthoShoulder': 25}


@unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
class ResizeMaskSnapshots(unittest.TestCase):
    assert_history_equal = fixtures.AbsentBodySnapshot.assert_history_equal

    def setUp(self):
        self.addCleanup(patch.stopall)
        self.raster = patch.object(sequence, 'algorithm_image', side_effect=self.algorithm_image).start()
        patch.object(sequence, 'draw_mesh', side_effect=lambda **kwargs: (kwargs['rgba'].copy(), {})).start()
        patch.object(sequence, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}).start()
        self.mask = np.zeros((7, 11), np.uint8)
        self.mask[:, :5] = 1

    @staticmethod
    def algorithm_image(*, output_size, **unused):
        width, height = output_size
        return np.full((height, width, 4), 255, np.uint8), {}

    @staticmethod
    def new_session():
        session = fixtures.fake_session()

        def initialize():
            session.skeleton, session.face = SyntheticSkeleton(), SyntheticFace()
            session.composition = NativeVideoBody()

        session._initialize.side_effect = initialize
        return session

    @staticmethod
    def advance(*, session, frame, size, mask=None, cancelled=None):
        width, height = size
        return session.process(rgba=np.full((height, width, 4), 255, np.uint8), controls=CONTROLS,
                               stream='resize-mask', frame=frame, timestamp=frame / 30,
                               segmentation_mask=mask, cancelled=cancelled)

    def test_snapshots_before_and_after_resize_keep_mask_and_full_geometry_history(self):
        rows = [(720, 1280), (720, 1280), (720, 1280), (480, 640), (480, 640), (1280, 720), (1280, 720)]
        second_mask = np.ones((5, 9), np.uint8)
        second_mask[1:4, 2:7] = 0
        masks = {0: self.mask, 4: second_mask}
        session = self.new_session()
        expected, snapshots = {}, {}
        for frame, size in enumerate(rows):
            _, receipt = self.advance(session=session, frame=frame, size=size, mask=masks.get(frame))
            changed = frame > 0 and size != rows[frame - 1]
            self.assertEqual(self.raster.call_args.kwargs['output_size'],
                             body_algorithm_size(size=size, source_changed=changed))
            self.assertEqual(session.composition._image_size, size)
            self.assertEqual(session.size, (size[1], size[0]))
            retained_mask = self.mask if frame < 4 else second_mask
            np.testing.assert_array_equal(session.composition.widen_history.history.segmentation_mask, retained_mask)
            data = checkpoint.capture(session=session)
            expected[frame] = receipt['meshSha256'], data
            if frame in (2, 3, 4):
                snapshots[frame] = data
        for saved_frame, data in snapshots.items():
            resumed = self.new_session()
            checkpoint.restore(session=resumed, data=data)
            networks, models = resumed.skeleton.networks, resumed.face.models
            for frame in range(saved_frame + 1, len(rows)):
                with self.subTest(snapshot=saved_frame, frame=frame):
                    _, receipt = self.advance(session=resumed, frame=frame, size=rows[frame], mask=masks.get(frame))
                    self.assertEqual(receipt['meshSha256'], expected[frame][0])
                    self.assert_history_equal(pickle.loads(checkpoint.capture(session=resumed)),
                                              pickle.loads(expected[frame][1]))
            self.assertIs(resumed.face.models, models)
            self.assertIs(resumed.skeleton.networks, networks)
            resumed._initialize.assert_called_once()

    def test_cancel_after_resize_and_mask_replacement_restores_prior_frame_then_replays(self):
        session = self.new_session()
        for frame in range(3):
            self.advance(session=session, frame=frame, size=(720, 1280), mask=self.mask if frame == 0 else None)
        saved = checkpoint.capture(session=session)
        networks, models = session.skeleton.networks, session.face.models
        replacement = np.full((3, 4), 255, np.uint8)
        with self.assertRaises(sequence.BodySequenceCancelled):
            self.advance(session=session, frame=3, size=(1280, 720), mask=replacement,
                         cancelled=lambda: session.composition.frame == 4)
        self.assertTrue(session.invalid)
        self.assertEqual(session.composition._image_size, (1280, 720))
        self.assertEqual(session.size, (1280, 720))
        self.assertEqual(session.next_frame, 3)
        np.testing.assert_array_equal(session.composition.widen_history.history.segmentation_mask, replacement)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            checkpoint.capture(session=session)
        with self.assertRaisesRegex(ValueError, 'reset and replay'):
            self.advance(session=session, frame=3, size=(1280, 720), mask=replacement)
        reference = self.new_session()
        checkpoint.restore(session=reference, data=saved)
        checkpoint.restore(session=session, data=saved)
        np.testing.assert_array_equal(session.composition.widen_history.history.segmentation_mask, self.mask)
        actual, receipt = self.advance(session=session, frame=3, size=(1280, 720), mask=replacement)
        expected, reference_receipt = self.advance(session=reference, frame=3, size=(1280, 720), mask=replacement)
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(receipt['meshSha256'], reference_receipt['meshSha256'])
        self.assert_history_equal(pickle.loads(checkpoint.capture(session=session)),
                                  pickle.loads(checkpoint.capture(session=reference)))
        self.assertEqual((session.next_frame, session.composition.frame), (4, 4))
        self.assertIs(session.face.models, models)
        self.assertIs(session.skeleton.networks, networks)
        session._initialize.assert_called_once()

    def test_bad_mask_on_resized_frame_is_rejected_before_any_history_mutation(self):
        session = self.new_session()
        self.advance(session=session, frame=0, size=(720, 1280), mask=self.mask)
        before = checkpoint.capture(session=session)
        self.raster.reset_mock()
        with self.assertRaisesRegex(ValueError, 'segmentation_mask'):
            self.advance(session=session, frame=1, size=(1280, 720), mask=np.ones((3, 4), np.float32))
        self.raster.assert_not_called()
        self.assertFalse(session.invalid)
        self.assertEqual(checkpoint.capture(session=session), before)


if __name__ == '__main__':
    unittest.main()
