"""Persistent 106-point face inputs for the single-person body sequence profile."""
from pathlib import Path

import numpy as np

from alignment_assets import load_assets
from alignment_decode import OutOfFrameLandmarks, normalized
from alignment_infer import Stage1
from body_face_metadata import rectangle
from body_video_face_metadata import RollFilter
from body_face_policy import RejectedVideoFace, VideoFacePolicy
from body_face_recovery import VideoFaceRecovery
from body_face_start import start_video_face
from face_detection import Detector


class _AcceptedVideoModel:
    def __init__(self, *, owner, size, model):
        self.owner = owner
        self.size = size
        self.model = model

    def infer(self, *, tensor):
        heads = self.model.infer(tensor=tensor)
        try:
            gate = self.owner.policy.validate(heads=heads, size=self.size, relaxed=self.owner.relaxed)
        except RejectedVideoFace as error:
            self.owner.attempts.append({'size': self.size, **error.details, 'accepted': False, 'reason': str(error)})
            raise
        self.owner.attempts.append({'size': self.size, **gate})
        return heads


class BodyVideoFaceSequence:
    def __init__(self, *, runtime):
        self.root = Path(runtime) / 'research'
        self.policy = VideoFacePolicy(runtime=runtime)
        self.detector = Detector(model=self.root / 'face-detector-dynamic.onnx')
        self.models = {size: _AcceptedVideoModel(owner=self, size=size,
                       model=Stage1(size=size, model=self.root / f'face-align-{size}.onnx'))
                       for size in (120, 160)}
        self.assets = load_assets(path=self.root / 'alignment-assets-v1.npz')
        self.reset()

    def _clear_face(self):
        self.engine = None
        self.face = None
        self.index = 0
        self.roll = RollFilter()

    def reset(self):
        self._clear_face()
        self.size = None
        self.relaxed = False
        self.recovery = VideoFaceRecovery()
        self.attempts = []

    def _detect(self, *, algorithm):
        detection = self.detector.detect(rgba=algorithm)
        count = len(detection['rects'])
        if count != 1:
            return None, {'status': 'no-face' if count == 0 else 'ambiguous-faces', 'candidates': count}
        self.engine, result, self.face, self.size = start_video_face(
            algorithm=algorithm, box=detection['rects'][0], model_root=self.root,
            assets=self.assets, models=self.models)
        return result, None

    def _consume(self, *, result):
        data = {'faces': normalized(points=result['points'], size=self.size)[None],
                'rectangles': rectangle(points=result['points'], size=self.size)[None],
                'rolls': np.asarray([self.roll.update(points=result['tracked'])], np.float32)}
        self.index += 1
        return data

    def _finish(self, *, data, receipt, was_tracking, detector_retry, retained_dropped=False):
        self.recovery.finish(previous_faces=int(was_tracking), current_faces=int(data is not None),
                             detector_retry=detector_retry)
        return data, {**receipt, 'attempts': self.attempts, 'relaxed': self.relaxed,
                      'recovery': self.recovery.snapshot(),
                      **({'retainedFaceDropped': True} if retained_dropped else {})}

    def update(self, *, algorithm):
        height, width = algorithm.shape[:2]
        if self.size is not None and self.size != (width, height):
            raise ValueError('face dimensions changed; reset before replay')
        retained_dropped = False
        if self.recovery.active and self.engine is not None:
            # A face kept through a frame-end retry. The native rule for matching it is
            # unverified, so the retained face is dropped and the recovery window's
            # relaxed detection decides this frame; a session keeps going instead of failing.
            self._clear_face()
            retained_dropped = True
        self.size = (width, height)
        self.attempts = []
        self.relaxed = self.recovery.active
        was_tracking = self.engine is not None
        for attempt in range(2 if was_tracking else 1):
            try:
                if self.engine is None:
                    result, empty = self._detect(algorithm=algorithm)
                    if empty is not None:
                        return self._finish(data=None, receipt=empty, was_tracking=was_tracking,
                                            detector_retry=attempt > 0, retained_dropped=retained_dropped)
                else:
                    result = self.engine.process(rgba=algorithm, size=self.size, index=self.index, face=self.face)
                data = self._consume(result=result)
                return self._finish(data=data, receipt={'status': 'redetected' if attempt else 'tracked'},
                                    was_tracking=was_tracking, detector_retry=attempt > 0,
                                    retained_dropped=retained_dropped)
            except (RejectedVideoFace, OutOfFrameLandmarks) as error:
                self._clear_face()
                reason = str(error)
        return self._finish(data=None, receipt={'status': 'rejected-reset', 'reason': reason}, was_tracking=was_tracking,
                            detector_retry=was_tracking, retained_dropped=retained_dropped)
