"""Fresh video alignment history from the owned detector's algorithm rectangle."""
import numpy as np

from alignment_sequence import Sequence


def start_video_face(*, algorithm, box, assets, models, model_root, identifier=0, seed_only=False):
    height, width = algorithm.shape[:2]
    size = (width, height)
    box = np.asarray(box, np.float32)
    if (box.shape != (4,) or not np.isfinite(box).all()
            or not np.array_equal(box, np.trunc(box)) or (box[:2] < 0).any()
            or (box[2:] < 1).any() or (box[:2] + box[2:] > size).any()):
        raise ValueError('bounded integer video detector rectangle required')
    smoothing = {'width': height, 'height': width, 'alpha': float(np.float32(.2))}
    face = {'identity': (identifier, 4096, 0), 'mode': 'seed-160',
            'order': assets['order'], 'mean': assets['mean'],
            'smoothing': [{**smoothing, 'escale': 10} for _ in range(2)],
            'tracking_smoothing': {**smoothing, 'escale': 3},
            'initialization': {'call': {'format': 0, 'orientation': 0, 'target': [160, 160],
                                       'flags': [1, 0, 0], 'rect': {'values': box.tolist()}, 'expansion': 1}}}
    engine = Sequence(model_root=model_root, models=models, normalize_output=False)
    result = engine.process(rgba=algorithm, size=size, index=0, face=face, seed_only=seed_only)
    return engine, result, {**face, 'mode': 'update', 'initialization': None}, size
