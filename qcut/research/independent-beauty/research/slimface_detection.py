"""Select exactly one accepted research face and return its 106 landmarks."""
import numpy as np
from alignment_photo import RejectedPhotoFace


def single_face_prediction(*, rgba, predictor=None, face_reference=None, source_evidence=None):
    if face_reference is not None and source_evidence is not None:
        raise ValueError('same-photo and source-history selection cannot be combined')
    policy = 'research-seed-and-120-prob0<=0.5'
    if face_reference is not None:
        from face_selection_reference import validate_reference_input
        validate_reference_input(reference=face_reference, rgba=rgba)
    from worker import detect, landmarks
    faces = detect(np.ascontiguousarray(rgba[:, :, :3]))
    predictions = []
    for face in faces:
        try:
            predictions.append(landmarks(rgba, face) if predictor is None else predictor(rgba=rgba, face=face))
        except RejectedPhotoFace:
            continue
    accepted = [prediction for prediction in predictions if prediction["prob"][0] <= .5 and prediction["seed_prob"][0] <= .5]
    if face_reference is not None:
        from face_selection_reference import associate_predictions
        selected = associate_predictions(reference=face_reference, predictions=accepted)
    elif len(accepted) > 1 and source_evidence is not None:
        from source_face_confirmation import POLICY, confirm_candidates
        selected = confirm_candidates(predictions=accepted, rgba=rgba, path=source_evidence)
        policy = POLICY
    elif len(accepted) != 1:
        raise ValueError(f"slim-face requires exactly one accepted face; found {len(accepted)}")
    else:
        selected = accepted[0]
    return {**selected, "acceptance_policy": policy,
            "rejected_candidate_count": len(faces) - len(accepted)}


def single_face_points(*, rgba):
    return np.asarray(single_face_prediction(rgba=rgba)["points"])
