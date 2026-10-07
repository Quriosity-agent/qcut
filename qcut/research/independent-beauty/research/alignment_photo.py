"""Fresh photo seed -> owned similarity warp -> 120 -> ordinary Base106.

Direct callers may supply a research box; the native-box route preserves
algorithm-space integer rectangles without a roundtrip through original space.
Each photo starts fresh; there is no implied video identity or pose parity.
"""
import numpy as np

from alignment_sequence import Sequence, describe
from detection_geometry import algorithm_size
from consumer_pose import total_face_pose
from consumer_points import total_face_points
from alignment_decode import normalized


def start_photo(*, rgba, box, model_root, assets, models, expansion, flags, algorithm_box=None):
    height, width = rgba.shape[:2]
    size = algorithm_size(size=(width, height))
    box = np.asarray(box, np.float32)
    if box.shape != (4,) or not np.isfinite(box).all() or (box[2:] < 1).any():
        raise ValueError("finite detector box with positive sides required")
    mapped = box * np.array([size[0] / width, size[1] / height] * 2, np.float32)
    if algorithm_box is not None:
        mapped = np.asarray(algorithm_box, np.float32)
        if (mapped.shape != (4,) or not np.isfinite(mapped).all() or not np.array_equal(mapped, np.trunc(mapped))
                or (mapped[:2] < 0).any() or (mapped[2:] < 1).any()
                or (mapped[:2] + mapped[2:] > size).any() or expansion != 1 or flags != [1, 0, 0]):
            raise ValueError("bounded algorithm-space detector rectangle and observed crop profile required")
    call = {"format": 0, "orientation": 0, "target": [160, 160], "flags": flags,
            "rect": {"values": mapped.tolist()}, "expansion": expansion}
    profile = {"width": size[1], "height": size[0], "alpha": float(np.float32(.2))}
    face = {"identity": (0, 4096, 0), "mode": "seed-160", "order": assets["order"], "mean": assets["mean"],
            "smoothing": [{**profile, "escale": 10} for _ in range(2)],
            "tracking_smoothing": {**profile, "escale": 3}, "initialization": {"call": call}}
    engine = Sequence(model_root=model_root, models=models)
    warm = engine.process(rgba=rgba, size=size, index=0, face=face)
    return engine, warm, {**face, "mode": "reset-120", "initialization": None}, size


def describe_photo(*, warm, result, size, original_size, algorithm_box_preserved):
    width, height = original_size
    heads = result["heads"][120]
    crop = warm["seed_crop"]
    points = total_face_points(points=result["points"], algorithm_size=size, original_size=(width, height))
    provenance = describe(result=result)
    seed_provenance = describe(result=warm)
    yaw = float(heads["fc_yaw"].reshape(-1)[0])
    pitch = float(heads["fc_pitch"].reshape(-1)[0])
    consumer_pose = total_face_pose(raw_yaw=yaw, raw_pitch=pitch)
    return {"points": points.tolist(),
            "algorithm_points": result["points"].tolist(),
            "seed_algorithm_points": warm["seed"].tolist(),
            "normalized_points": normalized(points=result["points"], size=size).tolist(),
            "visible": heads["fc_visible"].reshape(-1).tolist(),
            "prob": heads["prob"].reshape(-1).tolist(), "seed_prob": warm["heads"][160]["prob"].reshape(-1).tolist(),
            "yaw": yaw, "pitch": pitch, "consumer_pose": consumer_pose,
            "pose_source": consumer_pose["source"], "crop": crop["rect"][:3],
            "crop_coordinate_space": "algorithm-image-pixels", "algorithm_size": list(size), "resize": crop["resize"],
            "input_tensor_sha256": provenance["tensor_sha256"]["120"],
            "seed_tensor_sha256": seed_provenance["tensor_sha256"]["160"],
            "final_tracking_points": True, "tracking_history": "fresh-photo",
            "photo_lifecycle": "warm-seed160-output-reset120", "prediction_sizes": [160, 120, 120],
            "points_source": "owned-reset120-normalized-to-TotalFace",
            "tracking_transform_source": "owned-160-seed", "native_tracking_matrices_used": False,
            "native_seed_inverse_used": provenance["native_seed_inverse_used"],
            "algorithm_box_preserved": algorithm_box_preserved,
            "native_crop_selection_reproduced": algorithm_box_preserved, "native_product_parity_verified": False}


def predict_photo(*, rgba, box, model_root, assets, models, expansion, flags, algorithm_box=None):
    engine, warm, face, size = start_photo(rgba=rgba, box=box, model_root=model_root,
        assets=assets, models=models, expansion=expansion, flags=flags, algorithm_box=algorithm_box)
    result = engine.process(rgba=rgba, size=size, index=1, face=face)
    return describe_photo(warm=warm, result=result, size=size,
        original_size=(rgba.shape[1], rgba.shape[0]), algorithm_box_preserved=algorithm_box is not None)
