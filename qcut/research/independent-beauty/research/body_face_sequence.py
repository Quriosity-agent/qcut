"""Faces for the smart body: detection, 160 seed, 120 tracking and pose metadata.

The body components read one face per frame the way the effect's face service
reports it: 106 points normalized with y up, a normalized rectangle and the roll
(from the pose filter), all from the engine's own detector and alignment
networks run on the same algorithm image the skeleton sees. Yaw and pitch come
from the pose heads in the effect's fused multiply-add order.
"""
from pathlib import Path

import numpy as np

from alignment_assets import load_assets
from alignment_decode import normalized
from alignment_infer import Stage1
from alignment_photo import RejectedPhotoFace, start_photo
from body_face_metadata import FaceMetadata
from face_detection import Detector


class BodyFaceSequence:
    """One tracked face across the frames of a body component (seeded on the first)."""

    def __init__(self, *, model_root):
        root = Path(model_root)
        self.model_root = root
        self.detector = Detector(model=root / 'face-detector-dynamic.onnx')
        self.models = {size: Stage1(size=size, model=root / f'face-align-{size}.onnx', pose_heads=True)
                       for size in (120, 160)}
        self.assets = load_assets(path=root / 'alignment-assets-v1.npz')
        self.metadata = FaceMetadata()
        self.engine = None
        self.face = None
        self.size = None
        self.index = 0
        self.detection = None

    def update(self, algorithm):
        """This frame's face for the body components, or None when no single face is found."""
        height, width = algorithm.shape[:2]
        if self.engine is None:
            detection = self.detector.detect(rgba=algorithm)
            if len(detection['rects']) != 1:
                self.detection = {'faces': len(detection['rects'])}
                return None
            rect = detection['rects'][0]
            factors = np.array([width / detection['algorithm_size'][0],
                                height / detection['algorithm_size'][1]] * 2, np.float32)
            self.detection = {'box': rect * factors, 'algorithm_box': rect, 'score': float(detection['scores'][0])}
            try:
                self.engine, result, self.face, self.size = start_photo(
                    rgba=algorithm, box=self.detection['box'], model_root=self.model_root, assets=self.assets,
                    models=self.models, expansion=1, flags=[1, 0, 0], algorithm_box=rect)
            except RejectedPhotoFace:
                self.detection['rejected'] = True
                return None
            self.face['mode'] = 'update'
        else:
            if (width, height) != self.size:
                raise ValueError('face frame size changed within one body component')
            result = self.engine.process(rgba=algorithm, size=self.size, index=self.index, face=self.face)
        self.index += 1
        metadata = self.metadata.update(result, size=self.size)
        return {'faces': normalized(points=result['points'], size=self.size)[None],
                'rectangles': np.asarray(metadata['rectangles'], np.float32).reshape(1, 4),
                'rolls': np.asarray(metadata['rolls'], np.float32).reshape(1),
                'metadata': metadata, 'result': result}
