"""Validate ten private face slots and extract shared indexed makeup UV arrays."""
import re
import struct

import numpy as np


def mesh_arrays(*, data, floats, vertices, stride, indices, uv_offset=None):
    tag = bytes.fromhex('6e587acf18000000')+struct.pack('<I', floats)
    if data.count(tag) != 1:
        raise ValueError('unique makeup template required')
    points = np.frombuffer(data, '<f4', count=floats, offset=data.index(tag)+12).reshape(10*vertices, stride)
    tag = bytes.fromhex('5f2c286b16000000')+struct.pack('<I', indices)
    topology = [np.frombuffer(data, '<u2', count=indices, offset=match.start()+12).copy()
        for match in re.finditer(re.escape(tag), data)]
    offset = (3 if stride == 6 else 2) if uv_offset is None else uv_offset
    if stride not in (4, 6) or type(offset) is not int or not 0 <= offset <= stride-2:
        raise ValueError('bounded makeup UV component offset required')
    uv = points[:, offset:offset+2]
    if len(topology) != 10 or any(not np.array_equal(topology[slot], topology[0]+slot*vertices)
            or not np.array_equal(uv[slot*vertices:(slot+1)*vertices], uv[:vertices]) for slot in range(10)):
        raise ValueError('ten identical UV and indexed makeup slots required')
    if topology[0].max() >= vertices or not np.isfinite(uv).all():
        raise ValueError('bounded makeup template topology required')
    return uv[:vertices].copy(), topology[0].reshape(-1, 3)

