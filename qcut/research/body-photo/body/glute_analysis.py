"""Bind automatic contour estimates to the original pixels and ONNX perception."""
import hashlib

if __package__:
    from .glute_detection import detect_glute_contours
    from .glute_lift import validate_selection
else:
    from glute_detection import detect_glute_contours
    from glute_lift import validate_selection


PROVIDER = "standalone-glute-contours-v1"


def validate_detection(*, detection, source_hash):
    if (not isinstance(detection, dict) or type(detection.get("available")) is not bool
            or detection.get("inputRgbaSha256") != source_hash
            or detection.get("provider") != PROVIDER
            or detection.get("anatomicalLandmarksDetected") is not False):
        raise ValueError("automatic contour source evidence does not match the photo")
    confidence = detection.get("confidence")
    if type(confidence) not in (int, float) or not 0 <= confidence <= 1:
        raise ValueError("bounded contour confidence required")
    canonical = dict(detection)
    if detection["available"]:
        if not confidence:
            raise ValueError("available contour requires nonzero confidence")
        canonical["selection"] = validate_selection(selection=detection.get("selection"))
    elif not isinstance(detection.get("reason"), str) or not detection["reason"]:
        raise ValueError("unavailable contour requires a reason")
    return canonical


def unavailable_detection(*, source_hash, reason):
    return {"provider": PROVIDER, "available": False, "confidence": 0., "reason": reason,
            "inputRgbaSha256": source_hash, "anatomicalLandmarksDetected": False,
            "method": "pose-silhouette-image-contour-estimate"}


def analyze_contours(*, rgba, person_mask, pose, perception, mask_error=None):
    digest = hashlib.sha256(rgba.tobytes()).hexdigest()
    if person_mask is None:
        result = unavailable_detection(source_hash=digest, reason="人物轮廓不可用，请手动校正臀部定位。")
        result["diagnostics"] = {"maskError": mask_error}
        return result
    if not isinstance(perception, dict) or perception.get("coarsePeople") != 1:
        return unavailable_detection(source_hash=digest, reason="需要一个可可靠识别的人物，请手动校正臀部定位。")
    try:
        result = detect_glute_contours(rgba=rgba, person_mask=person_mask, pose=pose,
            algorithm_size=perception.get("algorithmSize"))
    except (ValueError, TypeError, OverflowError) as error:
        result = unavailable_detection(source_hash=digest, reason="轮廓信息不足，请手动校正臀部定位。")
        result["diagnostics"] = {"analysisError": str(error)}
        return result
    bound = {**result, "provider": PROVIDER, "inputRgbaSha256": digest,
             "anatomicalLandmarksDetected": False,
             "personMaskSha256": hashlib.sha256(person_mask.tobytes()).hexdigest()}
    return validate_detection(detection=bound, source_hash=digest)
