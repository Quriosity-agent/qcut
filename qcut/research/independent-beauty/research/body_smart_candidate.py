"""Research-only cold body candidate; the editor keeps the settled photo renderer."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from body_composition import ORDER
from body_composition.controls import validate_controls
from body_mesh_grid import pack_vertices
from body_mesh_renderer import draw_mesh
from body_smart_perception import perceive
from facefitting_image import decode_image
from render_resolution import source_edge_limit
from slimface_render import validate_rgba
from whiten_metal import process_images


def create_composition():
    # Darwin-only float32 geometry is unnecessary for validation and identity requests.
    from body_composition import CombinedBody
    return CombinedBody()


def render(*, rgba, targets, runtime):
    if not any(targets.values()):
        return rgba.copy(), {'identity': True, 'reason': 'zero', 'deformedParts': []}
    inputs, perception = perceive(rgba=rgba, runtime=runtime)
    details = {'perception': perception, 'identity': True, 'deformedParts': []}
    if inputs is None:
        return rgba.copy(), {**details, 'reason': 'no person detected'}
    height, width = rgba.shape[:2]
    mesh = create_composition().update(**inputs, width=width, height=height, targets=targets)
    previous = np.zeros_like(mesh['base'])
    for name in ORDER:
        current = mesh['stages'][name]
        if not np.array_equal(current, previous):
            details['deformedParts'].append(name)
        previous = current
    positions = mesh['positions']
    if not np.isfinite(positions).all():
        raise ValueError('body composition produced nonfinite geometry')
    details['meshSha256'] = hashlib.sha256(positions.tobytes()).hexdigest()
    details['maximumDisplacementPixels'] = float(np.max(np.linalg.norm(positions - mesh['base'], axis=-1)))
    if np.array_equal(positions, mesh['base']):
        return rgba.copy(), {**details, 'reason': 'selected body parts not measurable'}
    result, host = draw_mesh(rgba=rgba, vertices=pack_vertices(positions, mesh['uv'], width, height),
                             triangles=mesh['tri'], runtime=runtime)
    return result, {**details, 'identity': False, 'grid': [30, 30], 'draws': 1, 'metal': host}


def run(*, rgba, controls, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > source_edge_limit() or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque smart-body photo required')
    values, targets = validate_controls(controls=controls)
    result, details = render(rgba=rgba, targets=targets, runtime=Path(runtime))
    receipt = {'scope': 'original-photo-smart-body-single-mesh-PNG', 'controls': values,
               'targets': {name: float(value) for name, value in targets.items()},
               'width': rgba.shape[1], 'height': rgba.shape[0], **details,
               'independence': process_images(), 'privateAssetDependency': 'perception' in details,
               'fixedLandmarks': False, 'nativeGeometryUsed': False, 'videoVerified': False,
               'nativeProductParityVerified': False, 'trackingPolicy': 'fresh-state-per-frame',
               'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
               'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
               'changedPixels': int(np.count_nonzero(np.any(result != rgba, axis=-1))),
               'milliseconds': round((time.monotonic() - started) * 1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--controls', required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct PNG and report paths required')
    from independent_pipeline import parse_json
    run(rgba=decode_image(image=args.image, max_edge=source_edge_limit())['rgba'],
        controls=parse_json(data=args.controls.encode()), runtime=args.runtime, output=args.output, report=args.report)
