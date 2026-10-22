"""Independent local controls preserve endpoints, direction and pose refusal."""
import json
import unittest

import numpy as np

from body.region_shape import REGION_RANGES, build_region_delta
from body.leg_shape import safe_leg_delta
from body.cpu_raster import draw_mesh


WIDTH, HEIGHT = 1000, 1600


def grid(*, width=WIDTH, height=HEIGHT):
    xx, yy = np.meshgrid(np.linspace(0, width, 81), np.linspace(0, height, 81))
    return np.stack((xx, yy), axis=-1).astype(np.float32)


def pose():
    result = np.zeros((18, 4), dtype=np.float32)
    for index, point in {2: (300, 350), 5: (700, 350), 8: (350, 750), 9: (360, 1100),
                         10: (350, 1450), 11: (650, 750), 12: (640, 1100),
                         13: (650, 1450)}.items():
        result[index] = [*point, .95, 1]
    return result


def indices():
    result = []
    for row in range(80):
        for col in range(80):
            a = row * 81 + col
            result.extend(((a, a + 81, a + 82), (a, a + 82, a + 1)))
    return np.asarray(result, dtype=np.uint32)


def render(*, rgba, base, delta):
    dimensions = np.array([rgba.shape[1], rgba.shape[0]], np.float32)
    vertices = np.concatenate(((base + delta) / dimensions * 2 - 1,
        np.zeros((*base.shape[:2], 1), np.float32), base / dimensions), axis=-1).reshape(-1, 5)
    return draw_mesh(rgba=rgba, vertices=vertices, triangles=indices(), runtime=None)[0]


