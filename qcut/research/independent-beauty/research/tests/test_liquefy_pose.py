import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from liquefy_pose import adjust_strength


class LocalPoseTests(unittest.TestCase):
    def setUp(self):
        self.points=np.full((106,2),.5,np.float32)
        self.points[[43,49,87,93,16]]=np.array([[.51,.8],[.50,.7],[.49,.6],[.48,.5],[.47,.4]],np.float32)
        self.steps={'start':np.array([[25,50],[75,50]],np.float32),'end':np.array([[26,50],[74,50]],np.float32),
                    'strength':np.array([.5,.5],np.float32)}
        self.parameters=np.array([0,100,100,20,45,-.1,0,1],np.float32)

    def test_below_onset_preserves_both_sides(self):
        for yaw in (-19,0,19):
            self.parameters[0]=yaw
            np.testing.assert_array_equal(adjust_strength(points=self.points,steps=self.steps,parameters=self.parameters,exponent=.3),self.steps['strength'])

    def test_turn_changes_only_one_side_and_keeps_input(self):
        original=self.steps['strength'].copy()
        self.parameters[0]=30
        output=adjust_strength(points=self.points,steps=self.steps,parameters=self.parameters,exponent=.3)
        self.assertEqual(np.count_nonzero(output!=original),1)
        self.assertTrue(np.all(output<=original))
        np.testing.assert_array_equal(self.steps['strength'],original)
        self.parameters[0]=-30
        reverse=adjust_strength(points=self.points,steps=self.steps,parameters=self.parameters,exponent=.3)
        np.testing.assert_array_equal(output[::-1],reverse)

    def test_invalid_thresholds_fail(self):
        for onset,boundary in ((45,20),(20,90),(-1,45)):
            self.parameters[3:5]=onset,boundary
            with self.assertRaises(ValueError):
                adjust_strength(points=self.points,steps=self.steps,parameters=self.parameters,exponent=.3)


if __name__=='__main__':
    unittest.main()
