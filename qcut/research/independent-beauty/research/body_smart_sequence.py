"""Explicit, bounded body-video session with ordered submitted frames.

Source timestamps may jump; omitted processing history still requires replay
from frame zero or a snapshot (body_sequence_checkpoint).

This API deliberately owns no global state or frame cache. It is not the editor's
stateless photo adapter. The accepted algorithm profile is upright, native-default
one-target modern CPU, package timestamp-driven input types. Empty body results keep
advancing descriptor and deformation history. Seeding selects the first eligible
body in native decoder order; a body already tracked keeps being tracked.
"""
import hashlib
import copy
import math
from pathlib import Path
import time

import numpy as np

from body_video_face_sequence import BodyVideoFaceSequence
from body_algorithm_size import body_algorithm_size
from body_mesh_grid import pack_vertices
from body_mesh_renderer import algorithm_image, draw_mesh
from body_skeleton_model import load_networks
from body_skeleton_sequence import BodySkeletonSequence
from body_control_events import resolve_control_events
from body_execution_profile import execution_request, WARM_PROFILE, SWING_PROFILE
from body_swing_cadence import SwingUpdate, swing_updates
from body_composition.segmentation_mask import validate_segmentation_mask
from render_resolution import source_edge_limit
from slimface_render import validate_rgba
from whiten_metal import process_images


class BodySequenceCancelled(RuntimeError):
    """An incomplete frame invalidated the session; reset and replay to recover."""


