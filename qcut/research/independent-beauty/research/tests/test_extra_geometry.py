import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from extra_geometry import crop_geometry, decode_extra, map_points


class ExtraGeometryTests(unittest.TestCase):
    def setUp(self):
        rng=np.random.default_rng(17)
        self.mean=rng.uniform(30,220,(240,2)).astype(np.float32)
        self.primary=(self.mean[:106]*np.float32(2)+[80,30]).astype(np.float32)
        self.seed=self.primary+np.float32(1.5)

    def geometry(self, *, reset=True):
        return crop_geometry(primary=self.primary,seed=self.seed,part_mean=self.mean[:106],
            extra_mean=self.mean,size=(640,480),reset=reset)

    def test_zero_residual_preserves_mean_mapping(self):
        geometry=self.geometry()
        points=decode_extra(raw=np.zeros((240,2),np.float32),mean=self.mean,geometry=geometry)
        np.testing.assert_allclose(points[:106],self.primary,rtol=0,atol=.0003)

    def test_reset_and_history_use_different_crops(self):
        first,second=self.geometry(),self.geometry(reset=False)
        self.assertFalse(np.array_equal(first['forward'],second['forward']))
        np.testing.assert_array_equal(first['stage2_forward'],second['stage2_forward'])

    def test_general_mapping_keeps_all_extra_points(self):
        points=np.concatenate((self.primary,self.mean[106:]),axis=0)
        transform=np.array([[1,0,3],[0,1,7]],np.float32)
        np.testing.assert_array_equal(map_points(points=points,matrix=transform),(points+[3,7]).astype(np.float32))

    def test_malformed_profiles_and_heads_are_rejected(self):
        for reset in (0,None,'reset'):
            with self.assertRaises(ValueError):
                self.geometry(reset=reset)
        with self.assertRaises(ValueError):
            crop_geometry(primary=np.zeros((106,2),np.float32),seed=self.seed,
                part_mean=self.mean[:106],extra_mean=self.mean,size=(640,480),reset=True)
        for raw in (np.zeros((239,2),np.float32),np.full((240,2),np.nan,np.float32),np.zeros((240,2),np.float64)):
            with self.assertRaises(ValueError):
                decode_extra(raw=raw,mean=self.mean,geometry=self.geometry())

    def test_input_arrays_remain_unchanged(self):
        primary,seed,mean=self.primary.copy(),self.seed.copy(),self.mean.copy()
        self.geometry(reset=False)
        for actual,expected in ((self.primary,primary),(self.seed,seed),(self.mean,mean)):
            np.testing.assert_array_equal(actual,expected)
