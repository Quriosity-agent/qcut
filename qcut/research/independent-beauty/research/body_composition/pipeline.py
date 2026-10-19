"""Ten body parts on one immutable base mesh, with ordered float32 delta composition.

Owned arithmetic port of the bounded desktop research profile: orientation zero,
bit16, no populated masks and cold deformer states. This module performs no I/O.
"""

import numpy as np
from .head.producer import SkeletonHead
from .public_descriptor import DescriptorSequence, to_part4
from .grid import make_grid, compose_positions
from .inputs import validate_inputs, resolve_targets
from .controls import BODY_ORDER as ORDER
from . import longleg_state as long
from . import longleg_geometry as kernel
from . import status as status
from .waist_body import state as wb_state
from .waist_body import geometry as wb_geometry
from .waist_body import descriptors as wb_descriptors
from .hip_breast import public_basis as hb_public_basis
from .joint_groups import frame_joint_groups
from .hip_breast import public_hip_aux as hb_public_hip_aux
from .hip_breast import hip_descriptor as hb_hip_descriptor
from .hip_breast import hip_state as hb_hip_state
from .hip_breast import hip_geometry as hb_hip_geometry
from .hip_breast import breast_descriptor as hb_breast_descriptor
from .hip_breast import breast_state as hb_breast_state
from .hip_breast import breast_geometry as hb_breast_geometry
from .neck import state as neck_state
from .neck import geometry as neck_geometry
from .neck import descriptor as neck_descriptor
from .slim_arm import state as arm_state
from .slim_arm import geometry as arm_geometry
from .slim_arm import descriptor as arm_descriptor
from .ortho_shoulder import state as shoulder_state
from .ortho_shoulder import geometry as shoulder_geometry
from .ortho_shoulder import descriptor as shoulder_descriptor
from .widen_shoulder import state as widen_state
from .widen_shoulder import geometry as widen_geometry
from .small_head import state as head_state
from .small_head import geometry as head_geometry


