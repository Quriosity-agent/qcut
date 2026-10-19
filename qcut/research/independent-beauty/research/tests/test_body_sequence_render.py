"""Offline manifests preserve event order and validate before advancing any frame."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_sequence_render as module
import body_smart_sequence


RESET = {'type': 'reset_params'}
SET_HEAD = {'type': 'set_control', 'name': 'SmallHead', 'value': 25}


class OfflineBodyEvents(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / 'source.png'
        self.manifest = self.root / 'manifest.json'
        self.output = self.root / 'output'
        self.rgba = np.full((64, 48, 4), 255, np.uint8)
        Image.fromarray(self.rgba).save(self.source)
        self.engine = body_smart_sequence.BodySmartSequence(runtime=self.root / 'runtime')
        base = np.asarray([[[0, 0], [48, 0]], [[0, 64], [48, 64]]], np.float32)
        self.composition = Mock()
        self.composition.update.return_value = {'base': base, 'positions': base.copy()}

        def initialize():
            self.engine.skeleton = Mock()
            self.engine.skeleton.update.return_value = None
            self.engine.skeleton.last_debug = {'network': 'coarse', 'plan': {}, 'state': {'objects': 0}}
            self.engine.face = Mock()
            self.engine.face.update.return_value = (None, {})
            self.engine.composition = self.composition

        self.addCleanup(patch.stopall)
        self.initialize = patch.object(self.engine, '_initialize', side_effect=initialize).start()
        self.construct = patch.object(module, 'BodySmartSequence', return_value=self.engine).start()
        patch.object(body_smart_sequence, 'algorithm_image', return_value=(self.rgba, {})).start()
        patch.object(body_smart_sequence, 'process_images',
                     return_value={'loaded_images': [], 'private_native_images': []}).start()

    def row(self, *, timestamp=0, **extra):
        return {'image': str(self.source), 'timestampSeconds': timestamp,
                'controls': {'SlimBody': 40}, **extra}

    def render(self, *, rows):
        self.manifest.write_text(json.dumps({'stream': 'offline', 'frames': rows}))
        return module.render_sequence(manifest=self.manifest, runtime=self.root / 'runtime', output=self.output)

    def test_legacy_manifest_without_events_keeps_all_frames_and_receipts(self):
        report = self.render(rows=[self.row(), self.row(timestamp=1 / 30)])
        self.assertEqual((report['inputFrames'], report['outputFrames'], report['frameDropCount']), (2, 2, 0))
        self.assertEqual(self.engine.next_frame, 2)
        self.initialize.assert_called_once()
        for index, receipt in enumerate(report['frames']):
            self.assertEqual(receipt['controls'], {'SlimBody': 40.0})
            written = json.loads((self.output / f'frame-{index:06d}.json').read_text())
            self.assertEqual(written, receipt)
            with Image.open(self.output / receipt['output']) as image:
                np.testing.assert_array_equal(np.asarray(image), self.rgba)
        for call in self.composition.configure_controls.call_args_list:
            self.assertEqual(call.kwargs, {'controls': {'SlimBody': 40.0}, 'reapply': False})

    def test_ordered_events_use_current_baseline_and_write_effective_controls(self):
        rows = [self.row(control_events=[RESET, SET_HEAD]),
                self.row(timestamp=.1, control_events=[SET_HEAD, RESET]),
                self.row(timestamp=.2), self.row(timestamp=.3, controls={})]
        original = copy.deepcopy(rows)
        with patch.object(module, 'parse_json', return_value={'stream': 'offline', 'frames': rows}):
            report = self.render(rows=rows)
        expected = [{'SmallHead': 25.0}, {}, {'SlimBody': 40.0}, {}]
        self.assertEqual(rows, original)
        self.assertEqual([receipt['controls'] for receipt in report['frames']], expected)
        self.assertEqual([call.kwargs for call in self.composition.configure_controls.call_args_list],
                         [{'controls': values, 'reapply': index < 2} for index, values in enumerate(expected)])
        self.assertEqual([call.kwargs['reset_clock'] for call in self.composition.configure_frame.call_args_list],
                         [True, True, False, False])
        self.assertEqual(json.loads((self.output / 'report.json').read_text()), report)

    def test_repeated_reversed_and_jumping_time_keeps_contiguous_frame_order(self):
        timestamps = [0, .4, .4, .02, 1]
        report = self.render(rows=[self.row(timestamp=timestamp) for timestamp in timestamps])
        self.assertEqual([receipt['frame'] for receipt in report['frames']], list(range(len(timestamps))))
        self.assertEqual([receipt['timestampSeconds'] for receipt in report['frames']], timestamps)
        self.assertEqual([call.kwargs['timestamp'] for call in self.composition.configure_frame.call_args_list], timestamps)
        self.initialize.assert_called_once()
        self.engine.skeleton.reset.assert_not_called()
        self.assertFalse(self.engine.invalid)

    def test_bad_later_frame_is_rejected_before_output_or_model_initialization(self):
        invalid_rows = [None, {}, {**self.row(), 'unexpected': True}, self.row(image='relative.png'),
                        self.row(controls={'SmallHead': 101}), self.row(controls={'unknown': 1}),
                        *[self.row(timestamp=value) for value in (True, None, -1, '0')],
                        *[self.row(control_events=value) for value in (None, {}, 'reset_params')],
                        self.row(control_events=[RESET, SET_HEAD, {**SET_HEAD, 'value': 101}]),
                        self.row(control_events=[{**RESET, 'extra': True}]),
                        self.row(control_events=[{'type': 'set_control', 'name': 'LongLeg', 'value': 25}])]
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(ValueError):
                self.render(rows=[self.row(), row])
            self.assertFalse(self.output.exists())
            self.construct.assert_not_called()
            self.initialize.assert_not_called()
            self.assertEqual(self.engine.next_frame, 0)

    def test_nonfinite_time_is_rejected_even_from_an_already_parsed_manifest(self):
        for value in (float('nan'), float('inf'), -float('inf')):
            data = {'stream': 'offline', 'frames': [self.row(), self.row(timestamp=value)]}
            with patch.object(module, 'parse_json', return_value=data), self.assertRaises(ValueError):
                self.render(rows=data['frames'])
            self.assertFalse(self.output.exists())
            self.construct.assert_not_called()

    def test_masks_are_loaded_per_frame_and_null_is_forwarded_as_absence(self):
        path = self.root / 'mask.png'
        pixels = np.arange(35, dtype=np.uint8).reshape(5, 7)
        Image.fromarray(pixels).save(path)
        loader = module.load_segmentation_mask
        loaded_at = []

        def load_mask(*, path):
            loaded_at.append(self.engine.next_frame)
            return loader(path=path)

        with patch.object(module, 'load_segmentation_mask', side_effect=load_mask):
            report = self.render(rows=[self.row(segmentation_mask=str(path)),
                                       self.row(timestamp=.4, segmentation_mask=None),
                                       self.row(timestamp=.43)])
        self.assertEqual(loaded_at, [0, 1, 2])
        calls = self.composition.update.call_args_list
        np.testing.assert_array_equal(calls[0].kwargs['segmentation_mask'], pixels)
        self.assertIsNone(calls[1].kwargs['segmentation_mask'])
        self.assertIsNone(calls[2].kwargs['segmentation_mask'])
        self.assertEqual(report['frames'][0]['segmentationMaskSource'], str(path))
        self.assertIsNone(report['frames'][1]['segmentationMaskSource'])
        self.assertNotIn('segmentationMaskSource', report['frames'][2])

    def test_mask_loader_returns_owned_bytes(self):
        path = self.root / 'mask.png'
        Image.new('L', (7, 5), 127).save(path)
        mask = module.load_segmentation_mask(path=str(path))
        self.assertTrue(mask.flags.owndata)
        self.assertTrue(mask.flags.c_contiguous)
        path.unlink()
        np.testing.assert_array_equal(mask, np.full((5, 7), 127, np.uint8))
        self.assertIsNone(module.load_segmentation_mask(path=None))

    def test_invalid_later_mask_header_is_rejected_before_output_or_models(self):
        invalid = ['relative.png', 1, {}, str(self.root / 'missing.png')]
        for index, mode in enumerate(('RGB', 'RGBA', 'LA', 'P', '1', 'I;16')):
            path = self.root / f'invalid-{index}.png'
            Image.new(mode, (7, 5)).save(path)
            invalid.append(str(path))
        jpeg = self.root / 'jpeg.png'
        Image.new('L', (7, 5)).save(jpeg, format='JPEG')
        invalid.append(str(jpeg))
        huge = self.root / 'too-wide.png'
        Image.new('L', (16385, 1)).save(huge)
        invalid.append(str(huge))
        for path in invalid:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.render(rows=[self.row(), self.row(timestamp=.03, segmentation_mask=path)])
            self.assertFalse(self.output.exists())
            self.construct.assert_not_called()
            self.assertEqual(self.engine.next_frame, 0)

    @unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
    def test_real_composition_retains_mask_across_null_and_warm_reset(self):
        from body_composition.native_video import NativeVideoBody

        self.composition = NativeVideoBody()
        path = self.root / 'retained-mask.png'
        pixels = np.arange(35, dtype=np.uint8).reshape(5, 7)
        Image.fromarray(pixels).save(path)
        self.render(rows=[self.row(segmentation_mask=str(path)),
                          self.row(timestamp=.4, segmentation_mask=None),
                          self.row(timestamp=.43, control_events=[RESET])])
        np.testing.assert_array_equal(self.composition.widen_history.history.segmentation_mask, pixels)
        self.assertTrue(self.composition.widen_history.state['segmentation'])
        self.composition.reset()
        self.assertIsNone(self.composition.widen_history.history.segmentation_mask)


if __name__ == '__main__':
    unittest.main()
