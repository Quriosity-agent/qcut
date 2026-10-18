"""Independent alignment and pose history for each native video face slot."""
from dataclasses import dataclass, field

import numpy as np

from body_face_matching import tracked_rectangle
from body_face_metadata import DEGREE_TO_RADIAN, raw_roll
from body_video_face_metadata import RollFilter


FACE_SLOT_COUNT = 5


@dataclass
class BodyFaceSlot:
    active: bool = False
    new: bool = False
    identifier: int = -1
    persistent_id: int = -1
    age: int = 0
    confidence: np.float32 = np.float32(0)
    box: np.ndarray = field(default_factory=lambda: np.zeros(4, np.float32))
    engine: object = None
    face: object = None
    index: int = 0
    roll: RollFilter = field(default_factory=RollFilter)
    points: object = None
    tracked: object = None
    roll_value: np.float32 = np.float32(0)

    def accept(self, *, result, size):
        self.points = result['points'].copy()
        self.tracked = result['tracked'].copy()
        self.box = tracked_rectangle(points=self.points, size=size)
        seeded = 120 not in result['heads']
        self.roll_value = (np.float32(raw_roll(points=self.tracked) * DEGREE_TO_RADIAN) if seeded
                           else self.roll.update(points=self.tracked))
        probability = np.asarray(result['heads'][160 if seeded else 120]['prob'], np.float32).reshape(-1)
        combined = probability[0]
        for extra in probability[3:]:
            combined = np.float32(combined + extra)
        self.confidence = np.float32(1 - combined)
        self.active = True
        self.new = seeded
        self.index += 1
        self.age += 1
