"""Original photo to owned iris20 landmarks without native geometry or crops."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from affine_linear import sample_bgr
from algorithm_frame import resize_rgba
from alignment_sampling import signed_input
from extra_assets import load_assets
from extra_geometry import map_points
from extra_infer import ExtraHeads
from extra_photo import predict_extra_photo
from facefitting_image import decode_image
from facefitting_infer import native_images
from iris_assets import load_mean
from iris_geometry import decode_pupil, eye_crop
from iris_infer import IrisHeads

F = np.float32


def predict_iris_photo(*, rgba, model_root):
    extra = predict_extra_photo(rgba=rgba, model_root=model_root, interleave_alignment=True)
    size = tuple(extra['algorithmSize'])
    algorithm = resize_rgba(frame=rgba, size=size)
    extra_model = ExtraHeads(model=model_root/'face-extra-160.onnx')
    extra_mean = load_assets(path=model_root/'extra-means-v1.npz')['extra']
    mean = load_mean(path=model_root/'iris-mean-v1.npy')
    iris_model = IrisHeads(model=model_root/'face-iris-48.onnx')
    passes = []
    for step in extra['passes'][-1:]:
        geometry = {key: np.asarray(value, F) for key, value in step['geometry'].items()}
        raw_extra = extra_model.infer(tensor=signed_input(
            frame=algorithm, forward=geometry['forward'], size=(160, 160)))
        # Eye corners are taken before the normalized original-image round trip.
        decoded = (raw_extra.astype(np.float64)+extra_mean.astype(np.float64)/256*160).astype(F)
        algorithm_points = map_points(points=decoded, matrix=geometry['inverse'])
        part = map_points(points=algorithm_points, matrix=geometry['stage2_forward'])
        eyes = []
        for mirrored, indices in ((False, [52, 55]), (True, [58, 61])):
            crop = eye_crop(controls=part[indices], stage2_forward=geometry['stage2_forward'], mirrored=mirrored)
            bgr = sample_bgr(frame=algorithm, forward=crop['forward'], size=(48, 48))
            head = iris_model.infer(bgr=bgr)
            points = decode_pupil(raw=head, mean=mean, crop=crop,
                stage2_inverse=geometry['stage2_inverse'], mirrored=mirrored)
            original = np.empty_like(points)
            original[:, 0] = points[:, 0]*F(1/size[0])*F(rgba.shape[1])
            original[:, 1] = F(rgba.shape[0])-(F(size[1])-points[:, 1])*F(1/size[1])*F(rgba.shape[0])
            eyes.append({'mirrored': mirrored, 'controls': part[indices].tolist(),
                'crop': {key: value.tolist() for key, value in crop.items()},
                'bgrSha256': hashlib.sha256(bgr.tobytes()).hexdigest(),
                'head': head.tolist(), 'algorithmPoints': points.tolist(), 'points': original.tolist()})
        passes.append({'reset': step['reset'], 'eyes': eyes})
    independence = native_images()
    if independence['private_native_images']:
        raise ValueError('independent iris inference loaded private native images')
    return {'scope': 'original-photo-ordinary-iris20', 'algorithmSize': list(size),
        'sourceRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(), 'passes': passes,
        'extraAlgorithmPoints': extra['points'], 'interleavedAlignment': extra['interleavedAlignment'],
        'fixedLandmarks': False, 'nativeCropMatricesUsed': False, 'independence': independence,
        'privateAssetDependency': True, 'warmIrisVerified': False, 'makeupPixelsVerified': False, 'videoVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--models', type=Path, default=Path(__file__).resolve().parents[1]/'runtime/research')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('fresh iris receipt required')
    result = predict_iris_photo(rgba=decode_image(image=args.image, max_edge=1280)['rgba'], model_root=args.models)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
