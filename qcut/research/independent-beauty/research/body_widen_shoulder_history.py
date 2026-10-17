"""Shoulder width across frames: one cache per object; the shared history counter is kept."""
from body_widen_shoulder_state import from_descriptor
from body_widen_shoulder_geometry import WidenHistory

class PersistentWiden:

    def __init__(self, counter=None):
        self.counter = counter
        self.reset()

    def reset(self):
        self.state = None
        self.history = WidenHistory(self.counter)

    def update(self, descriptor, source, target=0.5, step=2.0, flip=False, strategy=65536, destination=None):
        previous = self.state
        self.state = from_descriptor(descriptor, target=target, intensity=previous['intensity'] if previous else 0.0, step=step, flip=flip, strategy=strategy, previous=previous)
        return self.history.step(source, self.state, destination)
