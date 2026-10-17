"""QCut-owned smart body on an opaque photo: ten body parts on one mesh warp.

The controls are the editor's ten smart-body sliders (body_smart_controls). The pose is
the effect's still-frame pose: the coarse body network on the 640 algorithm image seeds
two refinement passes on the same frame (body_skeleton_decode). The face comes from the
engine's own detector and alignment networks on that image (body_face_sequence). A still
frame is the body component after STILL_UPDATES updates with that pose and face, which is
where the effect's renders of a photo were measured to settle; each update moves the
shared body measurements and rebuilds the part states (body_smart_pipeline). The ten
displacements share one 30x30 mesh, drawn with Metal sampling the photo linearly with
clamped edges (body_mesh_metal.swift). Without a detected person the photo is returned
unchanged. The body networks come from the private runtime asset
`research/body-skeleton-v1.npz` and the face networks from the runtime's face models.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image

from body_face_sequence import BodyFaceSequence
from body_mesh_grid import pack_vertices
from body_points import normalize_joints
from body_skeleton_decode import algorithm_image, still_pose
from body_skeleton_model import load_networks
from body_smart_controls import internal_targets, validate_controls
from body_smart_pipeline import GRID, ORDER, SmartBody
from facefitting_image import decode_image
from makeup_metal import build_host
from render_resolution import gpu_request_fields, source_edge_limit, verify_gpu_resolution
from slimface_render import validate_rgba
from whiten_metal import process_images

STILL_UPDATES = 8
SOURCE = Path(__file__).with_name('body_mesh_metal.swift')


def plain(value):
    """`value` with numpy arrays and scalars turned into JSON lists and numbers."""
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {str(key): plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    return value


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


def still_frame(*, rgba, points, algorithm_size, targets, runtime):
    """The body component after STILL_UPDATES updates of one frame, and its faces."""
    height, width = rgba.shape[:2]
    joints = normalize_joints(np.asarray(points, np.float32), *algorithm_size)
    algorithm = algorithm_image(rgba)
    faces = BodyFaceSequence(model_root=runtime / 'research')
    body = SmartBody()
    face, face_error, searched = None, None, False
    for _ in range(STILL_UPDATES):
        # The image never changes: without exactly one usable face the first
        # search stays the answer, so the detector runs once for it.
        if face_error is None and (face is not None or not searched):
            try:
                face = faces.update(algorithm)
            except ValueError as error:
                face, face_error = None, str(error)
            searched = True
        inputs = (face['faces'], face['rectangles'], face['rolls']) if face else (None, None, None)
        result = body.update(joints['points'], joints['visibility'], width, height, *inputs, target=targets)
    return result, {'detection': faces.detection, 'faceFound': face is not None, 'faceError': face_error}


def part_summary(*, result):
    """Each part's intensity and whether its displacement moved the mesh."""
    summary, previous = {}, np.zeros_like(result['delta'])
    for name in ORDER:
        state, stage = result['states'][name], result['stages'][name]
        intensity = state.get('intensity') if isinstance(state, dict) else getattr(state, 'intensity', None)
        summary[name] = {'intensity': None if intensity is None else float(intensity),
                         'moved': bool(np.any(stage != previous))}
        previous = stage
    return summary


def render(*, rgba, controls, runtime):
    """The smart-body result and what decided it; the photo itself when nothing applies."""
    targets = internal_targets(values=controls)
    if not any(targets.values()):
        return rgba.copy(), {'identity': True, 'reason': 'zero'}
    networks = load_networks(runtime=runtime)
    points, perception = still_pose(rgba=rgba, networks=networks)
    details = {'identity': True, 'perception': perception, 'models': networks.provenance, 'pose': points,
               'targets': {part: float(value) for part, value in targets.items()}}
    if points is None:
        return rgba.copy(), {**details, 'reason': 'no person detected'}
    height, width = rgba.shape[:2]
    result, faces = still_frame(rgba=rgba, points=points, algorithm_size=perception['algorithmSize'],
                                targets=targets, runtime=runtime)
    details.update(faces=faces, updates=STILL_UPDATES, parts=part_summary(result=result))
    if not np.any(result['delta']):
        return rgba.copy(), {**details, 'reason': 'no body part applies to this pose'}
    vertices = pack_vertices(result['positions'], result['uv'], width, height)
    image, host = draw_mesh(rgba=rgba, vertices=vertices, triangles=result['tri'], runtime=runtime)
    return image, {**details, 'identity': False, 'grid': list(GRID), 'metal': host}


def run(*, rgba, controls, runtime, output, report):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    if max(rgba.shape[:2]) > source_edge_limit() or np.any(rgba[..., 3] != 255):
        raise ValueError('bounded opaque smart-body photo required')
    values = validate_controls(values=controls)
    result, details = render(rgba=rgba, controls=values, runtime=Path(runtime))
    independence = process_images()
    receipt = {'scope': 'original-photo-smart-body-PNG', 'controls': values, 'width': rgba.shape[1],
               'height': rgba.shape[0], **details, 'independence': independence,
               'privateAssetDependency': 'models' in details, 'fixedLandmarks': False,
               'nativeGeometryUsed': False, 'videoVerified': False, 'nativeProductParityVerified': False,
               'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
               'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
               'changedPixels': int(np.count_nonzero(np.any(result != rgba, axis=-1))),
               'milliseconds': round((time.monotonic() - started) * 1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(plain(receipt), indent=2, allow_nan=False) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--controls', required=True, help='JSON object, e.g. {"StretchLeg": 60, "SlimWaist": 40}')
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error('fresh distinct PNG and report paths required')
    from independent_pipeline import parse_json
    run(rgba=decode_image(image=args.image, max_edge=source_edge_limit())['rgba'],
        controls=parse_json(data=args.controls.encode()), runtime=args.runtime, output=args.output, report=args.report)
