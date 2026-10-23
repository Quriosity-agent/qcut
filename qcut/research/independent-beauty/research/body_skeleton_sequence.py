"""Owned default one-target CPU skeleton lifecycle; no recorded poses or native calls."""
import numpy as np

from body_points import normalize_joints
from body_skeleton_identity import select_seed
from body_skeleton_decode import (crop_layout_and_roi, map_local_to_global,
                                  tracking_body_box, postprocess, refine_pose, refine_tensor)
from body_skeleton_preprocess import skeleton005_auto


class BodySkeletonSequence:
    def __init__(self, *, networks):
        self.networks = networks
        self.reset()

    def reset(self):
        self.points = None
        self.size = None
        self.iterations = 0
        self.frame = 0
        self.last_debug = None

    def update(self, *, algorithm):
        if (not isinstance(algorithm, np.ndarray) or algorithm.dtype != np.uint8
                or algorithm.ndim != 3 or algorithm.shape[2] not in (3, 4)
                or min(algorithm.shape[:2]) < 16 or max(algorithm.shape[:2]) > 1280):
            raise ValueError('bounded RGB algorithm raster required')
        height, width = algorithm.shape[:2]
        size = (width, height)
        if self.size is not None and self.size != size:
            self.points = None
            self.iterations = 0
        rgb = np.ascontiguousarray(algorithm[..., :3])
        box = tracking_body_box(self.points, size) if self.points is not None else None
        mode = int(box is not None)
        plan = {'mode': mode}
        if mode == 0:
            tensor, outputs = self._coarse(rgb=rgb)
            heat = heatmaps(outputs['heatmap_output_0'])
            paf = heatmaps(outputs['vectormap_output_0'])
            th, tw = tensor.shape[:2]
            _, roi = crop_layout_and_roi([0, 0, width, height], (tw, th))
            people = map_local_to_global(postprocess(heat, paf), (tw, th), roi)
            points = select_seed(people=people)
            iterations = 0
            reported = None
        else:
            layout, roi = crop_layout_and_roi(box)
            plan.update(bbox=box, layout=layout, roi=roi, body_scale=max(box[2:]))
            tensor, outputs = self._refine(rgb=rgb, box=box)
            points = refine_pose(heatmaps(outputs['output_0']), roi, self.points, max(box[2:]))
            if not any(point[3] for point in points):
                points = None
            reported = points
            iterations = self.iterations + 1
        self.points, self.size, self.iterations = points, size, iterations
        self.last_debug = {'frame': self.frame, 'network': 'refine' if mode else 'coarse',
                           'plan': plan, 'state': {'mode': mode, 'iterations': iterations,
                           'objects': int(points is not None), 'id': 0 if points is not None else None},
                           'input': tensor, 'outputs': outputs}
        self.frame += 1
        # The coarse pass seeds internal tracking but intentionally emits no external body.
        if reported is None:
            return None
        joints = normalize_joints(reported, width, height)
        return {'coords': joints['points'], 'visibility': joints['visibility'],
                'sdkPoints': np.asarray(reported, np.float32)}

    def _coarse(self, *, rgb):
        tensor, _ = skeleton005_auto(rgb)
        return tensor, self.networks.infer(tensor=tensor[None], network='coarse')

    def _refine(self, *, rgb, box):
        tensor = refine_tensor(rgb, box)
        return tensor, self.networks.infer(tensor=tensor[None], network='refine')


def heatmaps(output):
    if (not isinstance(output, np.ndarray) or output.ndim != 4 or output.shape[0] != 1
            or output.dtype not in (np.dtype('int16'), np.dtype('float32'))
            or not output.size or not np.isfinite(output).all()):
        raise ValueError('finite int16 or float32 NHWC body output required')
    values = output[0].transpose(2, 0, 1).astype(np.float32)
    if output.dtype == np.int16:
        values /= np.float32(1024)
    return values.tolist()
