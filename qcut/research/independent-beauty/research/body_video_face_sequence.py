"""Five native face slots feeding the independent single-body video renderer."""
from pathlib import Path

import numpy as np

from alignment_assets import load_assets
from alignment_decode import OutOfFrameLandmarks, normalized
from alignment_infer import Stage1
from body_face_duplicates import suppress_duplicates
from body_face_metadata import rectangle
from body_face_matching import nearest_detection
from body_face_policy import RejectedVideoFace, VideoFacePolicy
from body_face_recovery import VideoFaceRecovery
from body_face_slots import BodyFaceSlot, FACE_SLOT_COUNT
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
                       model=Stage1(size=size, model=self.root / f'face-align-{size}.onnx', probability_heads=True))
                       for size in (120, 160)}
        self.assets = load_assets(path=self.root / 'alignment-assets-v1.npz')
        self.reset()

    def reset(self):
        self.slots = [BodyFaceSlot() for _ in range(FACE_SLOT_COUNT)]
        self.size = None
        self.relaxed = False
        self.recovery = VideoFaceRecovery()
        self.attempts = []
        self.frame_counter = -1
        self.no_face_count = 0
        self.next_identifier = 0

    def _active_count(self):
        return sum(slot.active for slot in self.slots)

    def _track_slot(self, *, slot, algorithm):
        try:
            result = slot.engine.process(rgba=algorithm, size=self.size, index=slot.index, face=slot.face)
            slot.accept(result=result, size=self.size)
            return None
        except (RejectedVideoFace, OutOfFrameLandmarks) as error:
            slot.active = False
            return str(error)

    def _track(self, *, algorithm):
        failures = []
        for slot in self.slots:
            if slot.active:
                reason = self._track_slot(slot=slot, algorithm=algorithm)
                if reason is not None:
                    failures.append(reason)
        return failures

    def _detect(self, *, algorithm, keep, initialize_tracking):
        boxes = self.detector.detect(rgba=algorithm)['rects']
        matches = {index: nearest_detection(retained=slot.box, detections=boxes, capacity=FACE_SLOT_COUNT)
                   for index, slot in enumerate(self.slots) if keep and slot.active}
        reasons = []
        for candidate_index, box in enumerate(boxes[:FACE_SLOT_COUNT]):
            if candidate_index in matches.values():
                continue
            slot_index = (next((i for i, slot in enumerate(self.slots) if not slot.active), None)
                          if keep else candidate_index)
            if slot_index is None:
                break
            try:
                engine, result, face, _ = start_video_face(algorithm=algorithm, box=box, model_root=self.root,
                    assets=self.assets, models=self.models, identifier=self.next_identifier, seed_only=True)
            except (RejectedVideoFace, OutOfFrameLandmarks) as error:
                reasons.append(str(error))
                continue
            slot = BodyFaceSlot(engine=engine, face=face, identifier=self.next_identifier,
                                persistent_id=self.next_identifier)
            self.slots[slot_index] = slot
            self.next_identifier += 1
            slot.accept(result=result, size=self.size)
            if initialize_tracking:
                reason = self._track_slot(slot=slot, algorithm=algorithm)
                if reason is not None:
                    reasons.append(reason)
        return {'candidates': len(boxes), 'matchedDetections': matches, 'rejections': reasons}

    def _step(self, *, algorithm):
        previous_count = self._active_count()
        self.frame_counter += 1
        self.no_face_count = 0 if previous_count else self.no_face_count + 1
        cadence = 24 if previous_count else (2 if self.no_face_count < 10 else 4 if self.no_face_count < 30 else 8)
        scheduled = self.frame_counter % cadence == 0
        self.relaxed = self.recovery.active
        self.attempts = []
        receipt = {'status': 'tracked'}
        retry = False
        if self.recovery.active:
            self._track(algorithm=algorithm)
            retained = self._active_count()
            receipt.update(self._detect(algorithm=algorithm, keep=True, initialize_tracking=True))
            receipt['status'] = 'recovery-retained' if retained else 'redetected' if previous_count else 'tracked'
        elif previous_count:
            failures = self._track(algorithm=algorithm)
            if failures or scheduled:
                retry = bool(failures)
                receipt.update(self._detect(algorithm=algorithm, keep=True, initialize_tracking=retry))
                receipt['status'] = 'redetected' if retry else 'tracked'
        elif scheduled:
            receipt.update(self._detect(algorithm=algorithm, keep=False, initialize_tracking=False))
        else:
            return None, {'status': 'no-face', 'attempts': [], 'relaxed': self.relaxed,
                          'recovery': self.recovery.snapshot(), 'slots': [], 'frameCounter': self.frame_counter}
        before = [index for index, slot in enumerate(self.slots) if slot.active]
        suppress_duplicates(slots=self.slots)
        active = [(index, slot) for index, slot in enumerate(self.slots) if slot.active]
        self.recovery.finish(previous_faces=previous_count, current_faces=len(active), detector_retry=retry)
        data = None
        published = sorted((slot for _, slot in active if not slot.new), key=lambda slot: slot.identifier)
        if published:
            data = {'faces': np.stack([normalized(points=slot.points, size=self.size) for slot in published]),
                    'rectangles': np.stack([rectangle(points=slot.points, size=self.size) for slot in published]),
                    'rolls': np.asarray([slot.roll_value for slot in published], np.float32)}
        else:
            rejected = receipt.get('rejections', [])
            receipt['status'] = 'rejected-reset' if rejected else 'no-face'
            if rejected:
                receipt['reason'] = rejected[-1]
        matches = receipt.get('matchedDetections', {})
        if len(matches) == 1:
            receipt['matchedDetection'] = next(iter(matches.values()))
        return data, {**receipt, 'attempts': self.attempts, 'relaxed': self.relaxed,
                      'recovery': self.recovery.snapshot(), 'frameCounter': self.frame_counter,
                      'suppressedSlots': [index for index in before if not self.slots[index].active],
                      'slots': [{'index': index, 'id': slot.identifier, 'persistentId': slot.persistent_id,
                                 'age': slot.age, 'new': slot.new} for index, slot in active]}

    def update(self, *, algorithm):
        height, width = algorithm.shape[:2]
        if self.size is not None and self.size != (width, height):
            raise ValueError('face dimensions changed; reset before replay')
        self.size = (width, height)
        warmup = None
        if self.frame_counter < 0:
            # Body export starts after the native same-image seed warmup.
            _, warmup = self._step(algorithm=algorithm)
        data, receipt = self._step(algorithm=algorithm)
        if warmup is not None:
            receipt['attempts'] = warmup['attempts'] + receipt['attempts']
            receipt['warmup'] = warmup
        return data, receipt
