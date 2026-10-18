"""Video rejection depends on visibility bands, not a photo probability cutoff."""
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_face_policy import VideoFacePolicy, evaluate_video_face, step_accepts


def policy():
    return {'threshold': .25, 'tables': [[[.5], [40]], [[.8, .4], [10, 60]],
                                        [[.9, .3], [20, 70]], [[.1], [35]]]}


def heads(*, probability, count, channels=3):
    visible = np.full(106, .25, np.float32)
    visible[:count] = np.nextafter(np.float32(.25), np.float32(1))
    return {'prob': np.asarray(probability + [0] * (channels - len(probability)), np.float32),
            'fc_visible': visible}


class VideoFaceAcceptance(unittest.TestCase):
    def test_probability_above_photo_cutoff_can_be_accepted(self):
        result = evaluate_video_face(heads=heads(probability=[.6, .2, .2], count=40), policy=policy())
        self.assertTrue(result['accepted'])
        self.assertEqual(result['visibleCount'], 40)
        self.assertFalse(evaluate_video_face(heads=heads(probability=[.6, .2, .2], count=39),
                                            policy=policy())['accepted'])

    def test_step_boundaries_keep_original_strict_comparisons(self):
        thresholds = np.asarray([.8, .4], np.float32)
        minimum = [10, 60]
        for boundary in thresholds:
            self.assertTrue(step_accepts(score=boundary, visible_count=0,
                                         thresholds=thresholds, minimum_visible=minimum))
        above = np.nextafter(thresholds[0], np.float32(1))
        below = np.nextafter(thresholds[0], np.float32(0))
        self.assertTrue(step_accepts(score=above, visible_count=10,
                                     thresholds=thresholds, minimum_visible=minimum))
        self.assertFalse(step_accepts(score=below, visible_count=10,
                                      thresholds=thresholds, minimum_visible=minimum))

    def test_all_low_classification_bands_still_require_visibility(self):
        data = heads(probability=[.2, .2, .2], count=34)
        self.assertFalse(evaluate_video_face(heads=data, policy=policy())['accepted'])
        data['fc_visible'][34] = .8
        self.assertTrue(evaluate_video_face(heads=data, policy=policy())['accepted'])

    def test_extra_seed_classes_accumulate_into_first_score(self):
        data = heads(probability=[.4, .1, .1, .1, .1], count=39, channels=5)
        result = evaluate_video_face(heads=data, policy=policy())
        self.assertFalse(result['accepted'])
        self.assertEqual(result['scores'][0], float(np.float32(np.float32(.4) + np.float32(.1)) + np.float32(.1)))

    def test_relaxation_changes_visibility_threshold_with_single_final_rounding(self):
        data = heads(probability=[.6, .2, .2], count=0)
        regular = evaluate_video_face(heads=data, policy=policy())
        relaxed = evaluate_video_face(heads=data, policy=policy(), relaxed=True)
        self.assertFalse(regular['accepted'])
        self.assertTrue(relaxed['accepted'])
        self.assertEqual(relaxed['visibleCount'], 106)
        self.assertEqual(relaxed['visibilityThreshold'], float(np.float32(float(np.float32(.25)) * .8)))

    def test_bad_head_or_policy_fails_before_acceptance(self):
        for value in (float('nan'), float('inf'), -1, 2):
            with self.subTest(value=value), self.assertRaises(ValueError):
                evaluate_video_face(heads=heads(probability=[value, .1, .1], count=106), policy=policy())
        for tables in ([], [[[.2, .8], [20, 40]]] * 4, [[[.2], [20, 40]]] * 4):
            with self.subTest(tables=tables), self.assertRaises(ValueError):
                evaluate_video_face(heads=heads(probability=[.1, .1, .1], count=106),
                                    policy={'threshold': .3, 'tables': tables})
        with self.assertRaises(ValueError):
            evaluate_video_face(heads=heads(probability=[.1, .1, .1], count=106), policy=policy(), relaxed=1)

    def test_opt_in_asset_missing_or_modified_is_an_explicit_error(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaisesRegex(ValueError, 'requires private policy asset'):
                VideoFacePolicy(runtime=root)
            (root / 'research').mkdir()
            (root / 'research/body-face-video-policy-v1.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'policy identity'):
                VideoFacePolicy(runtime=root)


if __name__ == '__main__':
    unittest.main()
