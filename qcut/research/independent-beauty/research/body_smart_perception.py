"""Fresh body/face perception from one shared float Metal algorithm raster.

The coarse pose seeds one refinement pass, the first externally reported pose.
Every request owns its face and descriptor state; only immutable network sessions
may be reused. Multi-person identity and temporal video recovery are not implied.
"""
from pathlib import Path

import numpy as np

from alignment_assets import load_assets
from alignment_decode import OutOfFrameLandmarks, normalized
from alignment_infer import Stage1
from alignment_photo import RejectedPhotoFace, start_photo, validate_photo_acceptance
from body_face_metadata import rectangle
from body_video_face_metadata import RollFilter
from body_points import normalize_joints
from body_mesh_renderer import algorithm_image
from body_skeleton_decode import pose_from_algorithm
from body_skeleton_model import load_networks
from face_detection import Detector


def detect_faces(*, algorithm, runtime):
    root = Path(runtime) / 'research'
    detector = Detector(model=root / 'face-detector-dynamic.onnx')
    detection = detector.detect(rgba=algorithm)
    candidates = detection['rects'][:5]
    if not len(candidates):
        return None, None, None, {'candidates': 0, 'accepted': 0, 'rejected': 0}
    models = {size: Stage1(size=size, model=root / f'face-align-{size}.onnx') for size in (120, 160)}
    assets = load_assets(path=root / 'alignment-assets-v1.npz')
    height, width = algorithm.shape[:2]
    factors = np.array([width / detection['algorithm_size'][0], height / detection['algorithm_size'][1]] * 2, np.float32)
    faces, rectangles, rolls = [], [], []
    rejected = 0
    for box in candidates:
        try:
            sequence, warm, face, size = start_photo(rgba=algorithm, box=box * factors, model_root=root,
                                                    assets=assets, models=models, expansion=1, flags=[1, 0, 0],
                                                    algorithm_box=box)
            roll = RollFilter()
            roll.update(points=warm['tracked'])
            # The body graph consumes the first tracked update, not the still-photo reset.
            face['mode'] = 'update'
            result = sequence.process(rgba=algorithm, size=size, index=1, face=face)
            validate_photo_acceptance(warm=warm, result=result)
            faces.append(normalized(points=result['points'], size=size))
            rectangles.append(rectangle(points=result['points'], size=size))
            rolls.append(roll.update(points=result['tracked']))
        except (RejectedPhotoFace, OutOfFrameLandmarks):
            rejected += 1
    details = {'candidates': len(candidates), 'accepted': len(faces), 'rejected': rejected}
    if not faces:
        return None, None, None, details
    return np.asarray(faces, np.float32), np.asarray(rectangles, np.float32), np.asarray(rolls, np.float32), details


def perceive(*, rgba, runtime):
    algorithm, raster = algorithm_image(rgba=rgba, runtime=runtime)
    networks = load_networks(runtime=runtime)
    points, skeleton = pose_from_algorithm(algorithm=algorithm, networks=networks,
                                          refinement_passes=1, tracker_crop=True)
    details = {'profile': 'cold-first-external-pose-float-Metal', 'algorithmRaster': raster,
               'skeleton': skeleton, 'models': networks.provenance, 'temporalTracking': False}
    if points is None:
        return None, details
    joints = normalize_joints(points, algorithm.shape[1], algorithm.shape[0])
    faces, rectangles, rolls, face_details = detect_faces(algorithm=algorithm, runtime=runtime)
    details['faces'] = face_details
    details['selectedBody'] = 0
    return {'coords': joints['points'], 'visibility': joints['visibility'], 'faces': faces,
            'rectangles': rectangles, 'rolls': rolls}, details
