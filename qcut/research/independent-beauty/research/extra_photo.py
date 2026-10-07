"""Original photo to owned ordinary Extra240 algorithm-space points."""
import argparse
import hashlib
import json
from functools import partial
from pathlib import Path

import numpy as np

from algorithm_frame import resize_rgba
from extra_assets import load_assets
from extra_geometry import crop_geometry,decode_extra
from extra_infer import ExtraHeads
from extra_sampling import signed_extra_input, warm_fitting_points
from alignment_sampling import signed_input
from facefitting_image import decode_image
from facefitting_infer import native_images
from slimface_detection import single_face_prediction


def extra_inference(*, primary, seed, means, model, frame, size, reset, fitting_history):
    geometry=crop_geometry(primary=primary,seed=seed,part_mean=means['part'],
        extra_mean=means['extra'],size=size,reset=reset)
    tensor=(signed_extra_input(frame=frame,forward=geometry['forward']) if fitting_history
        else signed_input(frame=frame,forward=geometry['forward'],size=(160,160)))
    raw=model.infer(tensor=tensor)
    points=decode_extra(raw=raw,mean=means['extra'],geometry=geometry)
    receipt={'reset':reset,'geometry':{key:value.tolist() for key,value in geometry.items()},
        'tensorSha256':hashlib.sha256(tensor.astype(np.int64).tobytes()).hexdigest(),
        'headSha256':hashlib.sha256(raw.tobytes()).hexdigest(),'points':points.tolist()}
    return points,receipt


def extra_pass(*, primary, seed, means, model, frame, size, reset, fitting_history):
    points,receipt=extra_inference(primary=primary,seed=seed,means=means,model=model,frame=frame,
        size=size,reset=reset,fitting_history=fitting_history)
    if fitting_history and reset:
        points=warm_fitting_points(points=points,seed=seed,size=size)
        receipt={**receipt,'points':points.tolist()}
    return points,receipt


def interleaved_face(*, rgba, face, model_root, means, model, alignment_assets, alignment_models):
    from alignment_photo import start_photo, describe_photo
    engine,warm,reset_face,size=start_photo(rgba=rgba,box=face['box'],model_root=model_root,
        assets=alignment_assets,models=alignment_models,expansion=1,flags=[1,0,0],
        algorithm_box=face['algorithm_box'])
    seed=warm['seed']
    refined,first=extra_pass(primary=warm['tracked'],seed=seed,means=means,model=model,
        frame=warm['algorithm'],size=size,reset=True,fitting_history=False)
    engine.refine_tracking(points=refined[:106])
    result=engine.process(rgba=rgba,size=size,index=1,face=reset_face)
    points,last=extra_pass(primary=result['tracked'],seed=seed,means=means,model=model,
        frame=result['algorithm'],size=size,reset=False,fitting_history=False)
    base=describe_photo(warm=warm,result=result,size=size,original_size=(rgba.shape[1],rgba.shape[0]),
        algorithm_box_preserved=True)
    return {**base,'extraPasses':[first,last],'extraPoints':points.tolist()}


def predict_extra_photo(*, rgba, model_root, fitting_history=False, interleave_alignment=False):
    if type(fitting_history) is not bool or type(interleave_alignment) is not bool:
        raise ValueError("typed fitting history and alignment lifecycle required")
    if fitting_history and interleave_alignment:
        raise ValueError('interleaved fitting history is unverified')
    if interleave_alignment:
        from alignment_assets import load_assets as alignment_assets
        from alignment_infer import Stage1
        means=load_assets(path=model_root/'extra-means-v1.npz')
        model=ExtraHeads(model=model_root/'face-extra-160.onnx')
        selected=single_face_prediction(rgba=rgba,predictor=partial(interleaved_face,model_root=model_root,
            means=means,model=model,alignment_assets=alignment_assets(path=model_root/'alignment-assets-v1.npz'),
            alignment_models={side:Stage1(size=side,model=model_root/f'face-align-{side}.onnx') for side in (120,160)}))
        base={key:value for key,value in selected.items() if key not in ('extraPasses','extraPoints')}
        passes=selected['extraPasses']
        points=np.asarray(selected['extraPoints'],np.float32)
        return extra_receipt(base=base,passes=passes,points=points,
            fitting_history=fitting_history,interleave_alignment=True)
    base=single_face_prediction(rgba=rgba)
    primary=np.asarray(base['algorithm_points'],np.float32)
    seed=np.asarray(base['seed_algorithm_points'],np.float32)
    means=load_assets(path=model_root/'extra-means-v1.npz')
    model=ExtraHeads(model=model_root/'face-extra-160.onnx')
    size=tuple(base['algorithm_size'])
    algorithm=resize_rgba(frame=rgba,size=size)
    passes=[]
    for reset in (True,False):
        points,receipt=extra_pass(primary=primary,seed=seed,means=means,model=model,frame=algorithm,
            size=size,reset=reset,fitting_history=fitting_history)
        passes.append(receipt)
    return extra_receipt(base=base,passes=passes,points=points,
        fitting_history=fitting_history,interleave_alignment=False)


def extra_receipt(*, base, passes, points, fitting_history, interleave_alignment):
    independence=native_images()
    if independence['private_native_images']:
        raise ValueError('independent Extra loaded vendor native libraries')
    return {'scope':'original-photo-ordinary-Extra240','algorithmSize':list(base['algorithm_size']),
        'fittingHistory':fitting_history,'interleavedAlignment':interleave_alignment,
        'base':base,'passes':passes,'points':points.tolist(),'fixedLandmarks':False,
        'nativeCropMatricesUsed':False,'privateAssetDependency':True,'independence':independence,
        'videoVerified':False,'nativeProductParityVerified':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--models',type=Path,default=Path(__file__).resolve().parents[1]/'runtime/research')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():
        parser.error('fresh output receipt required')
    result=predict_extra_photo(rgba=decode_image(image=args.image,max_edge=1280)['rgba'],model_root=args.models)
    args.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
