"""Smart body: one shared body state, ten part states and one composed mesh.

Each frame updates the shared producers (per-joint status, head, public body
measurements, shoulder/hip basis) from the 18 normalized joints and the face,
derives each part's descriptor and deformer state, and adds every part's
displacement to one 30x30 mesh in the effect's order. `SmartBody` is a cold
component for one still frame; `PersistentSmartBody` keeps every part's
deformer state across frames as a video does.
"""
import copy

import numpy as np

import body_arm_descriptor
import body_arm_geometry
import body_arm_history
import body_arm_state
import body_breast_descriptor
import body_breast_geometry
import body_breast_state
import body_hip_descriptor
import body_hip_geometry
import body_hip_state
import body_longleg_kernel
import body_longleg_state
import body_neck_descriptor
import body_neck_geometry
import body_neck_state
import body_ortho_shoulder_geometry
import body_ortho_shoulder_history
import body_ortho_shoulder_state
import body_public_basis
import body_public_hip_aux
import body_shoulder_descriptor
import body_small_head_geometry
import body_small_head_history
import body_small_head_state
import body_status
import body_waist_descriptors
import body_waist_geometry
import body_waist_state
import body_widen_shoulder_geometry
import body_widen_shoulder_history
import body_widen_shoulder_state
from body_head import SkeletonHead
from body_mesh_grid import make_grid
from body_mesh_system import apply_system_deltas
from body_public import DescriptorSequence, to_part4

ORDER = ['SmallHead', 'LongLeg', 'SlimWaist', 'SlimBody', 'OrthoShoulder', 'WidenShoulder', 'SwanNeck', 'SlimHip',
         'SlimArm', 'SlimBreast']
STRATEGY = 65536
GRID = (30, 30)


def resolve_targets(target):
    """Internal deformer targets by part, never raw slider values.

    A mapping leaves the parts it omits at zero; a scalar applies to every part.
    """
    if isinstance(target, dict):
        unknown = set(target) - set(ORDER)
        if unknown:
            raise ValueError('Unknown body target names: ' + ', '.join(sorted(unknown)))
        targets = {k: float(target.get(k, 0.0)) for k in ORDER}
    else:
        targets = {k: float(target) for k in ORDER}
    if not all(np.isfinite(v) for v in targets.values()):
        raise ValueError('Finite internal targets required')
    return targets


def _deform_part(name, base, state, width, height, delta):
    """One part's displacement added to `delta` (the composed mesh so far)."""
    if name == 'SmallHead':
        return body_small_head_geometry.deform(base, state, delta)[1]
    if name == 'LongLeg':
        kernel = body_longleg_kernel.LongLegState(state.intensity, True, state.active, state.width, state.end,
                                                  state.pivot, 1.0, state.strategy, *state.foot)
        return body_longleg_kernel.displace(base, width, height, kernel, delta)[1]
    if name in ('SlimWaist', 'SlimBody'):
        return body_waist_geometry.deform(base, state, 'waist' if name == 'SlimWaist' else 'body', width, height,
                                          delta)
    if name == 'SlimHip':
        return body_hip_geometry.deform(base, state.intensity, state.center, state.radii, state.bounds,
                                        state.profile, delta)
    if name == 'SlimBreast':
        return body_breast_geometry.deform(base, state.intensity, state.extra, state.lobes, state.axis,
                                           state.perpendicular, delta)
    if name == 'SwanNeck':
        return body_neck_geometry.deform(base, state.intensity, state.halves, state.coefficients, delta)
    if name == 'OrthoShoulder':
        return body_ortho_shoulder_geometry.deform(base, state, delta)[1]
    if name == 'WidenShoulder':
        return body_widen_shoulder_geometry.deform(base, state, delta)[1]
    if name == 'SlimArm':
        return body_arm_geometry.deform(base, state, delta)[1]
    raise ValueError('unknown body part ' + name)


