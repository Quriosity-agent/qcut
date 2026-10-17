"""QCut-owned smart long leg on an opaque photo: body pose, leg state, mesh warp.

The control is `StretchLeg` (the editor's 长腿, 0..100). The effect maps slider u/100
to a long-leg target of 0.35 * u. The pose is the effect's still-frame pose: the coarse
body network on the 640 algorithm image seeds two refinement passes on the same frame
(body_skeleton_decode). The leg state is that of a freshly reset component, which
reaches the target on its first frame (body_longleg_state). A 30x30 grid is moved
below the leg pivot and drawn with Metal, sampling the photo linearly with clamped
edges (body_longleg_mesh, body_mesh_metal.swift). Without a detected person the photo
is returned unchanged. The body networks come from the private runtime asset
`research/body-skeleton-v1.npz`; nothing else is read from outside this engine.
"""
import argparse
import hashlib
import json
from numbers import Real
import math
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image

from body_longleg_mesh import GRID_COLS, GRID_ROWS, leg_mesh
from body_longleg_state import still_leg_state
from body_skeleton_decode import still_pose
from body_skeleton_model import load_networks
from facefitting_image import decode_image
from makeup_metal import build_host
from render_resolution import gpu_request_fields, source_edge_limit, verify_gpu_resolution
from slimface_render import validate_rgba
from whiten_metal import process_images

CONTROL = 'StretchLeg'
TARGET_AT_FULL = .35
SOURCE = Path(__file__).with_name('body_mesh_metal.swift')


def validate_controls(*, controls):
    if not isinstance(controls, dict) or set(controls) != {CONTROL}:
        raise ValueError(f'smart body controls must be exactly {{"{CONTROL}": 0..100}}')
    value = controls[CONTROL]
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError(f'{CONTROL} must be a finite number in [0, 100]')
    return 0.0 if value == 0 else float(value)


def long_leg_target(value):
    """The effect's long-leg target for slider `value` (float32, as the component stores it)."""
    return float(np.float32(TARGET_AT_FULL * (value / 100)))


def draw_mesh(*, rgba, vertices, triangles, runtime):
    """Draw the warped grid with the owned Metal host; returns the RGBA image and the host receipt."""
    height, width = rgba.shape[:2]
    host, environment, identity = build_host(runtime=runtime, source=SOURCE, prefix='body-mesh-metal')
    with tempfile.TemporaryDirectory(prefix='body-mesh-') as temporary:
        directory = Path(temporary)
        np.ascontiguousarray(rgba[::-1]).tofile(directory / 'input.rgba')
        np.ascontiguousarray(vertices, np.float32).tofile(directory / 'vertices.f32')
        np.ascontiguousarray(triangles, np.uint32).tofile(directory / 'triangles.u32')
        request = {'width': width, 'height': height, 'rgba': str(directory / 'input.rgba'),
                   'vertices': str(directory / 'vertices.f32'), 'indices': str(directory / 'triangles.u32'),
                   'output': str(directory / 'output.rgba'), **gpu_request_fields()}
        (directory / 'request.json').write_text(json.dumps(request, allow_nan=False))
        completed = subprocess.run([str(host), str(directory / 'request.json')], env=environment,
                                   capture_output=True, text=True, check=True, timeout=60)
        receipt = json.loads(completed.stdout)
        result = np.fromfile(directory / 'output.rgba', np.uint8).reshape(height, width, 4)
    verify_gpu_resolution(receipt=receipt, rgba=rgba)
    if receipt.get('privateNativeImages'):
        raise ValueError('body mesh host loaded vendor native libraries')
    return result, {**receipt, 'sourceSha256': identity}


def render(*, rgba, value, runtime):
    """The long-leg result and what decided it; the photo itself when nothing applies."""
    if value == 0:
        return rgba.copy(), {'identity': True, 'reason': 'zero'}
    networks = load_networks(runtime=runtime)
    points, perception = still_pose(rgba=rgba, networks=networks)
    details = {'identity': True, 'perception': perception, 'models': networks.provenance, 'pose': points}
    if points is None:
        return rgba.copy(), {**details, 'reason': 'no person detected'}
    height, width = rgba.shape[:2]
    target = long_leg_target(value)
    state, descriptor, part = still_leg_state(points=points, algorithm_size=perception['algorithmSize'],
                                              frame_size=(width, height), target=target)
    details['legState'] = {'active': bool(state.active), 'width': float(state.width), 'end': float(state.end),
                           'pivot': float(state.pivot), 'foot': [float(v) for v in state.foot],
                           'target': float(state.target), 'intensity': float(state.intensity),
                           'bodyScale': float(descriptor['scale']), 'legsValid': bool(part.valid)}
    mesh = leg_mesh(width, height, state)
    if mesh is None:
        return rgba.copy(), {**details, 'reason': 'legs not measurable'}
    result, host = draw_mesh(rgba=rgba, vertices=mesh[0], triangles=mesh[1], runtime=runtime)
    return result, {**details, 'identity': False, 'grid': [GRID_ROWS, GRID_COLS], 'metal': host}


def run(*, rgba, controls, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > source_edge_limit() or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque smart-body photo required')
    value = validate_controls(controls=controls)
    result, details = render(rgba=rgba, value=value, runtime=Path(runtime))
    independence = process_images()
    receipt = {'scope': 'original-photo-smart-long-leg-PNG', 'controls': {CONTROL: value},
               'target': long_leg_target(value), 'width': rgba.shape[1], 'height': rgba.shape[0], **details,
               'independence': independence, 'privateAssetDependency': 'models' in details,
               'fixedLandmarks': False, 'nativeGeometryUsed': False, 'videoVerified': False,
               'nativeProductParityVerified': False,
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
    parser.add_argument('--controls', required=True, help='JSON object, e.g. {"StretchLeg": 60}')
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct PNG and report paths required')
    from independent_pipeline import parse_json
    run(rgba=decode_image(image=args.image, max_edge=source_edge_limit())['rgba'],
        controls=parse_json(data=args.controls.encode()), runtime=args.runtime, output=args.output, report=args.report)