class RegionShapeTests(unittest.TestCase):
    def setUp(self):
        self.base, self.pose = grid(), pose()

    def build(self, *, controls, points=None, base=None, size=None):
        return build_region_delta(base=self.base if base is None else base,
                                  pose=self.pose if points is None else points,
                                  algorithm_size=[WIDTH, HEIGHT] if size is None else size,
                                  width=WIDTH, height=HEIGHT, controls=controls)

    def test_zero_is_exact_identity_without_pose(self):
        delta, details = build_region_delta(base=self.base, pose=None, algorithm_size=None,
            width=WIDTH, height=HEIGHT, controls={name: 0 for name in REGION_RANGES})
        np.testing.assert_array_equal(delta, 0)
        self.assertEqual(delta.dtype, np.float32)
        self.assertEqual(set(details), set(REGION_RANGES))
        self.assertTrue(all(not item['moved'] and item['reason'] == 'zero' for item in details.values()))

    def test_lower_abdomen_tucks_horizontally_without_moving_upper_waist_or_hips(self):
        delta, parts = self.build(controls={'Abdomen': 100})
        part = parts['Abdomen']
        self.assertTrue(part['moved'])
        x, y = self.base[..., 0], HEIGHT - self.base[..., 1]
        np.testing.assert_array_equal(delta[..., 1], 0)
        self.assertTrue(np.all(delta[x < 500, 0] >= 0))
        self.assertTrue(np.all(delta[x > 500, 0] <= 0))
        np.testing.assert_array_equal(delta[(y <= 590) | (y >= 750)], 0)
        self.assertEqual(part['shapeModel'], '2d-pose-anchored-contour')

    def test_butt_lift_is_upward_and_local_to_lower_hip(self):
        delta, parts = self.build(controls={'ButtLift': 100})
        self.assertTrue(parts['ButtLift']['moved'])
        np.testing.assert_array_equal(delta[..., 0], 0)
        self.assertTrue(np.all(delta[..., 1] >= 0))
        y = HEIGHT - self.base[..., 1]
        np.testing.assert_array_equal(delta[(y <= 750) | (y >= 1100)], 0)
        self.assertFalse(parts['ButtLift']['posteriorProjection'])
        self.assertNotEqual(parts['ButtLift']['support']['center'][1], 750)

    def test_butt_width_is_signed_and_does_not_reuse_the_abdomen_region(self):
        narrow, parts = self.build(controls={'ButtShape': -50})
        wide, _ = self.build(controls={'ButtShape': 50})
        np.testing.assert_array_equal(narrow, -wide)
        np.testing.assert_array_equal(wide[..., 1], 0)
        x, y = self.base[..., 0], HEIGHT - self.base[..., 1]
        self.assertTrue(np.all(wide[x < 500, 0] <= 0))
        self.assertTrue(np.all(wide[x > 500, 0] >= 0))
        np.testing.assert_array_equal(wide[y < 690], 0)
        self.assertTrue(parts['ButtShape']['moved'])

    def test_all_controls_pin_canvas_borders_and_distant_regions(self):
        for name, (_, maximum) in REGION_RANGES.items():
            with self.subTest(name=name):
                delta, parts = self.build(controls={name: maximum})
                self.assertTrue(parts[name]['moved'])
                np.testing.assert_array_equal(delta[[0, -1]], 0)
                np.testing.assert_array_equal(delta[:, [0, -1]], 0)
                np.testing.assert_array_equal(delta[HEIGHT - self.base[..., 1] < 350], 0)
                np.testing.assert_array_equal(delta[HEIGHT - self.base[..., 1] >= 1450], 0)
                json.dumps(parts, allow_nan=False)

    def test_ankle_width_narrows_or_widens_both_lower_legs_and_pins_shoes(self):
        narrow, parts = self.build(controls={'AnkleWidth': -50})
        wide, _ = self.build(controls={'AnkleWidth': 50})
        np.testing.assert_array_equal(narrow, -wide)
        np.testing.assert_array_equal(wide[..., 1], 0)
        self.assertTrue(parts['AnkleWidth']['moved'])
        y = HEIGHT - self.base[..., 1]
        foot_top = parts['AnkleWidth']['fixedFootFromY']
        np.testing.assert_array_equal(wide[y >= foot_top], 0)
        np.testing.assert_array_equal(wide[y < 1140], 0)
        for side in parts['AnkleWidth']['anchors']['sides']:
            knee, ankle = np.asarray(side['knee']), np.asarray(side['ankle'])
            center_y = (side['topY'] + side['bottomY']) / 2
            center_x = knee[0] + (ankle[0] - knee[0]) * (center_y - knee[1]) / (ankle[1] - knee[1])
            sample = np.array([[center_x - 20, HEIGHT - center_y],
                               [center_x + 20, HEIGHT - center_y]], dtype=np.float32)
            result, _ = self.build(controls={'AnkleWidth': 50}, base=sample)
            self.assertLess(result[0, 0], 0)
            self.assertGreater(result[1, 0], 0)

    def test_straightening_moves_knees_toward_their_hip_ankle_axis_without_overshoot(self):
        sample = self.pose[[8, 9, 10, 11, 12, 13], :2].copy()
        sample[:, 1] = HEIGHT - sample[:, 1]
        previous_errors = np.array([10., 10.])
        for value in (0, 25, 50, 100):
            with self.subTest(value=value):
                delta, parts = self.build(controls={'LegStraighten': value}, base=sample)
                np.testing.assert_array_equal(delta[[0, 2, 3, 5]], 0)
                np.testing.assert_array_equal(delta[:, 1], 0)
                errors = np.abs((sample + delta)[[1, 4], 0] - [350, 650])
                self.assertTrue(np.all(errors <= previous_errors))
                previous_errors = errors
                if value:
                    self.assertTrue(parts['LegStraighten']['moved'])
        np.testing.assert_allclose(previous_errors, 0, atol=1e-5)

    def test_straightening_translates_the_knee_cross_section_without_squeezing_it(self):
        points = np.array([[310, 500], [360, 500], [410, 500],
                           [590, 500], [640, 500], [690, 500], [500, 500]], np.float32)
        for value in (25, 50, 100):
            delta, parts = self.build(controls={'LegStraighten': value}, base=points)
            np.testing.assert_allclose(delta[:3, 0], -10 * value / 100)
            np.testing.assert_allclose(delta[3:6, 0], 10 * value / 100)
            np.testing.assert_array_equal(delta[6], 0)
            np.testing.assert_allclose(np.diff((points + delta)[:3, 0]), [50, 50])
            self.assertTrue(parts['LegStraighten']['support']['targetIsOriginalHipAnkleAxis'])

    def test_widest_accepted_knee_corrections_remain_unfolded_and_separate(self):
        for offset in (-30, 30):
            points = self.pose.copy()
            points[9, 0], points[12, 0] = 350 + offset, 650 - offset
            delta, parts = self.build(controls={'LegStraighten': 100}, points=points)
            self.assertTrue(parts['LegStraighten']['moved'])
            vertices = (self.base + delta).reshape(-1, 2)[indices()]
            a, b = vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0]
            signed_areas = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
            self.assertTrue(np.all(signed_areas < -20))
            _, scale = safe_leg_delta(base=self.base, existing_delta=np.zeros_like(self.base),
                                      leg_delta=delta, triangles=indices())
            self.assertEqual(scale, 1.)
            y = HEIGHT - self.base[..., 1]
            np.testing.assert_array_equal(delta[(y <= 750) | (y >= 1400)], 0)

    def test_lift_plateau_pins_hips_and_knees_including_uneven_hips(self):
        points = self.pose.copy()
        points[[11, 12], 1] += 60
        anchors = points[[8, 9, 11, 12], :2].copy()
        anchors[:, 1] = HEIGHT - anchors[:, 1]
        delta, part = self.build(controls={'ButtLift': 100}, points=points, base=anchors)
        np.testing.assert_array_equal(delta, 0)
        self.assertTrue(part['ButtLift']['anchors']['hipsPinned'])
        plateau = np.array([[400, HEIGHT - 880], [500, HEIGHT - 880],
                            [600, HEIGHT - 880]], np.float32)
        low, _ = self.build(controls={'ButtLift': 40}, base=plateau)
        high, _ = self.build(controls={'ButtLift': 100}, base=plateau)
        self.assertGreater(float(high[0, 1]), 10)
        np.testing.assert_allclose(high[:, 1], high[0, 1])
        np.testing.assert_allclose(low, .4 * high, atol=1e-6)

    def test_lift_mesh_limits_compression_without_consuming_the_shared_fold_guard(self):
        delta, parts = self.build(controls={'ButtLift': 100})
        top_y = HEIGHT - self.base[..., 1]
        changed_y = top_y - delta[..., 1]
        jacobian = np.diff(changed_y, axis=0) / np.diff(top_y, axis=0)
        self.assertGreaterEqual(float(np.min(jacobian)), .66)
        safe, scale = safe_leg_delta(base=self.base, existing_delta=np.zeros_like(self.base),
                                    leg_delta=delta, triangles=indices())
        self.assertEqual(scale, 1.)
        np.testing.assert_array_equal(safe, delta)
        self.assertAlmostEqual(parts['ButtLift']['maxMeshShiftPixelsBeforeCombinedSafety'],
                               float(np.linalg.norm(delta, axis=-1).max()), places=4)

    def test_lift_render_preserves_detected_hands_and_distant_hip_and_knee_rows(self):
        width, height = 200, 320
        base = grid(width=width, height=height)
        points = self.pose.copy()
        for index, point in {3: (250, 760), 4: (350, 830), 6: (750, 760), 7: (650, 830)}.items():
            points[index] = [*point, .95, 1]
        points[:, :2] /= 5
        rgba = np.random.default_rng(95).integers(0, 256, (height, width, 4), np.uint8)
        rgba[..., 3] = 255
        delta, parts = build_region_delta(base=base, pose=points, algorithm_size=[width, height],
            width=width, height=height, controls={'ButtLift': 100})
        actual = render(rgba=rgba, base=base, delta=delta)
        np.testing.assert_array_equal(actual[:150], rgba[:150])
        np.testing.assert_array_equal(actual[220:], rgba[220:])
        yy, xx = np.mgrid[:height, :width]
        for wrist in points[[4, 7], :2]:
            protected = (xx - wrist[0]) ** 2 + (yy - wrist[1]) ** 2 <= 8 ** 2
            np.testing.assert_array_equal(actual[protected], rgba[protected])
        self.assertTrue(parts['ButtLift']['moved'])
        self.assertGreater(np.count_nonzero(actual[175:185, 95:105] != rgba[175:185, 95:105]), 0)

    def test_high_and_low_strengths_are_distinct_and_linear_before_combined_safety(self):
        for name, (_, maximum) in REGION_RANGES.items():
            with self.subTest(name=name):
                low, _ = self.build(controls={name: maximum // 2})
                high, parts = self.build(controls={name: maximum})
                self.assertTrue(parts[name]['moved'])
                self.assertGreater(np.max(np.abs(high)), np.max(np.abs(low)))
                np.testing.assert_allclose(high, low * 2, atol=1e-6)

    def test_missing_required_joints_fail_closed_per_control(self):
        required = {'Abdomen': (2, 5, 8, 11), 'ButtLift': (2, 5, 8, 9, 11, 12),
                    'ButtShape': (2, 5, 8, 9, 11, 12),
                    'LegStraighten': (8, 9, 10, 11, 12, 13), 'AnkleWidth': (9, 10, 12, 13)}
        for name, joints in required.items():
            for index in joints:
                with self.subTest(name=name, index=index):
                    points = self.pose.copy()
                    points[index, 3] = 0
                    delta, parts = self.build(controls={name: 50}, points=points)
                    np.testing.assert_array_equal(delta, 0)
                    self.assertFalse(parts[name]['moved'])
                    self.assertIn('visible', parts[name]['reason'])

    def test_face_is_not_required_and_partial_pose_only_disables_dependent_controls(self):
        points = self.pose.copy()
        points[[0, 1, 14, 15, 16, 17]] = np.nan
        points[[10, 13], 3] = 0
        _, parts = self.build(controls={name: 50 for name in REGION_RANGES}, points=points)
        self.assertTrue(all(parts[name]['moved'] for name in ('Abdomen', 'ButtLift', 'ButtShape')))
        self.assertFalse(parts['LegStraighten']['moved'])
        self.assertFalse(parts['AnkleWidth']['moved'])
        json.dumps(parts, allow_nan=False)

    def test_crossed_or_overlapping_legs_are_not_automatically_corrected(self):
        crossed = self.pose.copy()
        crossed[9, 0], crossed[12, 0] = 700, 300
        overlapping = self.pose.copy()
        overlapping[[11, 12, 13], 0] = overlapping[[8, 9, 10], 0]
        for points in (crossed, overlapping):
            for name in ('ButtLift', 'ButtShape', 'LegStraighten', 'AnkleWidth'):
                with self.subTest(name=name):
                    delta, parts = self.build(controls={name: 50}, points=points)
                    np.testing.assert_array_equal(delta, 0)
                    self.assertFalse(parts[name]['moved'])
                    self.assertIsInstance(parts[name]['reason'], str)

    def test_straightening_refuses_already_straight_or_intentionally_bent_legs(self):
        straight = self.pose.copy()
        straight[9, 0], straight[12, 0] = 350, 650
        bent = self.pose.copy()
        bent[9, 0] = 440
        seated = self.pose.copy()
        seated[9, :2] = [550, 780]
        for points in (straight, bent, seated):
            delta, parts = self.build(controls={'LegStraighten': 100}, points=points)
            np.testing.assert_array_equal(delta, 0)
            self.assertFalse(parts['LegStraighten']['moved'])
        self.assertIn('already aligned', self.build(controls={'LegStraighten': 100}, points=straight)[1]['LegStraighten']['reason'])

    def test_cropped_or_asymmetric_feet_do_not_move_the_wrong_region(self):
        cropped = self.pose.copy()
        cropped[[10, 13], 1] = HEIGHT - 1
        raised = self.pose.copy()
        raised[10, 1] = 1320
        for points in (cropped, raised):
            delta, parts = self.build(controls={'AnkleWidth': 50}, points=points)
            np.testing.assert_array_equal(delta, 0)
            self.assertFalse(parts['AnkleWidth']['moved'])

    def test_invalid_coordinates_and_low_scores_never_escape_as_nonfinite_geometry(self):
        for index, column, value in ((8, 0, -1), (8, 1, HEIGHT), (8, 2, .19),
                                     (8, 0, np.nan), (8, 1, np.inf)):
            points = self.pose.copy()
            points[index, column] = value
            delta, parts = self.build(controls={'Abdomen': 100}, points=points)
            np.testing.assert_array_equal(delta, 0)
            self.assertFalse(parts['Abdomen']['moved'])
            json.dumps(parts, allow_nan=False)
        for points in (None, [], np.zeros((17, 4)), [['bad'] * 4] * 18):
            delta, parts = build_region_delta(base=self.base, pose=points, algorithm_size=[WIDTH, HEIGHT],
                width=WIDTH, height=HEIGHT, controls={name: 50 for name in REGION_RANGES})
            np.testing.assert_array_equal(delta, 0)
            self.assertFalse(any(part['moved'] for part in parts.values()))

    def test_source_coordinate_scaling_does_not_change_the_output(self):
        values = {name: 50 for name in REGION_RANGES}
        expected, _ = self.build(controls=values)
        points = self.pose.copy()
        points[:, :2] *= [.64, .25]
        actual, _ = self.build(controls=values, points=points, size=[640, 400])
        np.testing.assert_allclose(actual, expected, atol=1e-4)

    def test_actual_cpu_sampling_preserves_the_complete_fixed_foot_band(self):
        width, height = 200, 320
        base = grid(width=width, height=height)
        points = self.pose.copy()
        points[:, :2] /= 5
        random = np.random.default_rng(42)
        rgba = random.integers(0, 256, size=(height, width, 4), dtype=np.uint8)
        rgba[..., 3] = 255
        dimensions = np.array([width, height], dtype=np.float32)
        for name, value in (('LegStraighten', 100), ('AnkleWidth', -50)):
            with self.subTest(name=name):
                delta, parts = build_region_delta(base=base, pose=points, algorithm_size=[width, height],
                    width=width, height=height, controls={name: value})
                vertices = np.concatenate(((base + delta) / dimensions * 2 - 1,
                    np.zeros((*base.shape[:2], 1), dtype=np.float32), base / dimensions), axis=-1).reshape(-1, 5)
                result, _ = draw_mesh(rgba=rgba, vertices=vertices, triangles=indices(), runtime=None)
                fixed_from = int(np.ceil(parts[name]['fixedFootFromY']))
                np.testing.assert_array_equal(result[fixed_from:], rgba[fixed_from:])
                if name == 'LegStraighten':
                    hip_band = min(side['fixedHipThroughY'] for side in parts[name]['anchors']['sides'])
                    np.testing.assert_array_equal(result[:int(hip_band)], rgba[:int(hip_band)])
                self.assertGreater(np.count_nonzero(result[:fixed_from] != rgba[:fixed_from]), 0)

    def test_corrected_leg_axes_remain_separate_at_every_row(self):
        y = np.linspace(750, 1450, 141)
        centers = [np.interp(y, self.pose[list(joints), 1], self.pose[list(joints), 0])
                   for joints in ((8, 9, 10), (11, 12, 13))]
        samples = np.stack((np.stack((centers[0], HEIGHT - y), axis=-1),
                            np.stack((centers[1], HEIGHT - y), axis=-1)), axis=0)
        delta, parts = self.build(controls={'LegStraighten': 100}, base=samples.reshape(-1, 2))
        corrected = (samples.reshape(-1, 2) + delta).reshape(2, -1, 2)
        self.assertTrue(parts['LegStraighten']['moved'])
        self.assertTrue(np.all(corrected[1, :, 0] - corrected[0, :, 0] > 0))

    def test_rendered_width_contours_have_gradual_transitions(self):
        width, height = 400, 640
        base = grid(width=width, height=height)
        points = self.pose.copy()
        points[:, :2] *= .4
        dimensions = np.array([width, height], np.float32)
        for name, rows, columns, maximum_change in (
                ('ButtShape', (270, 420), (100, 300), 3),
                ('AnkleWidth', (440, 580), (122, 158), 2)):
            rgba = np.full((height, width, 4), 255, np.uint8)
            rgba[rows[0]:rows[1], columns[0]:columns[1], :3] = 0
            for value in (-50, 50):
                with self.subTest(name=name, value=value):
                    delta, _ = build_region_delta(base=base, pose=points,
                        algorithm_size=[width, height], width=width, height=height,
                        controls={name: value})
                    vertices = np.concatenate(((base + delta) / dimensions * 2 - 1,
                        np.zeros((*base.shape[:2], 1), np.float32), base / dimensions),
                        axis=-1).reshape(-1, 5)
                    actual, _ = draw_mesh(rgba=rgba, vertices=vertices, triangles=indices(), runtime=None)
                    silhouette = actual[rows[0] + 1:rows[1] - 1, :, 0] < 128
                    edge = np.argmax(silhouette, axis=1).astype(np.int32)
                    shifts = edge - columns[0]
                    self.assertGreater(np.max(np.abs(shifts)), 0)
                    self.assertLessEqual(np.max(np.abs(shifts[8:] - shifts[:-8])), maximum_change)
                    active = np.flatnonzero(shifts)
                    self.assertGreater(active[-1] - active[0], 50)

    def test_abdomen_render_keeps_detected_forearms_and_hands_pixel_exact(self):
        width, height = 200, 320
        base = grid(width=width, height=height)
        points = self.pose.copy()
        for index, point in {3:(250, 610), 4:(310, 725), 6:(750, 610), 7:(690, 725)}.items():
            points[index] = [*point, .95, 1]
        points[:, :2] /= 5
        random = np.random.default_rng(81)
        rgba = random.integers(0, 256, (height, width, 4), dtype=np.uint8)
        rgba[..., 3] = 255
        delta, parts = build_region_delta(base=base, pose=points, algorithm_size=[width, height],
            width=width, height=height, controls={'Abdomen':100})
        dimensions = np.array([width, height], np.float32)
        vertices = np.concatenate(((base + delta) / dimensions * 2 - 1,
            np.zeros((*base.shape[:2], 1), np.float32), base / dimensions), axis=-1).reshape(-1, 5)
        actual, _ = draw_mesh(rgba=rgba, vertices=vertices, triangles=indices(), runtime=None)
        yy, xx = np.mgrid[:height, :width]
        xy = np.stack((xx, yy), axis=-1)
        for elbow_index, wrist_index in ((3, 4), (6, 7)):
            elbow, wrist = points[[elbow_index, wrist_index], :2]
            vector = wrist - elbow
            along = np.clip(np.sum((xy - elbow) * vector, axis=-1) / np.dot(vector, vector), 0, 1)
            forearm = np.linalg.norm(xy - (elbow + along[..., None] * vector), axis=-1) <= 4
            hand = np.linalg.norm(xy - wrist, axis=-1) <= 8
            np.testing.assert_array_equal(actual[forearm | hand], rgba[forearm | hand])
        self.assertEqual(len(parts['Abdomen']['protectedDetectedArms']), 2)
        self.assertGreater(np.count_nonzero(actual[124:138, 85:115] != rgba[124:138, 85:115]), 0)

    def test_arm_protection_does_not_invent_a_missing_elbow_or_wrist(self):
        points = self.pose.copy()
        for index, point in {3:(250, 610), 4:(310, 725), 6:(750, 610), 7:(690, 725)}.items():
            points[index] = [*point, .95, 1]
        for missing in (3, 4):
            incomplete = points.copy()
            incomplete[missing, 3] = 0
            _, parts = self.build(controls={'Abdomen':100}, points=incomplete)
            arms = parts['Abdomen']['protectedDetectedArms']
            self.assertEqual(len(arms), 1)
            self.assertEqual(arms[0]['wrist'], [690, 725])

    def test_mirroring_preserves_side_ownership_and_geometry(self):
        values = {name: 50 for name in REGION_RANGES}
        original, _ = self.build(controls=values)
        points = self.pose.copy()
        points[:, 0] = WIDTH - points[:, 0]
        mirrored, _ = self.build(controls=values, points=points)
        expected = original[:, ::-1].copy()
        expected[..., 0] *= -1
        np.testing.assert_allclose(mirrored, expected, atol=1e-5)

    def test_inputs_remain_unchanged_and_diagnostics_are_serializable(self):
        original_base, original_pose = self.base.copy(), self.pose.copy()
        controls = {'Abdomen': 75, 'ButtShape': -50, 'AnkleWidth': 50}
        before = controls.copy()
        delta, parts = self.build(controls=controls)
        np.testing.assert_array_equal(self.base, original_base)
        np.testing.assert_array_equal(self.pose, original_pose)
        self.assertEqual(controls, before)
        self.assertFalse(np.shares_memory(delta, self.base))
        json.dumps(parts, allow_nan=False)

    def test_bad_controls_and_grids_are_rejected(self):
        for name, (minimum, maximum) in REGION_RANGES.items():
            for value in (True, 1.5, '50', minimum - 1, maximum + 1, float('nan')):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    self.build(controls={name: value})
        for base in ([], np.full((2, 2), np.nan), np.zeros((2, 3)), np.ones((2, 2)) * -1):
            with self.assertRaises(ValueError):
                self.build(controls={'Abdomen': 100}, base=base)

    def test_individual_and_combined_meshes_respect_existing_area_safeguard(self):
        for controls in ({name: maximum} for name, (_, maximum) in REGION_RANGES.items()):
            delta, _ = self.build(controls=controls)
            safe, scale = safe_leg_delta(base=self.base, existing_delta=np.zeros_like(self.base),
                leg_delta=delta, triangles=indices())
            self.assertEqual(scale, 1.)
            np.testing.assert_array_equal(safe, delta)
        delta, parts = self.build(controls={name: maximum for name, (_, maximum) in REGION_RANGES.items()})
        safe, scale = safe_leg_delta(base=self.base, existing_delta=np.zeros_like(self.base),
            leg_delta=delta, triangles=indices())
        self.assertGreater(scale, 0)
        self.assertTrue(all(part['moved'] for part in parts.values()))
        self.assertTrue(np.any(safe))


if __name__ == '__main__':
    unittest.main()
