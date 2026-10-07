"""Select exactly one accepted research face and return its 106 landmarks."""
import numpy as np


def single_face_prediction(*, rgba, predictor=None):
    from worker import detect, landmarks
    faces = detect(np.ascontiguousarray(rgba[:, :, :3]))
    predictions = [landmarks(rgba, face) if predictor is None else predictor(rgba=rgba, face=face) for face in faces]
    accepted = [prediction for prediction in predictions if prediction["prob"][0] <= .5 and prediction["seed_prob"][0] <= .5]
    if len(accepted) != 1:
        raise ValueError(f"slim-face requires exactly one accepted face; found {len(accepted)}")
    return {**accepted[0], "acceptance_policy": "research-seed-and-120-prob0<=0.5"}


def single_face_points(*, rgba):
    return np.asarray(single_face_prediction(rgba=rgba)["points"])
