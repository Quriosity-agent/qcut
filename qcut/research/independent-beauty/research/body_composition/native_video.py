"""The pinned smart-body package's input type, grid and hard-reset lifecycle.

The component uses a 60-column, 75-row mesh and timestamp-driven input types.
IMAGE updates reset warm descriptor/part fields while retaining current strengths,
filter storage and shoulder counter phases. Perception belongs to the session.
"""

import numpy as np

from .controls import RULES
from .grid import make_grid
from .native_reset import STRENGTH_PARTS, reset_native_frame
from .persistent import PersistentCombinedBody


class NativeVideoBody(PersistentCombinedBody):
    _long_leg_lower_multiplier = 0.3
    _smoothed_parts = ("SmallHead", "SlimHip", "SlimArm")
    _supports_resize = True

    def __init__(self):
        super().__init__(mode=0)

    def reset(self):
        super().reset()
        self.public.base.fill(-1)
        self.public.endpivot.fill(-1)
        self._control_values = None
        self._configuration_dirty = False
        self._effect_time = -1.0
        self._reset_frame = False

    def configure_controls(self, *, controls, reapply=False):
        values = tuple(controls.get(name.removeprefix('body_adjust_'), 0) for name in RULES)
        if reapply or values != self._control_values:
            self._configuration_dirty = True
        self._control_values = values

    def configure_frame(self, *, timestamp, reset_clock=False):
        previous = -1.0 if reset_clock else self._effect_time
        elapsed = abs(timestamp - previous)
        self._effect_time = timestamp
        self._reset_frame = elapsed > .1
        if self._reset_frame:
            self._mode = 1
            return
        self._mode = 0 if elapsed > .01 else 2

    def _apply_configuration(self):
        if self._configuration_dirty:
            if self.states is not None:
                for name in STRENGTH_PARTS:
                    self.states[name].step = np.float32(2)
            self.head_history.step = np.float32(2)
            self.arm_history.step = np.float32(2)
            for history in self.vertex_history.values():
                history.mark_dirty()
            self._configuration_dirty = False

    def _update(self, coords, vis, w, h, faces=None, rectangles=None, rolls=None, target=0.35,
                *, body_present=True):
        if self._image_size is not None and self._image_size != (w, h):
            self._reset_frame = True
            self._mode = 1
        if self._reset_frame:
            reset_native_frame(body=self)
            self._reset_frame = False
        self._apply_configuration()
        return super()._update(coords, vis, w, h, faces, rectangles, rolls, target,
                               body_present=body_present)

    def _make_grid(self, *, width, height):
        return make_grid(width, height, rows=75, cols=60)