class SmartBody:
    """Cold ten-part component: shared producers persist, part states are rebuilt each update."""

    def __init__(self):
        self.status = body_status.StatusSequence()
        self.head = SkeletonHead()
        self.public = DescriptorSequence()
        self.basis = body_public_basis.PublicBasis()
        self.hipaux = body_public_hip_aux.PublicHipAux()
        self.wb = body_waist_descriptors.WaistBodyDescriptors()
        self.hip = body_hip_descriptor.HipDescriptor()
        self.breast = body_breast_descriptor.BreastDescriptor()
        self.neck = body_neck_descriptor.NeckDescriptor()
        self.shoulder = body_shoulder_descriptor.ShoulderDescriptor()
        self.arm = body_arm_descriptor.ArmDescriptor()

    def update(self, coords, vis, w, h, faces=None, rectangles=None, rolls=None, target=0.35):
        targets = resolve_targets(target)
        status = self.status.update(coords, vis, w, h)
        status_flags = dict(enumerate(status['bone_records'].reshape(-1).tolist()))
        hs = self.head.update(coords, vis, w, h, self.public.scale, faces=faces, rectangles=rectangles, rolls=rolls,
                              status_valid=status['present'], status_blocked=status['status48'])
        pub = self.public.update(coords, vis, w, h, head_size=hs['public_face_size'],
                                 head_position=hs['public_position'], flags=status_flags,
                                 status_valid=status['present'], status_blocked=status['status48'],
                                 status_swapped=status['status50'])
        eligible = status['present'] and not status['status48']
        if eligible:
            axis, perp = self.basis.update(self.public, coords, vis, w, h)
        else:
            axis, perp = self.basis.axis, self.basis.perp
        shcount = int(vis[[2, 5]].sum())
        hipcount = int(vis[[8, 11]].sum())
        if eligible:
            frontal = self.hipaux.update(self.public, self.basis, shcount, hipcount,
                                         has_head_position=tuple(hs['public_position']) != (-1.0, -1.0))
        else:
            frontal = self.hipaux.frontal
        if eligible:
            waist, body = self.wb.update(pub, self.public.sh_smooth, self.public.hip_smooth, STRATEGY, h, shcount,
                                         hipcount)
        else:
            waist, body = body_waist_state.Part(False), body_waist_state.Part(False)
        leg = to_part4(pub, coords, vis, w, h, status_swapped=status['status50'], status_valid=status['present'])
        if eligible:
            hip = self.hip.update(pub, self.public.hip_smooth, w, h, hipcount, STRATEGY, frontal, self.public.yaw < 0)
        else:
            hip = body_hip_state.Part(False)
        if eligible and not status['status50']:
            breast = self.breast.update(self.public, axis, perp, w, h, shcount, strategy=STRATEGY, head=self.head)
        else:
            breast = {'valid': False, 'center': tuple(self.breast.center), 'radii': tuple(self.breast.radii)}
        if eligible:
            neck = self.neck.update(self.public, self.basis, self.head, faces, w, h, shcount)
        else:
            neck = {'valid': False, 'halves': [], 'coefficients': (1.0, 1.0)}
        shoulder = self.shoulder.update(coords, vis, w, h, status_valid=status['present'],
                                        status_blocked=status['status48'])
        arm = self.arm.update(coords, vis, w, h, self.public, pub, status=status)
        states = {
            'OrthoShoulder': body_ortho_shoulder_state.prepare(
                shoulder, {'basis_angle': float(self.basis.angle), 'turnvar': float(self.public.turnvar)},
                targets['OrthoShoulder'], status50=status['status50']),
            'WidenShoulder': body_widen_shoulder_state.from_descriptor(
                shoulder, target=targets['WidenShoulder'], strategy=STRATEGY, flip=status['status50']),
            'SmallHead': body_small_head_state.prepare(self.head, targets['SmallHead']),
            'LongLeg': body_longleg_state.prepare(
                body_longleg_state.State(mode=2, target=targets['LongLeg'], step=2), leg, w, h, strategy=STRATEGY,
                body_scale=pub['scale']),
            'SlimWaist': body_waist_state.prepare(
                body_waist_state.State(active=False, mode=2, target=targets['SlimWaist'], step=2), waist, w, h,
                'waist', STRATEGY),
            'SlimBody': body_waist_state.prepare(
                body_waist_state.State(active=False, mode=2, target=targets['SlimBody'], step=2), body, w, h, 'body',
                STRATEGY),
            'SlimHip': body_hip_state.prepare(
                body_hip_state.State(mode=2, target=targets['SlimHip'], step=2, amplitude=0.15,
                                     profile=(0.45, 0.0, 0.4, 0.15, 0.15)), hip, w, h),
            'SlimBreast': body_breast_state.prepare(
                body_breast_state.State(mode=2, target=targets['SlimBreast'], modifier=0.4), breast, w, h, axis, perp,
                self.public.cc, self.public.yaw < 0, self.public.turnvar),
            'SwanNeck': body_neck_state.prepare(
                body_neck_state.State(mode=2, target=targets['SwanNeck']), neck, w, h),
            'SlimArm': body_arm_state.from_descriptor(arm, w, h, targets['SlimArm'])}
        base, uv, tri, _ = make_grid(w, h, *GRID)
        delta = np.zeros_like(base)
        stages = {}
        for name in ORDER:
            delta = _deform_part(name, base, states[name], w, h, delta)
            stages[name] = delta.copy()
        positions = apply_system_deltas(base, delta, 0, True)
        return {'base': base, 'uv': uv, 'tri': tri, 'delta': delta, 'positions': positions, 'states': states,
                'stages': stages,
                'parts': {'waist': waist, 'body': body, 'leg': leg, 'hip': hip, 'breast': breast, 'neck': neck,
                          'arm': arm, 'shoulder': shoulder},
                'head': hs, 'public': pub, 'status': status}