class BodySmartSequence:
    def __init__(self, *, runtime, execution_profile=None, execution_generation=None):
        self.runtime = Path(runtime)
        request = execution_request(execution_profile=execution_profile, execution_generation=execution_generation)
        self.execution_profile = request['profile']
        self.execution_generation = request.get('generation')
        self._execution = None
        if self.execution_profile == SWING_PROFILE:
            from body_swing_execution import SwingExecution
            self._execution = SwingExecution(runtime=self.runtime, generation=self.execution_generation)
        self.reset()

    @property
    def execution_identity(self):
        if self._execution is None:
            return {'profile': WARM_PROFILE}
        return copy.deepcopy(self._execution.identity)

    def capture_execution_state(self):
        return {} if self._execution is None else self._execution.capture()

    def validate_execution_state(self, *, state):
        if self._execution is None:
            if state != {}:
                raise ValueError('warm body execution has no asynchronous route state')
            return
        self._execution.validate(state=state)

    def restore_execution_state(self, *, state):
        self.validate_execution_state(state=state)
        if self._execution is not None:
            self._execution.restore(state=state)

    def apply_execution_replay(self, *, routes, replace_context=False):
        if self._execution is None:
            if routes:
                raise ValueError('warm body execution does not accept CoreML routes')
            return
        self._execution.apply_replay(routes=routes, replace_context=replace_context)

    def close(self):
        if self._execution is not None:
            self._execution.close()

    def reset(self):
        if self._execution is not None:
            self._execution.reset()
        self.skeleton = None
        self.face = None
        self.composition = None
        self.stream = None
        self.size = None
        self.next_frame = 0
        self.timestamp = None
        self.invalid = False

    def restart(self):
        """reset() for a new stream that keeps the networks, loading them when absent."""
        loaded = self.skeleton, self.face, self.composition
        self.reset()
        if loaded[0] is None:
            self._initialize()
            return
        for part in loaded:
            part.reset()
        self.skeleton, self.face, self.composition = loaded

    def _initialize(self):
        from body_composition.native_video import NativeVideoBody
        skeleton = (BodySkeletonSequence(networks=load_networks(runtime=self.runtime))
                    if self._execution is None else self._execution.create_skeleton())
        face = BodyVideoFaceSequence(runtime=self.runtime)
        composition = NativeVideoBody()
        self.skeleton, self.face, self.composition = skeleton, face, composition

    def _validate(self, *, rgba, stream, frame, timestamp):
        if self.invalid:
            raise ValueError('incomplete body frame; reset and replay required')
        validate_rgba(rgba=rgba)
        if (max(rgba.shape[:2]) > source_edge_limit() or rgba.shape[0] * rgba.shape[1] > 3840 * 2160
                or np.any(rgba[..., 3] != 255)):
            raise ValueError('bounded opaque body-video frame required')
        if not isinstance(stream, str) or not 1 <= len(stream) <= 256:
            raise ValueError('bounded nonempty stream identity required')
        if type(frame) is not int or frame != self.next_frame:
            raise ValueError('contiguous frame index required; replay omitted processing frames')
        if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError('finite nonnegative frame timestamp required')
        if self.stream is not None and self.stream != stream:
            raise ValueError('stream changed; reset and replay required')
        size = (rgba.shape[1], rgba.shape[0])
        if self._execution is not None and self.size is not None and self.size != rgba.shape[:2]:
            raise ValueError('Swing source dimensions changed; a new execution generation is required')
        return body_algorithm_size(size=size, source_changed=self.size is not None and self.size != rgba.shape[:2])

    def _advance(self, *, algorithm, width, height, update, segmentation_mask, check_cancelled):
        body = self.skeleton.update(algorithm=algorithm)
        skeleton = {key: self.skeleton.last_debug[key] for key in ('network', 'plan', 'state')}
        check_cancelled()
        face, face_details = self.face.update(algorithm=algorithm)
        check_cancelled()
        self.composition.configure_controls(controls=update.controls.values, reapply=update.reapply)
        self.composition.configure_frame(timestamp=update.timestamp, reset_clock=update.controls.reset_clock)
        face_inputs = face or {'faces': None, 'rectangles': None, 'rolls': None}
        coords = body['coords'] if body is not None else np.zeros((18, 2), np.float32)
        visibility = body['visibility'] if body is not None else np.zeros(18, np.uint8)
        mesh = self.composition.update(coords=coords, visibility=visibility,
                                       width=width, height=height, targets=update.controls.targets,
                                       body_present=body is not None,
                                       segmentation_mask=segmentation_mask, **face_inputs)
        details = {'bodyReported': body is not None, 'face': face_details, 'skeleton': skeleton}
        if body is None:
            details['reason'] = 'no external body; native missing-body state advanced'
        return mesh, details

    def process(self, *, rgba, controls, stream, frame, timestamp, cancelled=None, reapply_controls=False,
                control_events=(), segmentation_mask=None):
        algorithm_size = self._validate(rgba=rgba, stream=stream, frame=frame, timestamp=timestamp)
        resolved = resolve_control_events(controls=controls, control_events=control_events)
        segmentation_mask = validate_segmentation_mask(mask=segmentation_mask)
        values = resolved.values
        if type(reapply_controls) is not bool:
            raise ValueError('reapply_controls must be a boolean')
        updates = (SwingUpdate(controls=resolved, timestamp=timestamp,
                              reapply=reapply_controls or resolved.force_reapply),)
        if self._execution is not None:
            updates = swing_updates(previous_controls=self._execution.previous_controls,
                                    controls=controls, timestamp=timestamp, control_events=control_events,
                                    reapply_controls=reapply_controls)
            self._execution.networks.cancelled = cancelled
        route_start = 0 if self._execution is None else len(self._execution.networks.routes)
        started = time.monotonic()

        def check_cancelled():
            if cancelled is not None and cancelled():
                raise BodySequenceCancelled('body frame cancelled; reset and replay required')

        try:
            check_cancelled()
            if self.skeleton is None:
                self._initialize()
            algorithm, raster = algorithm_image(rgba=rgba, runtime=self.runtime, output_size=algorithm_size)
            result = rgba.copy()
            height, width = rgba.shape[:2]
            graph_updates = []
            for update_index, update in enumerate(updates):
                if update_index:
                    check_cancelled()
                mesh, details = self._advance(algorithm=algorithm, width=width, height=height,
                                               update=update, segmentation_mask=segmentation_mask,
                                               check_cancelled=check_cancelled)
                graph_updates.append(details)
                if not np.isfinite(mesh['positions']).all():
                    raise ValueError('body sequence produced nonfinite geometry')
            details = {**details, 'identity': True, 'algorithmRaster': raster}
            if self._execution is not None:
                details.update(graphUpdates=graph_updates, executionIdentity=self.execution_identity,
                               executionRoutes=copy.deepcopy(self._execution.networks.routes[route_start:]),
                               executionRouteCount=len(self._execution.networks.routes),
                               graphTimestampSeconds=updates[-1].timestamp)
            positions = mesh['positions']
            if not np.isfinite(positions).all():
                raise ValueError('body sequence produced nonfinite geometry')
            details['meshSha256'] = hashlib.sha256(positions.tobytes()).hexdigest()
            details['maximumDisplacementPixels'] = float(np.max(np.linalg.norm(positions - mesh['base'], axis=-1)))
            if not np.array_equal(positions, mesh['base']):
                check_cancelled()
                result, host = draw_mesh(rgba=rgba, vertices=pack_vertices(positions, mesh['uv'], width, height),
                                         triangles=mesh['tri'], runtime=self.runtime, precision='float',
                                         flip_source=False, flip_sample_y=True)
                details.update(identity=False, metal=host)
            check_cancelled()
            images = process_images()
            receipt = {'scope': 'explicit-single-person-body-video-session', 'stream': stream, 'frame': frame,
                       'timestampSeconds': timestamp, 'controls': values, **details,
                       'trackingPolicy': 'persistent-sequential-replay-v1', 'privateAssetDependency': True,
                       'modelWeightsOrigin': 'extracted-original-private-assets',
                       'nativeProductParityVerified': False,
                       'independence': {'private_native_images': images['private_native_images'],
                                        'loaded_image_count': len(images['loaded_images'])},
                       'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
                       'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
                       'milliseconds': round((time.monotonic() - started) * 1000)}
        except BaseException as error:
            self.invalid = True
            if (self._execution is not None and not isinstance(error, BodySequenceCancelled)
                    and cancelled is not None and cancelled()):
                raise BodySequenceCancelled('body frame cancelled; reset and replay required') from error
            raise
        if self._execution is not None:
            self._execution.previous_controls = dict(updates[-1].controls.values)
        self.stream, self.size, self.timestamp = stream, rgba.shape[:2], timestamp
        self.next_frame += 1
        return result, receipt
