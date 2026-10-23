"""Conservative leg availability for the portable still-photo renderer."""
import numpy as np


LEG_JOINTS = (8, 9, 10, 11, 12, 13)
JOINT_NAMES = ("rightHip", "rightKnee", "rightAnkle", "leftHip", "leftKnee", "leftAnkle")
MINIMUM_SCORE = .2


def _decision(*, eligible, code, reason, diagnostics, points=None):
    return {"eligible": eligible, "reasonCode": code, "reason": reason,
            "diagnostics": diagnostics, "points": points or {}}


def _numeric_array(*, value):
    array = np.asarray(value)
    if array.dtype.kind not in "iuf":
        raise ValueError("numeric data required")
    return array.astype(np.float64)


def evaluate_long_leg(*, pose, perception, width, height):
    diagnostics = {"minimumJointScore": MINIMUM_SCORE, "requiredJointNames": list(JOINT_NAMES)}

    def refuse(*, code, reason):
        return _decision(eligible=False, code=code, reason=reason, diagnostics=diagnostics)

    try:
        image_size = _numeric_array(value=[width, height])
        if (any(isinstance(value, (bool, np.bool_)) for value in (width, height))
                or image_size.shape != (2,) or not np.all(np.isfinite(image_size)) or np.any(image_size < 2)):
            return refuse(code="invalid-image-size", reason="finite positive photo dimensions required")
        if not isinstance(perception, dict):
            return refuse(code="invalid-perception", reason="body perception metadata is missing")
        count = perception.get("coarsePeople")
        if type(count) is not int or count != 1:
            return refuse(code="ambiguous-person", reason="exactly one detected person is required")
        algorithm_size = _numeric_array(value=perception.get("algorithmSize"))
        if (algorithm_size.shape != (2,) or not np.all(np.isfinite(algorithm_size))
                or np.any(algorithm_size < 2)):
            return refuse(code="invalid-algorithm-size", reason="valid pose coordinate dimensions required")
        # The long side is resized without cropping; the short side may round by one pixel.
        aspect_error = abs(algorithm_size[0] - algorithm_size[1] * image_size[0] / image_size[1])
        if aspect_error > max(1.5, 1.5 * image_size[0] / image_size[1]):
            return refuse(code="aspect-mismatch", reason="pose coordinate dimensions do not match the photo")
        points = _numeric_array(value=pose)
        if points.shape != (18, 4) or not np.all(np.isfinite(points)):
            return refuse(code="invalid-pose", reason="finite 18-joint pose data required")
        legs = points[list(LEG_JOINTS)]
        missing = [name for name, joint in zip(JOINT_NAMES, legs) if joint[3] != 1]
        diagnostics["missingJoints"] = missing
        if missing:
            return refuse(code="missing-leg-joints", reason="both hips, knees and ankles must be visible")
        diagnostics["jointScores"] = {name: float(joint[2]) for name, joint in zip(JOINT_NAMES, legs)}
        if np.any(legs[:, 2] < MINIMUM_SCORE):
            return refuse(code="low-confidence", reason="leg joints are not confident enough")
        if np.any(legs[:, :2] < 0) or np.any(legs[:, :2] >= algorithm_size):
            return refuse(code="outside-photo", reason="leg joints are outside the photo")
        xy = legs[:, :2] * image_size / algorithm_size
        legs_xy = xy.reshape(2, 3, 2)
        segments = np.diff(legs_xy, axis=1)
        lengths = np.linalg.norm(segments, axis=-1)
        minimum_length = max(4., .04 * float(np.linalg.norm(image_size)))
        diagnostics.update(legSegmentLengths=lengths.tolist(), minimumSegmentLength=minimum_length)
        if np.any(lengths < minimum_length):
            return refuse(code="short-segment", reason="leg segments are too small or collapsed")
        down_fraction = segments[..., 1] / lengths
        diagnostics["segmentDownwardFractions"] = down_fraction.tolist()
        if np.any(down_fraction < .25):
            return refuse(code="non-upright-legs", reason="both leg segments must extend sufficiently downward")
        ratios = lengths[:, 0] / lengths[:, 1]
        side_ratio = float(lengths[0].sum() / lengths[1].sum())
        diagnostics.update(thighToCalfRatios=ratios.tolist(), rightToLeftLegLengthRatio=side_ratio)
        if np.any(ratios < .35) or np.any(ratios > 2.8) or not .4 <= side_ratio <= 2.5:
            return refuse(code="implausible-proportions", reason="leg segment proportions are inconsistent")
        ankles = legs_xy[:, 2]
        margins = np.maximum(2., lengths[:, 1] * .12)
        clearance = image_size[1] - ankles[:, 1]
        diagnostics.update(ankleBottomClearance=clearance.tolist(), minimumFootClearance=margins.tolist())
        if np.any(clearance < margins):
            return refuse(code="cropped-feet", reason="ankles are too close to the photo edge to confirm complete feet")
        shoulders = points[[2, 5]]
        shoulders_valid = (np.all(shoulders[:, 3] == 1) and np.all(shoulders[:, 2] >= MINIMUM_SCORE)
                           and np.all(shoulders[:, :2] >= 0) and np.all(shoulders[:, :2] < algorithm_size))
        source_points = {
            "hips": legs_xy[:, 0].tolist(), "knees": legs_xy[:, 1].tolist(), "ankles": ankles.tolist(),
            "shoulders": (shoulders[:, :2] * image_size / algorithm_size).tolist() if shoulders_valid else [],
        }
        result = _decision(eligible=True, code="complete-legs", reason=None,
                           diagnostics=diagnostics, points=source_points)
        result.update(minimumAnkleY=float(ankles[:, 1].min()),
                      minimumKneeY=float(legs_xy[:, 1, 1].min()),
                      minimumHipY=float(legs_xy[:, 0, 1].min()))
        return result
    except (ValueError, TypeError, OverflowError):
        return refuse(code="invalid-input", reason="invalid pose or photo dimensions")
