"""Extract pinned private pupil78 and eye174 cutoff templates without native code."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from lip_assets import float_property
from makeup_mesh_assets import mesh_arrays
from liquefy_assets import content_digest

SPEC = json.loads(Path(__file__).with_name('contacts_card.json').read_text())


def validate_assets(*, values):
    shapes = {'uv': ((78, 2), np.float32), 'triangles': ((114, 3), np.uint16),
        'mask_uv': ((174, 2), np.float32), 'mask_triangles': ((334, 3), np.uint16),
        'mask_transform': ((4, 4), np.float32)}
    if set(values) != set(shapes) or content_digest(values=values) != SPEC['contentSha256']:
        raise ValueError('private pupil template identity mismatch')
    for key, (shape, dtype) in shapes.items():
        if values[key].shape != shape or values[key].dtype != dtype or not np.isfinite(values[key]).all():
            raise ValueError('pupil template outside pinned profile')
        values[key].setflags(write=False)
    return values


def extract(*, runtime):
    root = runtime/'Cache/effect'/SPEC['package']
    for relative, digest in SPEC['files'].items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('private pupil package identity mismatch')
    uv, triangles = mesh_arrays(data=(root/'mesh/pupil_main_faceu_mesh.mesh').read_bytes(),
        floats=4680, vertices=78, stride=6, indices=342)
    mask_uv, mask_triangles = mesh_arrays(data=(root/'mesh/pupil_cutoff_faceu_mesh.mesh').read_bytes(),
        floats=6960, vertices=174, stride=4, indices=1002)
    values = {'uv': uv, 'triangles': triangles, 'mask_uv': mask_uv, 'mask_triangles': mask_triangles,
        'mask_transform': float_property(data=(root/'material/PupilCutoff.material').read_bytes(),
            name='uSTMatrix', count=16).reshape(4, 4).T.copy()}
    return validate_assets(values=values)


def load_assets(*, path):
    if path.stat().st_size > 8192:
        raise ValueError('bounded private pupil archive required')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output, **extract(runtime=args.runtime))
