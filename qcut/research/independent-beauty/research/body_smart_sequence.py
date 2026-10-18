"""Explicit, bounded body-video session. Seek/recovery requires replay from frame zero.

This API deliberately owns no global state or frame cache. It is not the editor's
stateless photo adapter. The accepted algorithm profile is upright, single-person
modern CPU, mode2, with no populated protection masks.
"""
import hashlib
import math
from pathlib import Path
import time

import numpy as np

from body_video_face_sequence import BodyVideoFaceSequence
from body_mesh_grid import pack_vertices
from body_mesh_renderer import algorithm_image, draw_mesh
from body_skeleton_model import load_networks
from body_skeleton_sequence import BodySkeletonSequence
from body_composition.controls import validate_controls
from render_resolution import source_edge_limit
from slimface_render import validate_rgba
from whiten_metal import process_images


class BodySequenceCancelled(RuntimeError):
    """An incomplete frame invalidated the session; reset and replay to recover."""


class BodySmartSequence:
    def __init__(self, *, runtime):
        self.runtime = Path(runtime)
        self.reset()

    def reset(self):
        self.skeleton = None
        self.face = None
        self.composition = None
        self.stream = None
        self.size = None
        self.next_frame = 0
        self.timestamp = None
        self.invalid = False

    def _initialize(self):
        from body_composition import PersistentCombinedBody
        self.skeleton = BodySkeletonSequence(networks=load_networks(runtime=self.runtime))
        self.face = BodyVideoFaceSequence(runtime=self.runtime)
        self.composition = PersistentCombinedBody(mode=2)

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
            raise ValueError('contiguous frame index required; reset and replay for seeking')
        if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError('finite nonnegative frame timestamp required')
        if self.timestamp is not None and not 0 < timestamp - self.timestamp <= .100000001:
            raise ValueError('continuous video timestamps required; reset and replay after discontinuity')
        if self.stream is not None and self.stream != stream:
            raise ValueError('stream changed; reset and replay required')
        if self.size is not None and self.size != rgba.shape[:2]:
            raise ValueError('frame dimensions changed; reset and replay required')

    def process(self, *, rgba, controls, stream, frame, timestamp, cancelled=None):
        self._validate(rgba=rgba, stream=stream, frame=frame, timestamp=timestamp)
        values, targets = validate_controls(controls=controls)
        started = time.monotonic()

        def check_cancelled():
            if cancelled is not None and cancelled():
                raise BodySequenceCancelled('body frame cancelled; reset and replay required')

        try:
            check_cancelled()
            if self.skeleton is None:
                self._initialize()
            algorithm, raster = algorithm_image(rgba=rgba, runtime=self.runtime)
            body = self.skeleton.update(algorithm=algorithm)
            check_cancelled()
            face, face_details = self.face.update(algorithm=algorithm)
            check_cancelled()
            details = {'bodyReported': body is not None, 'identity': True,
                       'algorithmRaster': raster, 'face': face_details,
                       'skeleton': {key: self.skeleton.last_debug[key] for key in ('network', 'plan', 'state')}}
            result = rgba.copy()
            if body is not None:
                height, width = rgba.shape[:2]
                face_inputs = face or {'faces': None, 'rectangles': None, 'rolls': None}
                mesh = self.composition.update(coords=body['coords'], visibility=body['visibility'],
                                               width=width, height=height, targets=targets, **face_inputs)
                positions = mesh['positions']
                if not np.isfinite(positions).all():
                    raise ValueError('body sequence produced nonfinite geometry')
                details['meshSha256'] = hashlib.sha256(positions.tobytes()).hexdigest()
                details['maximumDisplacementPixels'] = float(np.max(np.linalg.norm(positions - mesh['base'], axis=-1)))
                if not np.array_equal(positions, mesh['base']):
                    check_cancelled()
                    result, host = draw_mesh(rgba=rgba, vertices=pack_vertices(positions, mesh['uv'], width, height),
                                             triangles=mesh['tri'], runtime=self.runtime)
                    details.update(identity=False, metal=host)
            else:
                # The skeleton's suppressed seed/lost frame still occupies its video timestamp.
                details['reason'] = 'no external body; original frame preserved'
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
        except BaseException:
            self.invalid = True
            raise
        self.stream, self.size, self.timestamp = stream, rgba.shape[:2], timestamp
        self.next_frame += 1
        return result, receipt
