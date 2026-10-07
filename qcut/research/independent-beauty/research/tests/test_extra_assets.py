import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from extra_assets import extract, validate_assets


class ExtraAssetTests(unittest.TestCase):
    def test_invalid_identity_and_shape_fail_closed(self):
        for values in ({}, {'extra':np.zeros((240,2),np.float32),'part':np.zeros((106,2),np.float32)},
                       {'extra':np.zeros((240,2),np.float64),'part':np.zeros((106,2),np.float32)}):
            with self.assertRaises(ValueError):
                validate_assets(values=values)

    def test_unqualified_observation_cannot_become_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'trace.json'
            path.write_text(json.dumps({'passed':True,'records':[]}))
            with self.assertRaises(ValueError):
                extract(trace_path=path)


if __name__=='__main__':
    unittest.main()