class PersistentSmartBody(SmartBody):
    """Ten parts whose deformer states carry over between frames (video)."""

    def __init__(self, mode=2):
        super().__init__()
        self.mode = mode
        self.states = None
        self.frame = 0
        self.head_history = body_small_head_history.SmallHeadSequence()
        self.arm_history = body_arm_history.SlimArmSequence()
        self.ortho_history = body_ortho_shoulder_history.OrthoSequence()
        self.ortho_geometry = body_ortho_shoulder_history.OrthoGeometry()
        self.widen_history = body_widen_shoulder_history.PersistentWiden()

    def update(self, coords, vis, w, h, faces=None, rectangles=None, rolls=None, target=0.35):
        fresh = super().update(coords, vis, w, h, faces, rectangles, rolls, target=0.0)
        targets = resolve_targets(target)
        parts = fresh['parts']
        s = fresh['states'] if self.states is None else self.states
        s['SmallHead'] = self.head_history.update(self.head, targets['SmallHead'], mode=self.mode)
        for name, part in [('LongLeg', parts['leg']), ('SlimWaist', parts['waist']), ('SlimBody', parts['body']),
                           ('SlimHip', parts['hip']), ('SlimBreast', parts['breast']), ('SwanNeck', parts['neck'])]:
            old = copy.deepcopy(s[name])
            old.target = targets[name]
            old.mode = self.mode
            if self.frame == 0:
                old.intensity = 0.0
                old.active = False
                old.step = 2.0
            if name == 'LongLeg':
                out = body_longleg_state.prepare(old, part, w, h, strategy=STRATEGY,
                                                 body_scale=fresh['public']['scale'])
            elif name in ('SlimWaist', 'SlimBody'):
                out = body_waist_state.prepare(old, part, w, h, 'waist' if name == 'SlimWaist' else 'body', STRATEGY)
            elif name == 'SlimBreast':
                out = body_breast_state.prepare(old, part, w, h, self.basis.axis, self.basis.perp, self.public.cc,
                                                self.public.yaw < 0, self.public.turnvar)
            elif name == 'SlimHip':
                out = body_hip_state.prepare(old, part, w, h)
            else:
                out = body_neck_state.prepare(old, part, w, h)
            s[name] = out
        s['SlimArm'] = self.arm_history.update(parts['arm'], w, h, targets['SlimArm'], mode=self.mode)
        s['OrthoShoulder'] = self.ortho_history.update(
            parts['shoulder'], {'basis_angle': float(self.basis.angle), 'turnvar': float(self.public.turnvar)},
            targets['OrthoShoulder'], fresh['status']['status50'], 2.0, 2)
        base = fresh['base']
        delta = np.zeros_like(base)
        stages = {}
        for name in ORDER:
            state = s[name]
            if name == 'OrthoShoulder':
                _, delta = self.ortho_geometry.deform(base, state, delta)
                self.ortho_history.state = state
            elif name == 'WidenShoulder':
                _, delta = self.widen_history.update(parts['shoulder'], base, targets[name],
                                                     flip=fresh['status']['status50'], destination=delta)
                s[name] = self.widen_history.state
            else:
                delta = _deform_part(name, base, state, w, h, delta)
            stages[name] = delta.copy()
        self.states = copy.deepcopy(s)
        self.frame += 1
        fresh.update(states=s, delta=delta, positions=apply_system_deltas(base, delta, 0, True), stages=stages)
        return fresh
