"""Read the pinned SDK's crop, resize and actual alignment input buffers.

This calls the initialized original preprocessor and original inference, not
an independent alignment implementation. Nothing is installed in the editor.
"""
import ctypes as ct
from pathlib import Path
import subprocess

import numpy as np

from espresso_oracle import DTYPES, private_path
from face_detector_native import NativeDetector, TensorView, pointer, vector
from face_geometry import crop_region
from face_geometry_native import Mat, PREFIX, copy_mat, mat_view


PREPROCESS_SYMBOL = PREFIX + "6module5fsnew12PreProcessor21ProcessDetectionImageERKN9mobilecv23MatERNS3_5Rect_IfEEiibbfb"
PREDICT_SYMBOL = PREFIX + "6module5fsnew13BasePredictor7PredictERKN9mobilecv23MatEb"


def validate_request(*, frame, rect, network_size, expansion, allow_upscale, legacy_anchor):
    image = np.asarray(frame)
    box = np.asarray(rect, dtype=np.float32)
    if (image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3
            or not all(1 <= value <= 4096 for value in image.shape[:2])
            or box.shape != (4,) or not np.isfinite(box).all()
            or (box[2:] < 1).any() or (box[:2] < -4096).any()
            or not isinstance(allow_upscale, bool) or not isinstance(legacy_anchor, bool)
            or not isinstance(network_size, tuple) or len(network_size) != 2
            or not all(type(value) is int and 2 <= value <= 160 for value in network_size)):
        raise ValueError("invalid bounded alignment preprocessing request")
    region = crop_region(rect=box, frame_size=(image.shape[1], image.shape[0]),
                         expansion=expansion, legacy_anchor=legacy_anchor)
    if not 1 <= region.rect[2] <= 4096:
        raise ValueError("alignment crop exceeds probe limits")
    return np.ascontiguousarray(image), box, region


def copy_tensor(*, view):
    n, width, height, channels = tuple(view.dims)
    kind, fraction = tuple(view.raw)
    if (not view.data or kind not in DTYPES or not -16 <= fraction <= 24
            or n != 1 or not all(1 <= value <= 512 for value in (width, height, channels))):
        raise ValueError("invalid alignment tensor descriptor")
    size = n * width * height * channels
    if size * DTYPES[kind].itemsize > 2 * 1024 * 1024:
        raise ValueError("alignment tensor exceeds probe limits")
    value = np.frombuffer(ct.string_at(view.data, size * DTYPES[kind].itemsize),
                          dtype=DTYPES[kind]).reshape(n, height, width, channels).copy()
    if not np.isfinite(value).all():
        raise ValueError("native alignment tensor is nonfinite")
    return value, (kind, fraction)


class NativeAlignmentInput:
    def __init__(self, *, output):
        output = private_path(path=output)
        if output.exists():
            raise ValueError("use a fresh alignment oracle directory")
        output.mkdir(parents=True)
        self.detector = NativeDetector(binary=output / "detector-bridge.dylib")
        try:
            self.library = self.detector.library
            handle = self.detector.handle.value
            # The pool contains 400-byte face records, not a vector of pointers.
            begin, count = vector(address=handle + 0x7c00, width=400, maximum=10)
            self.alignment = pointer(address=begin)
            if (count != 10 or ct.c_uint.from_address(self.alignment + 0x934).value != 0x123456
                    or pointer(address=self.alignment + 0x918) != handle + 0x7af8):
                raise ValueError("unsupported initialized alignment object layout")
            self.predictors = {}
            for size, offset in ((120, 0x7878), (160, 0x7898)):
                predictor = pointer(address=handle + offset)
                if tuple((ct.c_int * 2).from_address(predictor + 0x3c)) != (size, size):
                    raise ValueError("unexpected initialized alignment network size")
                self.predictors[size] = predictor
            self.preprocess = getattr(self.library, PREPROCESS_SYMBOL)
            self.preprocess.argtypes = [ct.c_void_p] * 3 + [ct.c_int] * 2 + [ct.c_bool] * 2 + [ct.c_float, ct.c_bool]
            self.preprocess.restype = ct.c_void_p
            self.predict = getattr(self.library, PREDICT_SYMBOL)
            binary = output / "alignment-input-bridge.dylib"
            subprocess.run(["xcrun", "clang++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror",
                            "-dynamiclib", str(Path(__file__).with_name("face_alignment_input_bridge.mm")),
                            "-o", str(binary)], check=True, timeout=120)
            self.bridge = ct.CDLL(str(binary))
            self.infer_function = self.bridge.qcut_alignment_input
            self.infer_function.argtypes = [ct.c_void_p] * 5
            self.infer_function.restype = ct.c_int
        except BaseException:
            self.close()
            raise

    def close(self):
        self.detector.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def prepare(self, *, frame, rect, network_size, expansion=1.5,
                allow_upscale=False, legacy_anchor=False):
        self.detector.require_open()
        image, box, _ = validate_request(frame=frame, rect=rect, network_size=network_size,
                                          expansion=expansion, allow_upscale=allow_upscale,
                                          legacy_anchor=legacy_anchor)
        source = mat_view(array=image)
        native_box = (ct.c_float * 4)(*box)
        address = self.preprocess(self.alignment + 0x7800, ct.byref(source), native_box,
                                  *network_size, allow_upscale, legacy_anchor, expansion, False)
        if address != self.alignment + 0x7880:
            raise ValueError("unexpected original preprocessor result ownership")
        pixels = copy_mat(value=Mat.from_address(address), dtype=np.uint8, channels=3)
        if pixels.shape != (network_size[1], network_size[0], 3):
            raise ValueError("original preprocessor returned incorrect dimensions")
        return tuple(native_box), pixels

    def infer(self, *, pixels):
        self.detector.require_open()
        values = np.asarray(pixels)
        if (values.dtype != np.uint8 or values.ndim != 3 or values.shape[2] != 3
                or values.shape[0] not in self.predictors or values.shape[0] != values.shape[1]):
            raise ValueError("only initialized 120/160 alignment profiles are supported")
        source = mat_view(array=np.ascontiguousarray(values))
        input_view, landmark_view = TensorView(), TensorView()
        status = self.infer_function(self.predict, self.predictors[values.shape[0]],
                                     ct.byref(source), ct.byref(input_view), ct.byref(landmark_view))
        if status:
            raise ValueError(f"original alignment inference failed: {status}")
        inputs, raw = copy_tensor(view=input_view)
        landmarks, landmark_raw = copy_tensor(view=landmark_view)
        if inputs.shape != (1, *values.shape) or landmarks.size != 212 or landmark_raw[0] != 4:
            raise ValueError("initialized alignment tensors are outside the expected profile")
        return inputs, raw, landmarks
