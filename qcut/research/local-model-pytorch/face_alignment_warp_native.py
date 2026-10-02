"""Bounded, hash-pinned calls to the original NewAlign and warp preprocessor.

Explicit points/matrices are probe controls, not automatic face alignment.
The initialized NativeAlignmentInput owner must outlive this object.
"""
import ctypes as ct
from pathlib import Path

import numpy as np

from espresso_oracle import sha256
from face_geometry_native import Mat, PREFIX, copy_mat, mat_view


TRANSFORM = PREFIX + "22ImageTransformNewAlign"
WARP_SYMBOL = PREFIX + "6module5fsnew12PreProcessor16ProcessWarpImageERKN9mobilecv23MatE15PixelFormatTypeRNS_22ImageTransformNewAlignEiib"
FORMATS = {"RGBA": (0, 4), "BGRA": (1, 4), "BGR": (2, 3), "RGB": (3, 3)}
BYTENN_SHA256 = "febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863"
TRACKING_ANCHORS = (55, 58, 84, 90)


def loaded_bytenn():
    process = ct.CDLL(None)
    count, name = process._dyld_image_count, process._dyld_get_image_name
    count.argtypes, count.restype = [], ct.c_uint32
    name.argtypes, name.restype = [ct.c_uint32], ct.c_char_p
    total = count()
    if not 1 <= total <= 8192:
        raise ValueError("unexpected loaded-image inventory")
    paths = []
    for index in range(total):
        raw = name(index)
        if raw:
            path = Path(raw.decode()).resolve()
            if path.name == "libbytenn.dylib":
                paths.append(path)
    if len(paths) != 1 or sha256(path=paths[0]) != BYTENN_SHA256:
        raise ValueError("unsupported or ambiguous loaded ByteNN runtime")
    return {"path": str(paths[0]), "sha256": BYTENN_SHA256}


class PointVector(ct.Structure):
    _fields_ = [("data", ct.c_void_p), ("capacity", ct.c_size_t),
                ("storage", ct.c_float * 264), ("count", ct.c_size_t)]


def validate_points(*, points):
    values = np.asarray(points, dtype=np.float32)
    if (values.ndim != 2 or values.shape[1] != 2 or not 2 <= len(values) <= 106
            or not np.isfinite(values).all() or np.max(np.abs(values)) > 32768):
        raise ValueError("2..106 bounded finite point pairs required")
    return np.ascontiguousarray(values)


def point_vector(*, points):
    values = validate_points(points=points)
    if ct.sizeof(PointVector) != 0x438 or PointVector.count.offset != 0x430:
        raise ValueError("unsupported inline point-vector ABI")
    result = PointVector()
    result.data, result.capacity, result.count = ct.addressof(result) + 16, 264, values.size
    ct.memmove(result.data, values.ctypes.data, values.nbytes)
    return result


def validate_tracking(*, points, threshold=0.1):
    values = validate_points(points=points)
    if values.shape != (106, 2):
        raise ValueError("tracking gate requires exactly 106 points")
    if (isinstance(threshold, (bool, np.bool_)) or not isinstance(threshold, (int, float, np.floating))
            or not np.isfinite(threshold) or not 0 <= threshold <= 1):
        raise ValueError("finite tracking threshold in [0, 1] required")
    return values, np.float32(threshold)


def validate_fit(*, source, mean):
    source, mean = validate_points(points=source), validate_points(points=mean)
    if source.shape != mean.shape:
        raise ValueError("source and mean point counts must match")
    centered = source.astype(np.float64) - source.mean(axis=0, dtype=np.float64)
    target = mean.astype(np.float64) - mean.mean(axis=0, dtype=np.float64)
    dot = np.sum(centered * target)
    cross = np.sum(centered[:, 0] * target[:, 1] - centered[:, 1] * target[:, 0])
    denominator = np.sum(centered * centered)
    if denominator < 1e-6 or np.hypot(dot, cross) < 1e-6:
        raise ValueError("degenerate similarity fit")
    scale = np.hypot(dot, cross) / denominator
    if not 1e-4 <= scale <= 100:
        raise ValueError("similarity scale exceeds probe limits")
    return source, mean


def validate_matrix(*, matrix):
    values = np.asarray(matrix, dtype=np.float32)
    if (values.shape != (2, 3) or not np.isfinite(values).all()
            or np.max(np.abs(values)) > 32768
            or abs(np.linalg.det(values[:, :2].astype(np.float64))) < 1e-8):
        raise ValueError("bounded nonsingular affine matrix required")
    return np.ascontiguousarray(values)


