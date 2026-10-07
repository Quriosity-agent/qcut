"""Ordinary still-photo Extra crop and residual decoding in float32 order."""
import math

import numpy as np

from alignment_decode import map_affine
from alignment_transform import fit, points106


def map_points(*, points, matrix):
    if (not isinstance(points,np.ndarray) or points.dtype!=np.float32 or points.shape!=(240,2)
            or not np.isfinite(points).all() or np.max(np.abs(points))>32768):
        raise ValueError('bounded float32 Extra240 points required')
    map_affine(points=points[:106],inverse=matrix)
    values,transform=points.astype(np.float64),matrix.astype(np.float64)
    result=(values[:,:1]*transform[:,0]+values[:,1:]*transform[:,1]+transform[:,2]).astype(np.float32)
    if not np.isfinite(result).all() or np.max(np.abs(result))>32768:
        raise ValueError('mapped Extra points exceed budget')
    return result


def crop_geometry(*, primary, seed, part_mean, extra_mean, size, reset):
    points106(points=primary);points106(points=seed);points106(points=part_mean)
    if ((part_mean<0).any() or (part_mean>256).any()
            or not isinstance(extra_mean,np.ndarray) or extra_mean.dtype!=np.float32 or extra_mean.shape!=(240,2)
            or not np.isfinite(extra_mean).all() or (extra_mean<0).any() or (extra_mean>256).any()
            or not isinstance(size,tuple) or len(size)!=2
            or any(type(n) is not int or not 1<=n<=4096 for n in size) or type(reset) is not bool):
        raise ValueError('bounded Extra mean, algorithm dimensions and reset profile required')
    stage2_forward,stage2_inverse=fit(source=primary,
        target=(part_mean.astype(np.float64)/256*160).astype(np.float32))
    source=map_affine(points=map_affine(points=primary,inverse=stage2_forward),inverse=stage2_inverse)
    if not reset:
        scale=np.float32(3/720*min(size))
        displacement=source-seed
        weights=np.array([math.exp(-math.pow(float(value),3))
            for value in (np.abs(displacement)/scale).flat],np.float32).reshape(106,2)
        source=seed*weights+source*(np.float32(1)-weights)
    forward,inverse=fit(source=source,target=(extra_mean[:106].astype(np.float64)/256*160).astype(np.float32))
    return {'forward':forward,'inverse':inverse,'stage2_forward':stage2_forward,'stage2_inverse':stage2_inverse}


def decode_extra(*, raw, mean, geometry):
    if (not isinstance(mean,np.ndarray) or mean.dtype!=np.float32 or mean.shape!=(240,2)
            or not np.isfinite(mean).all() or (mean<0).any() or (mean>256).any()
            or not isinstance(raw,np.ndarray) or raw.dtype!=np.float32 or raw.shape!=(240,2)
            or not np.isfinite(raw).all() or np.max(np.abs(raw))>512
            or not isinstance(geometry,dict)
            or set(geometry)!={'forward','inverse','stage2_forward','stage2_inverse'}):
        raise ValueError('finite Extra residual head, mean and complete crop geometry required')
    decoded=(raw.astype(np.float64)+mean.astype(np.float64)/256*160).astype(np.float32)
    points=map_points(points=decoded,matrix=geometry['inverse'])
    points=map_points(points=points,matrix=geometry['stage2_forward'])
    return map_points(points=points,matrix=geometry['stage2_inverse'])
