"""Five-slot video's frame-boundary visibility recovery window."""
from dataclasses import dataclass


@dataclass
class VideoFaceRecovery:
    active: bool = False
    counter: int = 0

    def finish(self, *, previous_faces, current_faces, detector_retry=False):
        if any(type(count) is not int or not 0 <= count <= 5 for count in (previous_faces, current_faces)):
            raise ValueError('bounded native face counts required')
        if detector_retry:
            self.active = True
            self.counter = 0
        if not self.active:
            return
        # The triggering frame uses its old gate; count 30 expires after that frame.
        gained_face = current_faces > 0 and current_faces > previous_faces
        if gained_face or self.counter >= 30:
            self.active = False
            return
        self.counter += 1

    def snapshot(self):
        return {'active': self.active, 'counter': self.counter}