def validate_frame(*, frame, mode, size, fused):
    values = np.asarray(frame)
    if (not isinstance(mode, str) or mode not in FORMATS or type(fused) is not bool or not isinstance(size, tuple)
            or len(size) != 2 or not all(type(value) is int and 2 <= value <= 160 for value in size)
            or values.dtype != np.uint8 or values.ndim != 3
            or not all(1 <= value <= 4096 for value in values.shape[:2])):
        raise ValueError("invalid bounded native warp request")
    channels = values.shape[2] if values.ndim == 3 else 1
    if channels != FORMATS[mode][1] or values.nbytes > 64 * 1024 * 1024:
        raise ValueError("pixel format and channel count must match")
    return np.ascontiguousarray(values)


class NativeAlignmentWarp:
    def __init__(self, *, native):
        native.detector.require_open()
        self.native, self.geometry = native, native.detector.geometry
        self.runtime = loaded_bytenn()
        self.closed, self.ready = False, False
        bind = self.geometry.symbol
        self.construct = bind(name=TRANSFORM + "C1Ev", count=1)
        self.set_mean = bind(name=TRANSFORM + "11setMeanFaceI10AutoVectorIfLm264EEEEvRKT_", count=2)
        self.compute = bind(name=TRANSFORM + "16computeTransformI10AutoVectorIfLm264EEEEvRKT_", count=2)
        self.forward_ref = bind(name=TRANSFORM + "32getTranformMatrix2WarpedImageRefEv", count=1, result=ct.c_void_p)
        self.inverse_ref = bind(name=TRANSFORM + "34getTranformMatrix2OriginalImageRefEv", count=1, result=ct.c_void_p)
        self.set_forward = bind(name=TRANSFORM + "29setTranformMatrix2WarpedImageERKN9mobilecv23MatE", count=2)
        self.set_inverse = bind(name=TRANSFORM + "31setTranformMatrix2OriginalImageERKN9mobilecv23MatE", count=2)
        self.to_original = bind(name=TRANSFORM + "28tranformPoints2OriginalImageERKN9mobilecv23MatERS2_", count=3)
        self.to_warped = bind(name=TRANSFORM + "26tranformPoints2WarpedImageERKN9mobilecv23MatERS2_", count=3)
        self.warp_function = bind(name=TRANSFORM + "9warpImageERKN9mobilecv23MatERS2_RKNS1_5Size_IiEE", count=4)
        self.deallocate = bind(name="_ZN10AutoVectorIfLm264EE10deallocateEv", count=1)
        self.get_anchor = getattr(native.library, TRANSFORM + "14getAlignAnchorERK10AutoVectorIfLm264EERN9mobilecv23VecIfLi4EEEiiii")
        self.get_anchor.argtypes = [ct.c_void_p] * 3 + [ct.c_int] * 4
        self.get_anchor.restype = None
        self.check_transform = getattr(native.library, TRANSFORM + "18checkNeedTransformERK10AutoVectorIfLm264EEiiiif")
        self.check_transform.argtypes = [ct.c_void_p] * 2 + [ct.c_int] * 4 + [ct.c_float]
        self.check_transform.restype = ct.c_bool
        self.preprocess = getattr(native.library, WARP_SYMBOL)
        self.preprocess.argtypes = [ct.c_void_p, ct.c_void_p, ct.c_int, ct.c_void_p,
                                   ct.c_int, ct.c_int, ct.c_bool]
        self.preprocess.restype = ct.c_void_p
        self.transform = ct.create_string_buffer(0x938)
        self.construct(self.transform)
        try:
            for offset in (0xC0, 0x4F8):
                value = PointVector.from_address(ct.addressof(self.transform) + offset)
                if (value.data != ct.addressof(value) + 16 or not 0 <= value.count <= value.capacity <= 264):
                    raise ValueError("unexpected native NewAlign point-vector ownership")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.closed:
            return
        self.closed, self.ready = True, False
        for offset in (0, 96):
            self.geometry.destroy_mat(ct.addressof(self.transform) + offset)
        for offset in (0xC0, 0x4F8):
            self.deallocate(ct.addressof(self.transform) + offset)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def require_open(self, *, fitted=True):
        if self.closed or fitted and not self.ready:
            raise ValueError("native warp is closed or has no validated transform")
        self.native.detector.require_open()

    def matrices(self):
        self.require_open()
        result = []
        for function in (self.forward_ref, self.inverse_ref):
            address = function(self.transform)
            if not address:
                raise ValueError("native transform matrix is missing")
            result.append(validate_matrix(matrix=copy_mat(value=Mat.from_address(address), dtype=np.float32, channels=1)))
        return tuple(result)

    def anchors(self, *, points):
        self.require_open(fitted=False)
        values, _ = validate_tracking(points=points)
        vector, result = point_vector(points=values), (ct.c_float * 4)()
        self.get_anchor(self.transform, ct.byref(vector), result, *TRACKING_ANCHORS)
        anchors = np.ctypeslib.as_array(result).reshape(2, 2).copy()
        if not np.isfinite(anchors).all():
            raise ValueError("native tracking anchors are not finite")
        return anchors

    def needs_update(self, *, points, threshold=0.1):
        self.require_open(fitted=False)
        values, threshold = validate_tracking(points=points, threshold=threshold)
        vector = point_vector(points=values)
        return bool(self.check_transform(self.transform, ct.byref(vector), *TRACKING_ANCHORS, threshold))

    def cached_points(self):
        self.require_open()
        value = PointVector.from_address(ct.addressof(self.transform) + 0x4F8)
        if (value.data != ct.addressof(value) + 16 or not 212 <= value.capacity <= 264 or value.count != 212
                or ct.c_bool.from_address(ct.addressof(self.transform) + 0x930).value is not True):
            raise ValueError("validated 106-point fitted cache required")
        return validate_points(points=np.ctypeslib.as_array(value.storage)[:212].reshape(106, 2)).copy()

    def fit(self, *, source, mean):
        self.require_open(fitted=False)
        source, mean = validate_fit(source=source, mean=mean)
        source_vector, mean_vector = point_vector(points=source), point_vector(points=mean)
        self.ready = False
        self.set_mean(self.transform, ct.byref(mean_vector))
        self.compute(self.transform, ct.byref(source_vector))
        self.ready = True
        try:
            return self.matrices()
        except BaseException:
            self.ready = False
            raise

    def set_matrix(self, *, matrix):
        self.require_open(fitted=False)
        forward = validate_matrix(matrix=matrix)
        inverse = np.linalg.inv(np.vstack((forward, [0, 0, 1])))[:2].astype(np.float32)
        inverse = validate_matrix(matrix=inverse)
        source, target = mat_view(array=forward), mat_view(array=inverse)
        self.ready = False
        self.set_forward(self.transform, ct.byref(source))
        self.set_inverse(self.transform, ct.byref(target))
        self.ready = True

    def points(self, *, points, original=False):
        self.require_open()
        if type(original) is not bool:
            raise ValueError("point mapping direction must be boolean")
        values = validate_points(points=points)
        source, target = mat_view(array=np.ascontiguousarray(values.T)), mat_view()
        try:
            function = self.to_original if original else self.to_warped
            function(self.transform, ct.byref(source), ct.byref(target))
            mapped = copy_mat(value=target, dtype=np.float32, channels=1).T
            if mapped.shape != values.shape or not np.isfinite(mapped).all():
                raise ValueError("native point mapping returned invalid output")
            return mapped.copy()
        finally:
            self.geometry.destroy_mat(ct.byref(target))

    def warp_raw(self, *, frame, mode, size):
        self.require_open()
        values = validate_frame(frame=frame, mode=mode, size=size, fused=False)
        source, target = mat_view(array=values), mat_view()
        native_size = (ct.c_int * 2)(*size)
        try:
            self.warp_function(self.transform, ct.byref(source), ct.byref(target), native_size)
            pixels = copy_mat(value=target, dtype=np.uint8, channels=FORMATS[mode][1])
            if pixels.shape[:2] != (size[1], size[0]):
                raise ValueError("native warp returned incorrect dimensions")
            return pixels
        finally:
            self.geometry.destroy_mat(ct.byref(target))

    def prepare(self, *, frame, mode, size, fused=False):
        self.require_open()
        values = validate_frame(frame=frame, mode=mode, size=size, fused=fused)
        source = mat_view(array=values)
        address = self.preprocess(self.native.alignment + 0x7800, ct.byref(source), FORMATS[mode][0],
                                  self.transform, *size, fused)
        if address != self.native.alignment + 0x7880:
            raise ValueError("unexpected original warp preprocessor ownership")
        pixels = copy_mat(value=Mat.from_address(address), dtype=np.uint8, channels=3)
        if pixels.shape != (size[1], size[0], 3):
            raise ValueError("original warp preprocessor returned incorrect dimensions")
        return pixels
