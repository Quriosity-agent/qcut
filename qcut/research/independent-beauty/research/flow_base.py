"""Original photo to independently predicted NH Base106 and algorithm pixels.

Still profiles specify when the NH graph resets its Base smoothing history.
This front end does not run the GAN or claim FlowGAN PNG parity.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from alignment_assets import load_assets
from alignment_sequence import Sequence, describe
from consumer_points import total_face_points
from face_detection import Detector
from detection_geometry import algorithm_size
from facefitting_infer import native_images
from flowgan_frame import resize as resize_algorithm
from nh_assets import load_mean
from nh_geometry import crop_transform
from slimface_render import validate_rgba
from facefitting_image import decode_image

F = np.float32


def predict(*, rgba, model_root, stabilized=False, still_profile='flowgan'):
    validate_rgba(rgba=rgba)
    if type(stabilized) is not bool:
        raise ValueError("typed NH still-frame mode required")
    if type(still_profile) is not str or still_profile not in ('flowgan', 'spot-acne'):
        raise ValueError('known NH still-photo lifecycle profile required')
    if np.any(rgba[..., 3] != 255):
        raise ValueError('NH front-end acceptance requires an opaque photo')
    size = algorithm_size(size=(rgba.shape[1], rgba.shape[0]))
    algorithm, algorithm_gpu = resize_algorithm(frame=rgba, size=size, runtime=model_root.parent)
    detection = Detector(model=model_root/'face-detector-dynamic.onnx').detect(rgba=algorithm)
    if len(detection['rects']) != 1:
        raise ValueError('NH front end currently requires exactly one detected rectangle')
    assets = load_assets(path=model_root/'alignment-assets-v1.npz')
    smoothing = {'width': size[1], 'height': size[0], 'alpha': float(F(.2))}
    face = {'identity': (0, 4096, 0), 'mode': 'seed-160',
        'order': assets['order'], 'mean': assets['mean'],
        'smoothing': [{**smoothing, 'escale': 10} for _ in range(2)],
        'tracking_smoothing': {**smoothing, 'escale': 3},
        'initialization': {'call': {'format': 0, 'orientation': 0, 'target': [160, 160],
            'flags': [1, 0, 0], 'rect': {'values': detection['rects'][0].tolist()}, 'expansion': 1}}}
    sequence = Sequence(model_root=model_root)
    warm = sequence.process(rgba=algorithm, size=size, index=0, face=face)
    reset_index = 2 if still_profile == 'flowgan' else 1
    final = sequence.process(rgba=algorithm, size=size, index=1,
        face={**face, 'mode': 'reset-120' if reset_index == 1 else 'update', 'initialization': None})
    if stabilized:
        final = sequence.process(rgba=algorithm, size=size, index=2,
            face={**face, 'mode': 'reset-120' if reset_index == 2 else 'update', 'initialization': None})
        final = sequence.process(rgba=algorithm, size=size, index=3,
            face={**face, "mode": "update", "initialization": None})
    for result in (warm, final):
        for heads in result['heads'].values():
            if float(heads['prob'].reshape(-1)[0]) > .5:
                raise ValueError('NH alignment confidence rejected')
    isolation = native_images()
    if isolation['private_native_images']:
        raise ValueError('independent NH front end loaded private native libraries')
    mean = load_mean(path=model_root/'nh-mean-v1.npy')
    warm_points = total_face_points(points=warm['points'], algorithm_size=size, original_size=size)
    final_points = total_face_points(points=final['points'], algorithm_size=size, original_size=size)
    descriptions = []
    for result in (warm, final):
        description = describe(result=result)
        description['native_geometry_dependencies_required'] = False
        description['geometrySource'] = 'owned-detector-and-hash-bound-canonical-alignment'
        descriptions.append(description)
    return {'algorithm': algorithm,
        'warmPoints': warm_points, 'points': final_points,
        'warmCrop': crop_transform(points=warm_points, mean=mean),
        'crop': crop_transform(points=final_points, mean=mean),
        'algorithmSize': list(size), 'detectorRect': detection['rects'][0].tolist(),
        'algorithmGpu': algorithm_gpu,
        'scope': 'original-photo-independent-NH-Base106',
        'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
        'algorithmRgbaSha256': hashlib.sha256(algorithm.tobytes()).hexdigest(),
        'algorithmBgrSha256': hashlib.sha256(np.ascontiguousarray(algorithm[..., :3][..., ::-1]).tobytes()).hexdigest(),
        'warm': descriptions[0], 'final': descriptions[1], 'independence': isolation,
        'fixedLandmarks': False, 'nativeGeometryUsed': False,
        'stabilizedFrame': stabilized, 'stillProfile': still_profile,
        'flowGanPixelsVerified': False, 'videoVerified': False}


def receipt(*, prediction):
    result = {key: value for key, value in prediction.items() if key != 'algorithm'}
    for key in ('warmPoints', 'points'):
        result[key] = result[key].tolist()
    for key in ('warmCrop', 'crop'):
        result[key] = {name: matrix.tolist() for name, matrix in result[key].items()}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--stabilized', action='store_true')
    args = parser.parse_args()
    if args.report.exists() or args.report.resolve() == args.image.resolve():
        parser.error('fresh distinct NH receipt required')
    prediction = predict(rgba=decode_image(image=args.image, max_edge=1280)['rgba'],
        model_root=args.runtime/'research', stabilized=args.stabilized)
    args.report.write_text(json.dumps(receipt(prediction=prediction), indent=2, allow_nan=False)+'\n')
