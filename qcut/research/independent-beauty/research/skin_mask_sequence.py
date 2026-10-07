"""Independent skin-mask propagation for a bounded continuous seek lifecycle."""
import hashlib
from pathlib import Path

import numpy as np

from facefitting_infer import native_images
from skin_mask_frontend import MODELS, predict_skin_mask, prepare_skin_tensor

OPENCV_VERSION = "4.12.0"
MOTION_REFRESH = .01
ZERO_MOTION = 1e-6
APPEARANCE_REFRESH = .01


def gray_from_bgr(*, bgr):
    if (type(bgr) is not np.ndarray or bgr.dtype != np.uint8 or bgr.ndim != 3
            or bgr.shape[-1] != 3 or not 16 <= min(bgr.shape[:2]) <= max(bgr.shape[:2]) <= 256):
        raise ValueError("bounded uint8 BGR required")
    # The consumer uses an integer truncation rather than cvtColor's rounded weights.
    return ((bgr.astype(np.int32) @ [29, 150, 77]) >> 8).astype(np.uint8)


def flow_motion(*, displacement):
    if (type(displacement) is not np.ndarray or displacement.dtype != np.float32
            or displacement.ndim != 3 or displacement.shape[-1] != 2
            or not 16 <= min(displacement.shape[:2]) <= max(displacement.shape[:2]) <= 256
            or not np.isfinite(displacement).all()):
        raise ValueError("finite float32 two-channel displacement required")
    x, y = displacement[..., 0], displacement[..., 1]
    x_squared = (x * x).astype(np.float32)
    magnitude = (y.astype(np.float64) * y.astype(np.float64) + x_squared.astype(np.float64)).astype(np.float32)
    # Preserve the consumer's sequential float32 accumulation and final division.
    total = np.add.accumulate(magnitude.ravel(), dtype=np.float32)[-1]
    return float(np.float32(total / np.float32(magnitude.size)))


def propagate_alpha(*, alpha, displacement, cv):
    flow_motion(displacement=displacement)
    if (type(alpha) is not np.ndarray or alpha.dtype != np.uint8 or alpha.ndim != 2
            or displacement.shape != (*alpha.shape, 2)):
        raise ValueError("mask and flow dimensions must match")
    y, x = np.indices(alpha.shape, dtype=np.float32)
    mapping = displacement + np.stack((x, y), axis=-1)
    return cv.remap(alpha, mapping, None, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT, borderValue=0)


def create_flow(*, cv):
    flow = cv.DISOpticalFlow_create(cv.DISOPTICAL_FLOW_PRESET_ULTRAFAST)
    flow.setFinestScale(2)
    flow.setPatchSize(8)
    flow.setPatchStride(4)
    flow.setGradientDescentIterations(12)
    flow.setVariationalRefinementIterations(0)
    flow.setVariationalRefinementAlpha(20)
    flow.setVariationalRefinementDelta(5)
    flow.setVariationalRefinementGamma(10)
    flow.setUseMeanNormalization(True)
    flow.setUseSpatialPropagation(True)
    return flow


def digest(*, array):
    return hashlib.sha256(array.tobytes()).hexdigest()


class SkinMaskSequence:
    """One process call per seek; the renderer currently issues two seeks per frame."""

    def __init__(self, runtime):
        import cv2
        if cv2.__version__ != OPENCV_VERSION:
            raise ValueError("locked OpenCV 4.12.0 required")
        self.runtime = Path(runtime).resolve()
        self.cv = cv2
        self.cv.setNumThreads(1)
        self.reset()

    def reset(self):
        self.seek_index = 0
        self.flow = create_flow(cv=self.cv)
        self.previous_gray = None
        self.previous_alpha = None
        self.original_size = None
        self.model_receipt = None

    def process(self, *, rgba):
        tensor, prepared = prepare_skin_tensor(rgba=rgba)
        mask_size = tuple(prepared["maskSize"])
        if mask_size not in MODELS:
            raise ValueError("unverified sequence segmentation profile")
        original_size = (rgba.shape[1], rgba.shape[0])
        if self.original_size is not None and original_size != self.original_size:
            raise ValueError("sequence dimensions changed; reset explicitly")
        gray = gray_from_bgr(bgr=(tensor[0] + 128).astype(np.uint8))
        previous_gray_digest = None if self.previous_gray is None else digest(array=self.previous_gray)
        previous_alpha_digest = None if self.previous_alpha is None else digest(array=self.previous_alpha)
        motion = 0.0
        appearance_delta = 0.0
        displacement_digest = None
        predicted = self.seek_index < 2
        phase = "warm-start" if self.seek_index == 0 else "initialize-temporal"
        if predicted:
            texture, model_receipt = predict_skin_mask(rgba=rgba, runtime=self.runtime)
            alpha = texture[..., 3].copy()
        else:
            displacement = self.flow.calc(gray, self.previous_gray, None)
            motion = flow_motion(displacement=displacement)
            appearance_delta = float(np.abs(gray.astype(np.int16) - self.previous_gray.astype(np.int16)).mean())
            if motion >= MOTION_REFRESH or (abs(motion) < ZERO_MOTION and appearance_delta >= APPEARANCE_REFRESH):
                raise ValueError("unverified skin-mask network refresh branch; reset or use still rendering")
            alpha = propagate_alpha(alpha=self.previous_alpha, displacement=displacement, cv=self.cv)
            texture = np.zeros((*alpha.shape, 4), np.uint8)
            texture[..., 3] = alpha
            model_receipt = self.model_receipt
            displacement_digest = digest(array=displacement)
            phase = "cached-network-optical-flow"
        isolation = native_images()
        if isolation["private_native_images"]:
            raise ValueError("independent sequence process loaded a private native image")
        receipt = model_receipt | prepared | isolation | {
            "outputRgbaSha256": digest(array=texture),
            "networkInputSignedBgrSha256": model_receipt.get("signedBgrSha256"),
            "networkPredictionOriginalRgbaSha256": model_receipt.get("originalRgbaSha256"),
            "nativeInputsUsed": False, "nativePixelsUsed": False, "nativeGeometryUsed": False,
            "sequence": {"seekIndex": self.seek_index, "phase": phase,
                         "networkPredictedThisSeek": predicted, "stateResetBetweenSeeks": False,
                         "networkPredictionSeekIndex": self.seek_index if predicted else 1,
                         "originalSize": list(original_size), "opencvVersion": self.cv.__version__,
                         "graySha256": digest(array=gray), "previousGraySha256": previous_gray_digest,
                         "previousAlphaSha256": previous_alpha_digest, "flowSha256": displacement_digest,
                         "flowMotion": motion, "appearanceMeanAbsoluteDifference": appearance_delta,
                         "refreshBranchSupported": False, "flowBitExactAccepted": False,
                         "nativeInputsUsed": False}}
        self.original_size = original_size
        self.model_receipt = model_receipt
        self.previous_gray = gray.copy() if self.seek_index >= 1 else None
        self.previous_alpha = alpha.copy() if self.seek_index >= 1 else None
        self.seek_index += 1
        return texture, receipt
