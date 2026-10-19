"""Persistent ten-part body state for one explicit, fixed-size perception stream.

The accepted profile is orientation zero, bit16 and no populated masks. This
object owns geometry history, not detection, person identity or video scheduling.
"""

import copy

import numpy as np

from . import pipeline as parts
from .grid import compose_positions
from .inputs import resolve_targets, validate_inputs
from .ortho_shoulder.history import OrthoGeometry, OrthoSequence
from .pipeline import CombinedBody, ORDER
from .slim_arm.history import SlimArmSequence
from .small_head.history import SmallHeadSequence
from .widen_shoulder.history import PersistentWiden
from .widen_shoulder.temporal_geometry import HistoryCounter
from .vertex_history import VertexHistory
from .segmentation_mask import validate_segmentation_mask


class PersistentCombinedBody(CombinedBody):
    """Keep descriptors, intensities and shoulder grids across ordered frames.

    Mode 0 smooths measurable anchors, mode 1 refreshes them, and mode 2 keeps
    populated anchors under each part's native condition. These are component
    input types, separate from each item's strategy. Shoulder caches keep advancing.
    """

    _long_leg_lower_multiplier = 1.0
    _smoothed_parts = ()
    _supports_resize = False

    def __init__(self, *, mode=1):
        if (
            isinstance(mode, (bool, np.bool_))
            or not isinstance(mode, (int, np.integer))
            or mode not in (0, 1, 2)
        ):
            raise ValueError("persistent body mode must be 0, 1 or 2")
        self._mode = int(mode)
        self.reset()

    @property
    def mode(self):
        return self._mode

    def reset(self):
        """Start an independent stream, clearing anchors, caches and counters.

        Use for a new stream, identity change or resolution boundary. Unlike the
        original process-global counters, independent streams cannot affect one
        another's fifteenth-cache-update compaction phase.
        """
        super().__init__()
        self.states = None
        self.frame = 0
        self._image_size = None
        self.head_history = SmallHeadSequence()
        self.arm_history = SlimArmSequence()
        self.ortho_history = OrthoSequence()
        self.ortho_geometry = OrthoGeometry()
        self.widen_history = PersistentWiden(counter=HistoryCounter())
        self.vertex_history = {name: VertexHistory(degree=.2) for name in self._smoothed_parts}

    def update(
        self,
        *,
        coords,
        visibility,
        width,
        height,
        targets,
        faces=None,
        rectangles=None,
        rolls=None,
        body_present=True,
        segmentation_mask=None,
    ):
        """Advance one frame; all-zero visibility retains native decay history.

        Missing joints are represented by zero visibility and finite coordinates.
        body_present=False keeps joint history while advancing part decay.
        A size change requires reset() first;
        invalid arguments are rejected before advancing any stream state.
        """
        coords, visibility, faces, rectangles, rolls = validate_inputs(
            coords=coords,
            visibility=visibility,
            width=width,
            height=height,
            faces=faces,
            rectangles=rectangles,
            rolls=rolls,
        )
        targets = resolve_targets(targets)
        segmentation_mask = validate_segmentation_mask(mask=segmentation_mask)
        size = (int(width), int(height))
        if self._image_size is not None and size != self._image_size and not self._supports_resize:
            raise ValueError("image dimensions changed; reset persistent body first")
        fresh = super().update(
            coords=coords,
            visibility=visibility,
            width=width,
            height=height,
            targets=0,
            faces=faces,
            rectangles=rectangles,
            rolls=rolls,
            body_present=body_present,
        )
        states = self._prepare_states(fresh, targets, width, height)
        delta, stages = self._compose(
            fresh["base"], states, fresh, targets, width, height,
            segmentation_mask=segmentation_mask,
        )
        positions = compose_positions(base=fresh["base"], delta=delta)
        if not np.isfinite(positions).all():
            self.reset()
            raise ValueError("persistent body geometry is not finite; stream reset")
        self.states = copy.deepcopy(states)
        self._image_size = size
        self.frame += 1
        fresh.update(
            states=copy.deepcopy(states),
            delta=delta,
            positions=positions,
            stages=stages,
        )
        return fresh

    def _prepare_states(self, fresh, targets, width, height):
        descriptors = fresh["parts"]
        states = fresh["states"] if self.states is None else self.states
        states["SmallHead"] = self.head_history.update(
            self.head, targets["SmallHead"], mode=self.mode
        )
        for name, module, descriptor in (
            ("LongLeg", parts.long, descriptors["leg"]),
            ("SlimWaist", parts.wb_state, descriptors["waist"]),
            ("SlimBody", parts.wb_state, descriptors["body"]),
            ("SlimHip", parts.hb_hip_state, descriptors["hip"]),
            ("SlimBreast", parts.hb_breast_state, descriptors["breast"]),
            ("SwanNeck", parts.neck_state, descriptors["neck"]),
        ):
            old = copy.deepcopy(states[name])
            old.target = targets[name]
            old.mode = self.mode
            if self.frame == 0:
                old.intensity = 0.0
                old.active = False
                old.step = 2.0
            if name == "LongLeg":
                state = module.prepare(
                    old,
                    descriptor,
                    width,
                    height,
                    strategy=65536,
                    body_scale=fresh["public"]["scale"],
                    part5_valid=descriptors["waist"].valid,
                    part5_y=descriptors["waist"].center[1],
                )
            elif name in ("SlimWaist", "SlimBody"):
                state = module.prepare(
                    old,
                    descriptor,
                    width,
                    height,
                    "waist" if name == "SlimWaist" else "body",
                    65536,
                )
            elif name == "SlimBreast":
                state = module.prepare(
                    old,
                    descriptor,
                    width,
                    height,
                    self.basis.axis,
                    self.basis.perp,
                    self.public.cc,
                    self.public.yaw < 0,
                    self.public.turnvar,
                )
            else:
                state = module.prepare(old, descriptor, width, height)
            states[name] = state
        states["SlimArm"] = self.arm_history.update(
            descriptors["arm"], width, height, targets["SlimArm"], mode=self.mode
        )
        states["OrthoShoulder"] = self.ortho_history.update(
            descriptors["shoulder"],
            {
                "basis_angle": float(self.basis.angle),
                "turnvar": float(self.public.turnvar),
            },
            targets["OrthoShoulder"],
            fresh["status"]["status50"],
            2.0,
            2,
        )
        return states

    def _compose(self, base, states, fresh, targets, width, height, *, segmentation_mask=None):
        delta = np.zeros_like(base)
        stages = {}
        for name in ORDER:
            state = states[name]
            history = self.vertex_history.get(name)
            accumulated = delta
            if history is not None:
                delta = np.zeros_like(base)
            smooth_active = False
            if name == "SmallHead":
                smooth_active, delta = parts.head_geometry.deform(base, state, delta)
            elif name == "LongLeg":
                mesh_state = parts.kernel.LongLegState(
                    state.intensity,
                    True,
                    state.active,
                    state.width,
                    state.end,
                    state.pivot,
                    self._long_leg_lower_multiplier,
                    state.strategy,
                    *state.foot,
                )
                _, delta = parts.kernel.displace(base, width, height, mesh_state, delta)
            elif name in ("SlimWaist", "SlimBody"):
                delta = parts.wb_geometry.deform(
                    base,
                    state,
                    "waist" if name == "SlimWaist" else "body",
                    width,
                    height,
                    delta,
                )
            elif name == "OrthoShoulder":
                _, delta = self.ortho_geometry.deform(base, state, delta)
                self.ortho_history.state = state
            elif name == "WidenShoulder":
                _, delta = self.widen_history.update(
                    fresh["parts"]["shoulder"],
                    base,
                    targets[name],
                    flip=fresh["status"]["status50"],
                    destination=delta,
                    segmentation_mask=segmentation_mask,
                )
                states[name] = self.widen_history.state
            elif name == "SwanNeck":
                delta = parts.neck_geometry.deform(
                    base, state.intensity, state.halves, state.coefficients, delta
                )
            elif name == "SlimHip":
                smooth_active = state.active and abs(np.float32(state.intensity)) >= np.finfo(np.float32).eps
                delta = parts.hb_hip_geometry.deform(
                    base,
                    state.intensity,
                    state.center,
                    state.radii,
                    state.bounds,
                    state.profile,
                    delta,
                )
            elif name == "SlimArm":
                _, delta = parts.arm_geometry.deform(base, state, delta)
                smooth_active = state.get("enabled", True) and state.get("valid", True)
            elif name == "SlimBreast":
                delta = parts.hb_breast_geometry.deform(
                    base,
                    state.intensity,
                    state.extra,
                    state.lobes,
                    state.axis,
                    state.perpendicular,
                    delta,
                )
            if history is not None:
                if smooth_active:
                    delta = history.update(current=delta, width=width, height=height, reset=self.mode == 2)
                delta = np.float32(accumulated + delta)
            stages[name] = delta.copy()
        return delta, stages
