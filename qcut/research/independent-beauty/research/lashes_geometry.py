"""Original-photo eye supports to the independent 174-point lash MLS mesh."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from eye_support import distance_ratio, eye_mesh
from eye_trig import sincos
from makeup_geometry import points_array
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image
from makeup_mls import affine_point

F = np.float32
TEMPLATE_SHA256 = 'dd4bbe86f6d324cf6c7079d4787eaaf8d983bb9330fe0ed1687082915a3047b3'


def validate_template(*, template):
    points_array(value=template, count=87)
    if hashlib.sha256(template.tobytes()).hexdigest() != TEMPLATE_SHA256:
        raise ValueError('private lash template identity mismatch')
    template.setflags(write=False)
    return template


def extract_template(*, core):
    data = core.read_bytes()
    if hashlib.sha256(data).hexdigest() != CORE_SHA256:
        raise ValueError('pinned local eye geometry library required')
    image = arm64_image(data=data)
    raw = address_bytes(image=image, address=0x2cd97dc, size=87*8)
    return validate_template(template=np.frombuffer(raw, '<f4').reshape(87, 2).copy())


def load_template(*, path):
    if path.stat().st_size > 2048:
        raise ValueError('bounded private lash template required')
    return validate_template(template=np.load(path, allow_pickle=False))


def query_point(*, point, factor):
    x, y = F(point[0]/F(330)), F(point[1]/F(200))
    # Native scalar coefficients mix double arithmetic with ordered float32 stages.
    phase = F(float(F(x*factor))*.010134+float(x))
    phase = F(phase-F(.5))
    phase = F(F(phase+phase)*F(.10134161))
    sine, cosine = sincos(radians=phase)
    target_x = F((1-float(F(sine*factor)))*float(x))
    target_y = F(F(cosine*factor)*F(F(1)-y))
    target_x, target_y = F(np.clip(target_x, 0, 1)), F(np.clip(target_y, 0, 1))
    return np.array([F(target_x*F(330)), F(F(F(1)-target_y)*F(200))], np.float32)


def lash_mesh(*, points, template):
    validate_template(template=template)
    supports = eye_mesh(points=points).reshape(2, 87, 2)
    source = template.copy()
    source[:, 0] = source[:, 0]*F(2000)-F(570)
    source[:, 1] = ((1-source[:, 1].astype(np.float64))*2000-830).astype(np.float32)
    output = []
    for eye in supports:
        opening = distance_ratio(numerator=eye[4]-eye[17], denominator=eye[10]-eye[21])
        factor = F(np.clip(F(F(opening+opening)+F(.5)), F(.8), F(1)))
        for point in source:
            query = query_point(point=point, factor=factor)
            output.append(affine_point(source=source, target=eye, query=query))
    result = np.array(output, np.float32)
    points_array(value=result, count=174)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    runtime = Path(__file__).resolve().parents[1]/'runtime'
    if args.output.exists() or args.output.suffix != '.npy' or not args.output.resolve().is_relative_to(runtime.resolve()):
        parser.error('fresh private .npy under runtime/ required')
    np.save(args.output, extract_template(core=args.core), allow_pickle=False)
