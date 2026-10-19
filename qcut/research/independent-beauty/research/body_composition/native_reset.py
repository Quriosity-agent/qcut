"""Warm IMAGE reset fields verified against the pinned native virtual resets.

Perception, current strengths, unconsumed filter storage and shoulder counters
survive. This transition is distinct from starting an independent stream.
"""

import numpy as np


ORTHO_RESET_BOUNDS = (2147483647, 2147483647, -2147483648, -2147483648)
WIDEN_RESET_BOUNDS = (100000000, 100000000, -100000000, -100000000)
STRENGTH_PARTS = ('LongLeg', 'SlimWaist', 'SlimBody', 'SlimHip', 'SlimBreast', 'SwanNeck')


def reset_descriptors(*, body):
    status = body.status
    status.bones.fill(0)
    status.bones[:, 4:28] = np.array([-1] * 6, np.float32).view('u1')
    status.bones[:, 28:32] = np.array([7], np.int32).view('u1')
    status.initialized = status.blocked = status.swapped = False
    status.block_count = status.swap_count = 0
    status.ratio = np.float32(-1)

    # Head's face rectangle and protected ROI survive its virtual reset.
    head = body.head
    for offset in (52, 60, 104, 164, 252):
        head.data[offset] = 0
    head.puti(56, -1)
    for offset in (*range(64, 88, 4), *range(108, 164, 4), *range(168, 204, 4)):
        head.put(offset, -1)
    for offset in (248, 256):
        head.puti(offset, 0)

    public = body.public
    for name in ('sh_smooth', 'hip_smooth', 'center', 'base', 'endpivot', 'rawhip', 'rawknee'):
        getattr(public, name).fill(-1)
    for name in ('scale', 'cc', 'width', 'sign', 'signvar', 'yaw', 'turnvar'):
        setattr(public, name, np.float32(-1))
    public.shoulder_reliability = public.hip_reliability = np.float32(0)
    body.basis.hip_width = body.basis.angle = np.float32(-1)
    body.basis.axis[:] = (1, 0)
    body.basis.perp[:] = (0, -1)
    body.hipaux.yaw = body.hipaux.frontal = np.float32(-1)
    for array in (body.wb.waist_center, body.wb.waist_radius, body.wb.body_radius,
                  body.hip.radii, body.breast.center, body.breast.radii):
        array.fill(-1)
    body.neck.radL = body.neck.radR = np.float32(-1)
    body.shoulder.points.fill(-1)
    body.shoulder.missed = 0
    body.arm.points.fill(-1)


def reset_parts(*, body):
    if body.states is not None:
        for name in STRENGTH_PARTS:
            body.states[name].active = False
            body.states[name].step = np.float32(2)
    for history in (body.head_history, body.arm_history):
        history.step = np.float32(2)
        if history.state is not None:
            history.state['valid'] = False
    for history in body.vertex_history.values():
        history.reset_filter()

    ortho = body.ortho_history.state
    ortho.update(points=[[-1, -1] for _ in range(5)], flags=[0] * 5,
                 status50=False, dirty=True)
    body.ortho_geometry.cache = None
    body.ortho_geometry.bounds = ORTHO_RESET_BOUNDS
    widen = body.widen_history
    if widen.state is not None:
        widen.state.update(points=[[-1, -1] for _ in range(5)], visibility=[0] * 5,
                           flip=False, active=False, step=2., history_invalid=True)
    widen.history.raw = None
    widen.history.bounds = WIDEN_RESET_BOUNDS
    widen.history.alpha = None


def reset_native_frame(*, body):
    reset_descriptors(body=body)
    reset_parts(body=body)