class CombinedBody:
    def __init__(self):
        self.status = status.StatusSequence()
        self.head = SkeletonHead()
        self.public = DescriptorSequence()
        self.basis = hb_public_basis.PublicBasis()
        self.hipaux = hb_public_hip_aux.PublicHipAux()
        self.wb = wb_descriptors.WaistBodyDescriptors()
        self.hip = hb_hip_descriptor.HipDescriptor()
        self.breast = hb_breast_descriptor.BreastDescriptor()
        self.neck = neck_descriptor.NeckDescriptor()
        self.shoulder = shoulder_descriptor.ShoulderDescriptor()
        self.arm = arm_descriptor.ArmDescriptor()

    def _make_grid(self, *, width, height):
        return make_grid(width, height)

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
    ):
        """Consume normalized y-up perception and internal targets; no image or model access.

        Descriptor history is retained. Deformer states are cold for each invocation;
        a new instance gives a deterministic image/seek boundary. This is not a video
        identity manager or a persistent ten-part deformer session.
        """
        if not isinstance(body_present, (bool, np.bool_)):
            raise ValueError("body_present must be a boolean")
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
        result = self._update(
            coords, visibility, width, height, faces, rectangles, rolls, targets,
            body_present=body_present,
        )
        if not np.isfinite(result["positions"]).all():
            raise ValueError("body geometry is not finite for the supplied perception")
        return result

    def _update(
        self, coords, vis, w, h, faces=None, rectangles=None, rolls=None, target=0.35,
        *, body_present=True,
    ):
        targets = resolve_targets(target)
        status = self.status.update(coords, vis, w, h, present=body_present)
        status_flags = dict(enumerate(status["bone_records"].reshape(-1).tolist()))
        hs = self.head.update(
            coords,
            vis,
            w,
            h,
            self.public.scale,
            faces=faces,
            rectangles=rectangles,
            rolls=rolls,
            status_valid=status["present"],
            status_blocked=status["status48"],
        )
        pub = self.public.update(
            coords,
            vis,
            w,
            h,
            head_size=hs["public_face_size"],
            head_position=hs["public_position"],
            flags=status_flags,
            status_valid=status["present"],
            status_blocked=status["status48"],
            status_swapped=status["status50"],
        )
        eligible = status["present"] and (not status["status48"])
        axis, perp = (
            self.basis.update(self.public, coords, vis, w, h)
            if eligible
            else (self.basis.axis, self.basis.perp)
        )
        _, (shoulders, hips, _) = frame_joint_groups(coords=coords, visibility=vis, width=w, height=h)
        shcount, hipcount = len(shoulders), len(hips)
        frontal = (
            self.hipaux.update(
                self.public,
                self.basis,
                shcount,
                hipcount,
                has_head_position=tuple(hs["public_position"]) != (-1.0, -1.0),
            )
            if eligible
            else self.hipaux.frontal
        )
        waist, body = (
            self.wb.update(
                pub,
                self.public.sh_smooth,
                self.public.hip_smooth,
                65536,
                h,
                shcount,
                hipcount,
            )
            if eligible
            else (wb_state.Part(False), wb_state.Part(False))
        )
        leg = to_part4(
            pub,
            coords,
            vis,
            w,
            h,
            status_swapped=status["status50"],
            status_valid=status["present"],
        )
        hip = (
            self.hip.update(
                pub,
                self.public.hip_smooth,
                w,
                h,
                hipcount,
                65536,
                frontal,
                self.public.yaw < 0,
            )
            if eligible
            else hb_hip_state.Part(False)
        )
        breast = (
            self.breast.update(
                self.public, axis, perp, w, h, shcount, strategy=65536, head=self.head
            )
            if eligible and (not status["status50"])
            else {
                "valid": False,
                "center": tuple(self.breast.center),
                "radii": tuple(self.breast.radii),
            }
        )
        neck = (
            self.neck.update(self.public, self.basis, self.head, faces, w, h, shcount)
            if eligible
            else {"valid": False, "halves": [], "coefficients": (1.0, 1.0)}
        )
        shoulder = self.shoulder.update(
            coords,
            vis,
            w,
            h,
            status_valid=status["present"],
            status_blocked=status["status48"],
        )
        arm = self.arm.update(coords, vis, w, h, self.public, pub, status=status)
        states = {
            "OrthoShoulder": shoulder_state.prepare(
                shoulder,
                {
                    "basis_angle": float(self.basis.angle),
                    "turnvar": float(self.public.turnvar),
                },
                targets["OrthoShoulder"],
                status50=status["status50"],
            ),
            "WidenShoulder": widen_state.from_descriptor(
                shoulder,
                target=targets["WidenShoulder"],
                strategy=65536,
                flip=status["status50"],
            ),
            "SmallHead": head_state.prepare(self.head, targets["SmallHead"]),
            "LongLeg": long.prepare(
                long.State(mode=2, target=targets["LongLeg"], step=2),
                leg,
                w,
                h,
                strategy=65536,
                body_scale=pub["scale"],
            ),
            "SlimWaist": wb_state.prepare(
                wb_state.State(
                    active=False, mode=2, target=targets["SlimWaist"], step=2
                ),
                waist,
                w,
                h,
                "waist",
                65536,
            ),
            "SlimBody": wb_state.prepare(
                wb_state.State(
                    active=False, mode=2, target=targets["SlimBody"], step=2
                ),
                body,
                w,
                h,
                "body",
                65536,
            ),
            "SlimHip": hb_hip_state.prepare(
                hb_hip_state.State(
                    mode=2,
                    target=targets["SlimHip"],
                    step=2,
                    amplitude=0.15,
                    profile=(0.45, 0.0, 0.4, 0.0, 0.0),
                ),
                hip,
                w,
                h,
            ),
            "SlimBreast": hb_breast_state.prepare(
                hb_breast_state.State(
                    mode=2, target=targets["SlimBreast"], modifier=0.4
                ),
                breast,
                w,
                h,
                axis,
                perp,
                self.public.cc,
                self.public.yaw < 0,
                self.public.turnvar,
            ),
            "SwanNeck": neck_state.prepare(
                neck_state.State(mode=2, target=targets["SwanNeck"]), neck, w, h
            ),
            "SlimArm": arm_state.from_descriptor(arm, w, h, targets["SlimArm"]),
        }
        base, uv, tri = self._make_grid(width=w, height=h)
        delta = np.zeros_like(base)
        stages = {}
        for name in ORDER:
            s = states[name]
            if name == "SmallHead":
                _, delta = head_geometry.deform(base, s, delta)
            elif name == "LongLeg":
                ms = kernel.LongLegState(
                    s.intensity,
                    True,
                    s.active,
                    s.width,
                    s.end,
                    s.pivot,
                    1.0,
                    s.strategy,
                    *s.foot,
                )
                _, delta = kernel.displace(base, w, h, ms, delta)
            elif name in ("SlimWaist", "SlimBody"):
                delta = wb_geometry.deform(
                    base, s, "waist" if name == "SlimWaist" else "body", w, h, delta
                )
            elif name == "SlimHip":
                delta = hb_hip_geometry.deform(
                    base, s.intensity, s.center, s.radii, s.bounds, s.profile, delta
                )
            elif name == "SlimBreast":
                delta = hb_breast_geometry.deform(
                    base, s.intensity, s.extra, s.lobes, s.axis, s.perpendicular, delta
                )
            elif name == "SwanNeck":
                delta = neck_geometry.deform(
                    base, s.intensity, s.halves, s.coefficients, delta
                )
            elif name == "OrthoShoulder":
                _, delta = shoulder_geometry.deform(base, s, delta)
            elif name == "WidenShoulder":
                _, delta = widen_geometry.deform(base, s, delta)
            elif name == "SlimArm":
                _, delta = arm_geometry.deform(base, s, delta)
            stages[name] = delta.copy()
        positions = compose_positions(base=base, delta=delta)
        return {
            "base": base,
            "uv": uv,
            "tri": tri,
            "delta": delta,
            "positions": positions,
            "states": states,
            "stages": stages,
            "parts": {
                "waist": waist,
                "body": body,
                "leg": leg,
                "hip": hip,
                "breast": breast,
                "neck": neck,
                "arm": arm,
                "shoulder": shoulder,
            },
            "head": hs,
            "public": pub,
            "status": status,
        }
