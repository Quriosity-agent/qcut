"""Slot ordering, strict bounds and metadata preservation in duplicate suppression."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_face_duplicates import containment, suppress_duplicates
from body_face_slots import BodyFaceSlot


def slot(*, box=(10, 10, 100, 100), score=.5, active=True, new=False, age=1):
    return BodyFaceSlot(box=np.asarray(box, np.float32), confidence=np.float32(score),
                        active=active, new=new, age=age)


class DuplicateFaces(unittest.TestCase):
    def test_confidence_wins_and_equal_scores_keep_earlier_slot(self):
        for first_score, expected in ((.4, [False, True]), (.5, [True, False]), (.6, [True, False])):
            for ages in ((1, 99), (99, 1)):
                with self.subTest(score=first_score, ages=ages):
                    faces = [slot(score=first_score, age=ages[0]), slot(age=ages[1])]
                    suppress_duplicates(slots=faces)
                    self.assertEqual([face.active for face in faces], expected)
                    self.assertEqual([face.age for face in faces], list(ages))

    def test_new_and_inactive_slots_do_not_participate(self):
        for active in (False, True):
            for new in (False, True):
                faces = [slot(score=.4, active=active, new=new), slot(score=.6)]
                suppress_duplicates(slots=faces)
                self.assertEqual([face.active for face in faces], [active and new, True])

    def test_removed_outer_slot_still_removes_a_later_neighbor(self):
        # First overlaps both; the two neighbors do not overlap one another.
        faces = [slot(box=(40, 0, 100, 100), score=.6),
                 slot(box=(0, 0, 100, 100), score=.9),
                 slot(box=(100, 0, 100, 100), score=.4)]
        suppress_duplicates(slots=faces)
        self.assertEqual([face.active for face in faces], [False, True, False])

    def test_containment_removes_smaller_box_in_both_slot_orders(self):
        for reverse in (False, True):
            faces = [slot(box=(0, 0, 100, 100), score=.1), slot(box=(20, 20, 10, 10), score=.9)]
            if reverse:
                faces.reverse()
            suppress_duplicates(slots=faces)
            self.assertEqual([face.active for face in faces], [not reverse, reverse])

    def test_containment_requires_strict_edges_and_strict_half_size(self):
        outer = (0, 0, 100, 100)
        for inner, expected in (((1, 1, 49, 50), -1), ((1, 1, 50, 50), 0),
                                ((0, 1, 10, 10), 0), ((1, 0, 10, 10), 0),
                                ((90, 1, 10, 10), 0), ((1, 90, 10, 10), 0)):
            with self.subTest(inner=inner):
                self.assertEqual(containment(first=outer, second=inner), expected)
                self.assertEqual(containment(first=inner, second=outer), -expected)

    def test_overlap_threshold_uses_promoted_float_and_double_point_two(self):
        # Inclusive width 101; boundary shift 101 * 2/3.
        boundary = np.float32(101 * 2 / 3)
        below = np.nextafter(boundary, np.float32(np.inf))
        above = np.nextafter(boundary, np.float32(-np.inf))
        for shift, expected in ((below, [True, True]), (above, [True, False])):
            faces = [slot(box=(0, 0, 100, 100)), slot(box=(shift, 0, 100, 100))]
            suppress_duplicates(slots=faces)
            self.assertEqual([face.active for face in faces], expected)

    def test_deactivation_preserves_alignment_pose_identity_and_slot_position(self):
        faces = [slot(score=.9), slot(score=.3)]
        second = faces[1]
        second.identifier, second.persistent_id = 8, 7
        second.engine = object()
        before = second.__dict__.copy()
        suppress_duplicates(slots=faces)
        self.assertIs(faces[1], second)
        for key, value in before.items():
            if key != 'active':
                self.assertIs(second.__dict__[key], value)
        self.assertFalse(second.active)

    def test_empty_and_capacity_validation(self):
        suppress_duplicates(slots=[])
        with self.assertRaisesRegex(ValueError, 'five'):
            suppress_duplicates(slots=[slot() for _ in range(6)])


if __name__ == '__main__':
    unittest.main()
