"""Private macOS oracle for the initialized detector, without runtime patches."""
import ctypes as ct
import hashlib
from pathlib import Path
import subprocess

import numpy as np

from espresso_oracle import private_path
from face_geometry_native import MODEL, MODEL_SHA256, NativeGeometry, PREFIX, mat_view


class TensorView(ct.Structure):
    _fields_ = [("data", ct.c_void_p), ("dims", ct.c_int * 4), ("raw", ct.c_int * 2)]


def pointer(*, address):
    value = ct.c_void_p.from_address(address).value
    if not value:
        raise ValueError("native detector object is missing")
    return value


def vector(*, address, width, maximum):
    begin, end, capacity = (ct.c_void_p * 3).from_address(address)
    if not begin or not end or not capacity or not begin <= end <= capacity or (end - begin) % width:
        raise ValueError("invalid native vector descriptor")
    count = (end - begin) // width
    if not 1 <= count <= maximum:
        raise ValueError("native vector exceeds probe limits")
    return begin, count


class NativeDetector:
    def __init__(self, *, binary, model=MODEL):
        self.geometry = NativeGeometry()
        self.library = self.geometry.library
        self.handle = ct.c_void_p()
        model = Path(model).resolve()
        with model.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != MODEL_SHA256:
                raise ValueError("unsupported detector model")
        binary = private_path(path=binary)
        if binary.exists():
            raise ValueError("refusing to overwrite a prior detector bridge")
        binary.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["xcrun", "clang++", "-std=c++17", "-O1", "-dynamiclib",
                        str(Path(__file__).with_name("face_detector_bridge.mm")), "-o", str(binary)],
                       check=True, timeout=120)
        self.bridge = ct.CDLL(str(binary))
        self.release = self.library.FsNew_ReleaseHandle
        self.release.argtypes, self.release.restype = [ct.c_void_p], None
        create = self.library.FsNew_CreateHandler
        create.argtypes, create.restype = [ct.c_uint64, ct.c_char_p, ct.POINTER(ct.c_void_p)], ct.c_int
        try:
            status = create(0, str(model).encode(), ct.byref(self.handle))
            if status or not self.handle.value:
                raise ValueError(f"detector initialization failed: {status}")
            self.detector = pointer(address=self.handle.value + 0x7830)
            self.layer = pointer(address=self.detector + 0xf8)
            self.profile = self.read_profile()
            self.decode_function = getattr(self.library, PREFIX + "6module5fsnew32MultiScaleProposalLayerMmdetFace28GetProposalsFaceMmdetNanoDetERNSt3__16vectorIPNS_13private_utils7predict11ModelOutputENS3_9allocatorIS8_EEEESC_ii")
            self.detect_function = getattr(self.library, PREFIX + "6module5fsnew17FaceDetectorModel10DetectFaceEN9mobilecv23MatERNSt3__16vectorINS3_5Rect_IfEENS5_9allocatorIS8_EEEERNS6_IiNS9_IiEEEERNS6_IfNS9_IfEEEE")
            self.extract_function = getattr(self.library, PREFIX + "13private_utils7predict9Predictor12GetRawOutputERKNSt3__112basic_stringIcNS3_11char_traitsIcEENS3_9allocatorIcEEEE")
            self.nms_function = getattr(self.library, PREFIX + "13private_utils3ssd12DetectHelper3NMSERNSt3__16vectorINS1_3BoxENS3_9allocatorIS5_EEEEiif")
            self.bridge.qcut_detector_decode.argtypes = [ct.c_void_p] * 4 + [ct.c_int] * 2 + [ct.c_void_p, ct.c_int]
            self.bridge.qcut_detector_detect.argtypes = [ct.c_void_p] * 5 + [ct.c_int]
            self.bridge.qcut_detector_heads.argtypes = [ct.c_void_p] * 3
            self.bridge.qcut_detector_nms.argtypes = [ct.c_void_p] * 2 + [ct.c_int] * 3 + [ct.c_float, ct.c_void_p]
        except BaseException:
            self.close()
            raise

    def read_profile(self):
        names = ct.create_string_buffer(2048)
        function = self.bridge.qcut_detector_names
        function.argtypes = [ct.c_void_p, ct.c_void_p, ct.c_int]
        if function(self.detector, names, len(names)):
            raise ValueError("invalid detector name vectors")
        records = names.value.decode().splitlines()
        if len(records) != 7 or records[-1].lower() != "nanodet":
            raise ValueError("this probe supports only the initialized NanoDet profile")
        before, after = (ct.c_int * 2).from_address(self.layer + 0x58)
        iou, confidence = (ct.c_float * 2).from_address(self.layer + 0x60)
        bits = ct.c_int.from_address(self.layer + 0x68).value
        vectors = []
        for offset in (0x28, 0x40):
            begin, count = vector(address=self.layer + offset, width=4, maximum=3)
            if count != 3:
                raise ValueError("three detection scales required")
            vectors.append(list((ct.c_int * count).from_address(begin)))
        proposal = pointer(address=self.layer + 8)
        begin, count = vector(address=proposal, width=24, maximum=3)
        anchors = []
        for index in range(count):
            data, length = vector(address=begin + 24 * index, width=20, maximum=1)
            anchors.append(list((ct.c_float * (length * 5)).from_address(data))[:4])
        if (count != 3 or bits != 8 or before != 1500 or after != 200
                or vectors != [[4, 8, 16], [8, 16, 32]]
                or not np.array_equal(anchors, [[-4, -4, 3, 3], [-8, -8, 7, 7], [-16, -16, 15, 15]])
                or not np.isclose(iou, .3) or not np.isclose(confidence, .225)):
            raise ValueError("initialized model is outside the bounded detector profile")
        return {"type": records[-1], "regression_names": records[:3], "score_names": records[3:6],
                "bits": bits, "before": before, "after": after, "iou": iou,
                "confidence": confidence, "minimum_sizes": vectors[0], "strides": vectors[1]}

    def close(self):
        if self.handle.value:
            self.release(self.handle)
            self.handle = ct.c_void_p()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def require_open(self):
        if not self.handle.value:
            raise ValueError("native detector oracle is closed")

    def decode(self, *, heads, image_size):
        from face_detector import validate_heads

        self.require_open()
        validate_heads(heads=heads, image_size=image_size, strides=self.profile["strides"])
        if any(value.dtype != np.int8 for value, _ in heads):
            raise ValueError("native initialized profile requires int8 heads")
        descriptors = (TensorView * 6)()
        buffers = []
        for index, (value, fraction) in enumerate(heads):
            array = np.ascontiguousarray(value)
            buffers.append(array)
            descriptors[index] = TensorView(array.ctypes.data, (ct.c_int * 4)(1, *array.shape),
                                           (ct.c_int * 2)(1, fraction))
        output = np.empty((200, 5), dtype=np.float32)
        count = self.bridge.qcut_detector_decode(self.decode_function, self.layer, descriptors,
                                                 ct.byref(descriptors, 3 * ct.sizeof(TensorView)),
                                                 *image_size, output.ctypes.data, 200)
        if not 0 <= count <= 200:
            raise ValueError(f"native proposal decoding failed: {count}")
        return output[:count].copy()

    def detect(self, *, frame):
        self.require_open()
        image = np.asarray(frame)
        if (image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3
                or not all(32 <= size <= 4096 for size in image.shape[:2])):
            raise ValueError("native detector requires a bounded RGB uint8 frame")
        source = mat_view(array=np.ascontiguousarray(image))
        boxes, scores = np.empty((200, 4), dtype=np.float32), np.empty(200, dtype=np.float32)
        count = self.bridge.qcut_detector_detect(self.detect_function, self.detector, ct.byref(source),
                                                 boxes.ctypes.data, scores.ctypes.data, 200)
        if not 0 <= count <= 200:
            raise ValueError(f"native image detection failed: {count}")
        descriptors = (TensorView * 6)()
        if self.bridge.qcut_detector_heads(self.extract_function, self.detector, descriptors):
            raise ValueError("native detection heads unavailable")
        heads = []
        for view in descriptors:
            dimensions = tuple(view.dims)
            if (dimensions[0] != 1 or not all(1 <= size <= 512 for size in dimensions[1:])
                    or view.raw[0] != 1 or not -16 <= view.raw[1] <= 24 or not view.data):
                raise ValueError("unsupported live detector tensor")
            size = int(np.prod(dimensions))
            heads.append((np.frombuffer(ct.string_at(view.data, size), dtype=np.int8)
                          .reshape(dimensions[1:]).copy(), view.raw[1]))
        width, height = (ct.c_int * 2).from_address(self.detector + 0x24)
        scales = tuple((ct.c_float * 2).from_address(self.detector + 0x34))
        return boxes[:count].copy(), scores[:count].copy(), heads, (width, height), scales

    def nms(self, *, boxes, before, after, threshold):
        from face_detector import validate_nms

        self.require_open()
        values = validate_nms(boxes=boxes, before=before, after=after, threshold=threshold)
        values = np.ascontiguousarray(values)
        output = np.empty_like(values)
        count = self.bridge.qcut_detector_nms(self.nms_function, values.ctypes.data, len(values),
                                              before, after, threshold, output.ctypes.data)
        if not 0 <= count <= len(values):
            raise ValueError("native NMS returned an invalid count")
        return output[:count].copy()
