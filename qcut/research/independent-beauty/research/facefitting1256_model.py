"""Pinned classical 1256 fitting tables; no native solver or observed geometry."""
import hashlib
from pathlib import Path
import struct

import numpy as np

MODEL_SHA256 = 'aca792bb00c815b19db2836f65f380ab7a84a0266f5f54cbc01aeddde06757e1'
MODEL_NAME = 'tt_facefitting1256_v2.0_size0_md5fffe6eddf140be723d9256df98cf6122.model'


def load_model(*, path):
    data = Path(path).read_bytes()
    if len(data) != 659938 or hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError('pinned private 1256 fitting model required')
    if struct.unpack_from('<10If', data) != (3, 1463, 30, 39, 7128, 11, 68, 70, 150, 735, 2800.0):
        raise ValueError('unsupported 1256 fitting schema')
    basis = np.frombuffer(data, '<i2', 70*1463*3, 44).astype(np.float32).reshape(70, 1463, 3)*np.float32(1/2800)
    indices = np.frombuffer(data, '<i4', 163, 614504).copy()
    if indices[0] != 81 or not (indices[1:82] < 106).all() or not (indices[82:] < 1463).all():
        raise ValueError('bounded fitting landmark mapping required')
    weights = np.frombuffer(data, '<f4', 81, 615156).copy()[:68]
    eigen = np.frombuffer(data, '<f4', 30, 615480).copy()
    triangles = np.frombuffer(data, '<u2', 7128, 615600).reshape(-1, 3).copy()
    names = [name.split(b'\0')[0].decode('ascii') for name in np.frombuffer(data, 'S50', 40, 629856)]
    priors = np.zeros(70, np.float32)
    for index, name in enumerate(names[1:], 1):
        prior = 15
        if 'mouth' in name:
            prior = 30
        elif 'cheek' in name or 'nose' in name:
            prior = 22.5
        elif 'eye' in name:
            prior = 12
        priors[index] = prior
    priors[40:] = np.float32(.3)/eigen
    if struct.unpack_from('<I', data, 631856)[0] != 21:
        raise ValueError('21 dynamic contour rows required')
    offset, contours = 631860, []
    for _ in range(21):
        count = struct.unpack_from('<I', data, offset)[0]
        offset += 4
        if count % 6 or not 12 <= count <= 228:
            raise ValueError('bounded barycentric contour row required')
        contours.append(np.frombuffer(data, '<f4', count, offset).copy().reshape(-1, 6))
        offset += count*4
    if offset != 646584:
        raise ValueError('1256 contour payload offset mismatch')
    uv = np.frombuffer(data, '<f4', 1463*2, offset).copy().reshape(1463, 2)
    uv[:, 1] = np.round(1-uv[:, 1].astype(np.float64), 6).astype(np.float32)
    return {'basis': basis, 'indices': indices, 'weights': weights, 'priors': priors,
            'triangles': triangles, 'contours': contours, 'uv': uv}
