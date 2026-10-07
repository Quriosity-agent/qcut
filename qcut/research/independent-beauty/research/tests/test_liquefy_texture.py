import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from liquefy_texture import encode_coordinates, decode_coordinates, sample_packed, render_local
from mesh_field import interpolate_field
from mesh_raster import validate_mesh
from liquefy_render import validate_controls


class LocalTextureTests(unittest.TestCase):
    def test_coordinate_encoding_round_trip_and_channel_order(self):
        values=np.array([[0,1],[.5,.5],[.1234,.9876]],np.float32)
        packed=encode_coordinates(coordinates=values)
        np.testing.assert_array_equal(packed[0],[0,0,255,0])
        np.testing.assert_array_equal(packed[1],[127,128,127,128])
        np.testing.assert_allclose(decode_coordinates(texture=packed),values,atol=1/65025,rtol=0)

    def test_coordinate_texture_bilinear_edges_and_center(self):
        y,x=np.mgrid[:512,:512]
        field=np.stack(((x+.5)/512,(y+.5)/512),axis=-1).astype(np.float32)
        packed=encode_coordinates(coordinates=field)
        points=np.array([[-1,-1],[.5,.5],[2,2]],np.float32)
        values=sample_packed(texture=packed,coordinates=points)
        np.testing.assert_allclose(values,[[.5/512,.5/512],[.5,.5],[511.5/512,511.5/512]],atol=1/65025,rtol=0)

    def test_field_interpolates_a_plane_and_covers_shared_edges(self):
        p=np.array([[0,0],[4,0],[0,4],[4,4]],np.float32)
        field,covered=interpolate_field(positions=p,values=p.copy(),triangles=np.array([[0,1,2],[1,3,2]],np.uint16),size=(4,4))
        y,x=np.mgrid[:4,:4]
        np.testing.assert_array_equal(field,np.stack((x+.5,y+.5),axis=-1))
        self.assertTrue(covered.all())

    def test_ordered_field_overwrite_and_degenerate_triangle(self):
        p=np.array([[0,0],[2,0],[0,2],[0,0],[2,0],[0,2]],np.float32)
        v=np.array([[1],[1],[1],[9],[9],[9]],np.float32)
        field,covered=interpolate_field(positions=p,values=v,triangles=np.array([[0,0,0],[0,1,2],[3,4,5]],np.uint16),size=(2,2))
        self.assertEqual(field[0,0,0],9)
        self.assertFalse(covered[1,1])

    def test_old_raster_budget_is_preserved(self):
        p=np.zeros((3,2))
        with self.assertRaises(ValueError):
            validate_mesh(positions=p,uv=p,triangles=np.zeros((4097,3),np.uint16))
        with self.assertRaises(ValueError):
            interpolate_field(positions=p.astype(np.float32),values=p.astype(np.float32),triangles=np.zeros((4473,3),np.uint16),size=(4,4))

    def test_zero_render_skips_private_support_and_preserves_rgba(self):
        rgba=np.array([[[1,2,3,4],[255,128,0,0]]],np.uint8)
        result,receipt=render_local(rgba=rgba,support=None,triangles=None,steps=None,intensity=0)
        np.testing.assert_array_equal(result,rgba)
        self.assertIsNot(result,rgba)
        self.assertTrue(receipt['identity'])

    def test_local_controls_reject_coercion_unsupported_and_ranges(self):
        for value in (None,[],{'underjaw':True},{'underjaw':'50'},{'underjaw':51},{'cheekbone':-51},{'unknown':0},{'mid_atrium':np.nan}):
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_controls(values=value)
        self.assertEqual(validate_controls(values={'underjaw':-12.5})['underjaw'],-12.5)


if __name__=='__main__':
    unittest.main()
