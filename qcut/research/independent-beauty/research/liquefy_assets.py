"""Hash-bound local deformation assets; private coefficients stay under runtime/."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

CONTROLS = ('underjaw', 'pointy_chin', 'cheekbone', 'upper_atrium', 'mid_atrium', 'lower_atrium')
TABLES = {'left_eye': (0x2ccd6b0, 9), 'right_eye': (0x2ccd6d4, 9),
          'left_brow': (0x2ccd6f8, 10), 'right_brow': (0x2ccd720, 10)}
CONTENT_SHA256 = '98a9a739537218d582fd9b8a40db529d4cc4e7b6a435ac045e8ae0da015142a8'


def content_digest(*, values):
    digest = hashlib.sha256()
    for key in sorted(values):
        array = values[key]
        digest.update(key.encode())
        digest.update(array.dtype.str.encode())
        digest.update(str(array.shape).encode())
        digest.update(array.tobytes())
    return digest.hexdigest()


def validate_assets(*, values):
    expected = {*TABLES, 'base_triangles', 'triangles', 'correction', 'ring_power', 'mean_points', 'side_exponent',
                *(f'{key}_{sign}' for key in CONTROLS for sign in ('positive', 'negative'))}
    if set(values) != expected or content_digest(values=values) != CONTENT_SHA256:
        raise ValueError('local deformation asset identity mismatch')
    for value in values.values():
        if not np.isfinite(value).all():
            raise ValueError('nonfinite local deformation asset')
        value.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 128 * 1024:
        raise ValueError('local deformation asset exceeds budget')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


def observed(*, path):
    trace = json.loads(path.read_text())
    if (trace.get('passed') is not True or trace.get('software_breakpoints_used') is not False
            or trace.get('target_memory_written') is not False or trace.get('target_functions_evaluated') is not False):
        raise ValueError('passed read-only asset observation required')
    return trace['records']


def extract(*, runtime, support_trace, step_baseline):
    core = (runtime / 'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError('unsupported deformation library')
    image = arm64_image(data=core)
    records = observed(path=support_trace)
    if len(records) != 2 or records[1]['yaw_radians'] != 0 or records[0]['triangles'] != records[1]['triangles']:
        raise ValueError('face and neutral support observations required')
    values = {key: np.frombuffer(address_bytes(image=image,address=address,size=count*4),'<i4').copy()
              for key,(address,count) in TABLES.items()}
    values['base_triangles'] = np.asarray(records[0]['base_triangles'], np.uint16).reshape(1245,3)
    values['triangles'] = np.asarray(records[0]['triangles'],np.uint16).reshape(4472,3)
    values['mean_points'] = np.asarray(records[1]['points'],np.float32)
    constants = [struct.unpack('<f',address_bytes(image=image,address=address,size=4))[0]
                 for address in (0x2c962dc,0x2cc6a7c,0x2cc6a80,0x2c91c20)]
    first, second = struct.unpack('<2I',address_bytes(image=image,address=0x9dec88,size=8))
    vertical_bits = ((first >> 5) & 0xffff) | (((second >> 5) & 0xffff) << 16)
    constants.append(-struct.unpack('<f',struct.pack('<I',vertical_bits))[0])
    values['correction'] = np.asarray(constants,np.float32)
    values['ring_power'] = np.asarray(struct.unpack('<d',address_bytes(image=image,address=0x2cc6a88,size=8))[0],np.float64)
    values['side_exponent'] = np.asarray(struct.unpack('<f',address_bytes(image=image,address=0x2c9cad4,size=4))[0],np.float32)
    for control in CONTROLS:
        for sign,public in (('positive',50),('negative',-50)):
            rows = [observed(path=step_baseline/f'image-{i:02}-{control}-{public}/trace.json')[0] for i in (0,1)]
            if rows[0]['steps'] != rows[1]['steps'] or any(row['anchor_mode'] != 0 for row in rows):
                raise ValueError('deformation coefficients varied across source faces')
            values[f'{control}_{sign}'] = np.asarray(rows[0]['steps'],np.float32)
    return validate_assets(values=values)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=Path,default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--support-trace',type=Path,required=True)
    parser.add_argument('--step-baseline',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or not args.output.resolve().is_relative_to(args.runtime.resolve()) or args.output.suffix!='.npz':
        parser.error('fresh .npz asset under runtime/ required')
    np.savez(args.output,**extract(runtime=args.runtime,support_trace=args.support_trace,step_baseline=args.step_baseline))
