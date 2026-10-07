"""Classical fitting keeps raw tracking feedback separate from its smoothed targets."""
from functools import partial

import numpy as np

from alignment_assets import load_assets as load_alignment_assets
from alignment_infer import Stage1
from alignment_photo import describe_photo, start_photo
from extra_assets import load_assets
from extra_infer import ExtraHeads
from extra_photo import extra_inference, extra_pass, extra_receipt
from extra_sampling import warm_fitting_points
from slimface_detection import single_face_prediction


def fitting_face(*, rgba, face, model_root, means, model, alignment_assets, alignment_models):
    engine, warm, reset_face, size = start_photo(rgba=rgba, box=face['box'], model_root=model_root,
        assets=alignment_assets, models=alignment_models, expansion=1, flags=[1, 0, 0],
        algorithm_box=face['algorithm_box'])
    seed = warm['seed']
    raw_points, first = extra_inference(primary=warm['tracked'], seed=seed, means=means, model=model,
        frame=warm['algorithm'], size=size, reset=True, fitting_history=True)
    targets = warm_fitting_points(points=raw_points, seed=seed, size=size)
    first = {**first, 'points': targets.tolist()}
    engine.refine_tracking(points=raw_points[:106])
    result = engine.process(rgba=rgba, size=size, index=1, face=reset_face)
    points, last = extra_pass(primary=result['tracked'], seed=seed, means=means, model=model,
        frame=result['algorithm'], size=size, reset=False, fitting_history=True)
    base = describe_photo(warm=warm, result=result, size=size,
        original_size=(rgba.shape[1], rgba.shape[0]), algorithm_box_preserved=True)
    return {**base, 'extraPasses': [first, last], 'extraPoints': points.tolist()}


def predict_fitting_photo(*, rgba, model_root):
    means = load_assets(path=model_root/'extra-means-v1.npz')
    model = ExtraHeads(model=model_root/'face-extra-160.onnx')
    selected = single_face_prediction(rgba=rgba, predictor=partial(fitting_face, model_root=model_root,
        means=means, model=model,
        alignment_assets=load_alignment_assets(path=model_root/'alignment-assets-v1.npz'),
        alignment_models={side: Stage1(size=side, model=model_root/f'face-align-{side}.onnx')
            for side in (120, 160)}))
    base = {key: value for key, value in selected.items() if key not in ('extraPasses', 'extraPoints')}
    return {**extra_receipt(base=base, passes=selected['extraPasses'],
        points=np.asarray(selected['extraPoints'], np.float32), fitting_history=True,
        interleave_alignment=True), 'scope': 'original-photo-classical-fitting-Extra240',
        'rawExtraTrackingFeedback': True}
