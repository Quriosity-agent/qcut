"""Extract and validate private 248-point coral lipstick assets locally."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

from liquefy_assets import content_digest, observed
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

PACKAGE = '7406181389613190435/e3ccb34c651dd1b57e6c2fb6532c6990'
MESH_SHA256 = '33e1202aaeab77f97afe356dff866ed6aadb8f218b02b42087b574b98b2cca8b'
CONTENT_SHA256 = 'c71a1d0b1ea43a03ec405ded4d4c10fd0349f2980c1f591662b335ca1f291a3c'


def float_property(*, data, name, count):
    key = name.encode()
    if data.count(key) != 1:
        raise ValueError('unique bounded material property required')
    start = data.index(key)+len(key)+8
    if start+count*4 > len(data):
        raise ValueError('truncated material float property')
    return np.frombuffer(data, '<f4', count=count, offset=start).copy()


def extract(*, runtime, trace):
    core = (runtime/'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError('pinned makeup geometry library required')
    image = arm64_image(data=core)
    records = observed(path=trace)
    receipt = json.loads(trace.read_text())
    if not all(receipt.get('checks', {}).get(key) is True for key in ('observationPreservedPixels', 'sourceUnchanged', 'librariesUnchanged')):
        raise ValueError('verified makeup observation integrity required')
    if len(records) != 1 or len(records[0]['vector_90']) != 248:
        raise ValueError('one initialized 248-point geometry observation required')
    values = {key: np.frombuffer(address_bytes(image=image, address=address, size=count*4), '<i4').copy()
              for key, address, count in (('mouth_upper_counts', 0x2cd7148, 6),
                  ('mouth_lower_counts', 0x2cd7160, 6), ('mouth_order', 0x2cda450, 64))}
    values['mouth_y_scale'] = np.frombuffer(address_bytes(image=image, address=0x2c3de40, size=8), '<f8').copy()
    values['radial_indices'] = np.asarray(records[0]['radial_indices'], np.int32)
    package = runtime/'Cache/effect'/PACKAGE
    mesh = (package/'mesh/lips_keypoint_faceu_mesh.mesh').read_bytes()
    if hashlib.sha256(mesh).hexdigest() != MESH_SHA256:
        raise ValueError('pinned private lip template required')
    vertex_tag = bytes.fromhex('6e587acf18000000')+struct.pack('<I', 9920)
    if mesh.count(vertex_tag) != 1:
        raise ValueError('unique ten-face vertex template required')
    vertices = np.frombuffer(mesh, '<f4', count=9920, offset=mesh.index(vertex_tag)+12).reshape(2480, 4)
    values['uv'] = vertices[:248, 2:].copy()
    index_tag = bytes.fromhex('5f2c286b16000000')+struct.pack('<I', 1113)
    arrays, start = [], 0
    while True:
        offset = mesh.find(index_tag, start)
        if offset < 0:
            break
        arrays.append(np.frombuffer(mesh, '<u2', count=1113, offset=offset+12).copy())
        start = offset+2238
    if len(arrays) != 10 or any(not np.array_equal(arrays[i], arrays[0]+i*248) for i in range(10)):
        raise ValueError('ten equivalent indexed face submeshes required')
    values['triangles'] = arrays[0].reshape(371, 3)
    material = (package/'material/lip_BlendModeMultiply/default.material').read_bytes()
    values['texture_transform'] = float_property(data=material, name='uSTMatrix', count=16).reshape(4, 4).T.copy()
    prefab = (package/'makeup.prefab').read_bytes()
    # Serialized doubles store the scale; shader coordinates multiply from the origin.
    marker = struct.pack('<d', float(np.float32(1.002)))
    if prefab.count(marker) != 3:
        raise ValueError('three equivalent lip placement scales required')
    values['position_scale'] = np.array([1, np.float32(1.002)], np.float32)
    for name in ('Color', 'Multiply', 'Screen'):
        for state in ('Open', 'Close'):
            path = package/f'image/lip_BlendMode{name}/default/lip{state}.png'
            values[f'image_sha_{name}_{state}'] = np.asarray(hashlib.sha256(path.read_bytes()).hexdigest())
    return validate_assets(values=values)


def validate_assets(*, values):
    if content_digest(values=values) != CONTENT_SHA256:
        raise ValueError('private lipstick asset identity mismatch')
    for array in values.values():
        array.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 16384:
        raise ValueError('bounded private lipstick assets required')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz asset under runtime/ required')
    np.savez(args.output, **extract(runtime=args.runtime, trace=args.trace))
