"""Persistent WidenShoulder adapter over the separately verified state/cache APIs.
The caller owns the counter; no history leaks into an unrelated body session.
"""

from .state import from_descriptor
from .temporal_geometry import WidenHistory


class PersistentWiden:
    def __init__(self, counter=None):
        self.counter = counter
        self.reset()

    def reset(self):
        self.state = None
        self.history = WidenHistory(self.counter)

    def update(
        self,
        descriptor,
        source,
        target=0.5,
        step=2.0,
        flip=False,
        strategy=65536,
        destination=None,
    ):
        previous = self.state
        self.state = from_descriptor(
            descriptor,
            target=target,
            intensity=previous["intensity"] if previous else 0.0,
            step=step,
            flip=flip,
            strategy=strategy,
            previous=previous,
        )
        return self.history.step(source, self.state, destination)
