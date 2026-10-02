"""Private, version-pinned macOS crop and coordinate-mapping oracle.

No native code is patched. The Mat ABI and cleanup thunk are valid only for
the pinned library; this is a bounded research probe, not a product backend.
"""
import ctypes as ct
import hashlib
from pathlib import Path
import platform
import subprocess
import sys

import numpy as np


LIBRARY = Path.home() / "Library/Application Support/QCut/PrivateRuntimes/JianyingFilter/current/Frameworks/liblens.dylib"
LIBRARY_SHA256 = "fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161"
MODEL = LIBRARY.parent.parent / "Models/tt_fsnew_base_jianying_v2.0_size21_md5e5e7e6ff5f1ce484e0defa505715053f.model"
MODEL_SHA256 = "89e4cf058aa4ec0eceda3ecffe6b5b599b718f58aaadac5e03e5c2c1b2d66227"
PREFIX = "_ZN5smash"
CROP_SYMBOL = PREFIX + "6module5fsnew10FsNewUtils16CropObjectRegionERKN9mobilecv23MatERNS3_5Rect_IfEERS4_RNS1_12MemAllocatorEbfb"


class Mat(ct.Structure):
    _fields_ = [
        ("flags", ct.c_int), ("dims", ct.c_int), ("rows", ct.c_int), ("cols", ct.c_int),
        ("data", ct.c_void_p), ("start", ct.c_void_p), ("end", ct.c_void_p), ("limit", ct.c_void_p),
        ("allocator", ct.c_void_p), ("owner", ct.c_void_p), ("size", ct.c_void_p),
        ("step", ct.c_void_p), ("steps", ct.c_size_t * 2),
    ]


def mat_view(*, array=None):
    value = Mat()
    value.flags = 0x42FF0000
    value.size = ct.addressof(value) + Mat.rows.offset
    value.step = ct.addressof(value) + Mat.steps.offset
    if array is not None:
        if not array.flags.c_contiguous or array.ndim not in (2, 3):
            raise ValueError("native Mat view requires a packed two-dimensional array")
        if array.dtype not in (np.dtype("uint8"), np.dtype("float32")):
            raise ValueError("native Mat view requires uint8 or float32")
        channels = array.shape[2] if array.ndim == 3 else 1
        value.flags |= 0x4000 | (channels - 1) << 3 | (5 if array.dtype == np.float32 else 0)
        value.dims = 2
        value.rows, value.cols = array.shape[:2]
        value.data = array.ctypes.data
        value.start, value.end = value.data, value.data + array.nbytes
        value.limit = value.end
        value.steps[:] = [array.strides[0], array.dtype.itemsize * channels]
        # Mat borrows its pixels; retain even a temporary NumPy buffer until the call ends.
        value._buffer_reference = array
    return value


def copy_mat(*, value, dtype, channels):
    array_type = np.dtype(dtype)
    depth = 5 if array_type == np.float32 else 0
    if (value.dims != 2 or value.flags & 0xFFF != depth | (channels - 1) << 3
            or not 0 < value.rows <= 32768 or not 0 < value.cols <= 32768 or not value.data):
        raise ValueError("native Mat returned an unsupported descriptor")
    row_bytes = value.cols * channels * array_type.itemsize
    if row_bytes * value.rows > 128 * 1024 * 1024 or value.steps[0] < row_bytes:
        raise ValueError("native Mat exceeds probe limits or has invalid strides")
    rows = [ct.string_at(value.data + row * value.steps[0], row_bytes) for row in range(value.rows)]
    shape = (value.rows, value.cols, channels) if channels != 1 else (value.rows, value.cols)
    return np.frombuffer(b"".join(rows), dtype=array_type).reshape(shape).copy()


class NativeGeometry:
    def __init__(self, *, library=LIBRARY):
        if sys.platform != "darwin" or platform.machine() != "arm64":
            raise ValueError("native geometry oracle requires macOS arm64")
        library = Path(library).resolve()
        with library.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != LIBRARY_SHA256:
            raise ValueError("unsupported native geometry runtime")
        if ct.sizeof(Mat) != 96 or Mat.data.offset != 16 or Mat.steps.offset != 80:
            raise ValueError("unsupported native Mat ABI")
        self.library = ct.CDLL(str(library))
        self.crop_function = self.symbol(name=CROP_SYMBOL, count=7, float_index=5, bool_indices=(4, 6))
        self.release_allocator = self.symbol(name=PREFIX + "6module5fsnew12MemAllocator7ReleaseEb", count=2, bool_indices=(1,))
        self.construct_transform = self.symbol(name=PREFIX + "14ImageTransformC1Ev", count=1)
        self.set_anchors = self.symbol(name=PREFIX + "14ImageTransform19setCanonicalAnchorsERKN9mobilecv23VecIfLi4EEE", count=2)
        self.compute_resize = self.symbol(name=PREFIX + "14ImageTransform25computeTransformForResizeERKN9mobilecv23VecIfLi4EEE", count=2)
        self.transform_points = self.symbol(name=PREFIX + "14ImageTransform28tranformPoints2OriginalImageERKN9mobilecv23MatERS2_", count=3)
        self.inverse_ref = self.symbol(name=PREFIX + "14ImageTransform34getTranformMatrix2OriginalImageRefEv", count=1, result=ct.c_void_p)
        anchor = ct.cast(self.library.FsNew_CreateHandler, ct.c_void_p).value
        # LC_FUNCTION_STARTS bounds this one-instruction Mat destructor thunk.
        address = anchor - 0x2C4418 + 0x21E9EC
        if ct.string_at(address, 4) != bytes.fromhex("120b0014"):
            raise ValueError("native cleanup thunk identity mismatch")
        self.destroy_mat = ct.CFUNCTYPE(None, ct.c_void_p)(address)

    def symbol(self, *, name, count, float_index=None, bool_indices=(), result=None):
        function = getattr(self.library, name)
        function.argtypes = [ct.c_float if index == float_index else ct.c_bool
                             if index in bool_indices else ct.c_void_p for index in range(count)]
        function.restype = result
        return function

    def crop(self, *, frame, rect, expansion, legacy_anchor=False):
        from face_geometry import crop_region

        image = np.asarray(frame)
        box = np.asarray(rect, dtype=np.float32)
        if (image.ndim != 3 or image.dtype != np.uint8 or image.shape[2] != 3
                or not all(1 <= v <= 32768 for v in image.shape[:2]) or box.shape != (4,)
                or not np.isfinite(box).all() or (box[2:] < 1).any()
                or not np.isfinite(expansion) or expansion <= 0):
            raise ValueError("invalid native crop request")
        side = float(max(box[2:]) * np.float32(expansion))
        if (not 1 <= side <= 4096 or (box[:2] < -4096).any() or (box[:2] > 32768).any()
                or box[0] >= image.shape[1] or box[1] >= image.shape[0]
                or box[0] + box[2] <= 0 or box[1] + box[3] <= 0):
            raise ValueError("native crop exceeds bounded probe scope")
        crop_region(rect=box, frame_size=(image.shape[1], image.shape[0]),
                    expansion=expansion, legacy_anchor=legacy_anchor)
        image = np.ascontiguousarray(image)
        source, output = mat_view(array=image), mat_view()
        allocator = ct.create_string_buffer(32)
        native_box = (ct.c_float * 4)(*box)
        try:
            self.crop_function(ct.byref(source), native_box, ct.byref(output), allocator,
                               legacy_anchor, expansion, False)
            pixels = copy_mat(value=output, dtype=np.uint8, channels=3)
            return tuple(native_box), pixels
        finally:
            self.destroy_mat(ct.byref(output))
            self.release_allocator(allocator, False)

    def resize_mapping(self, *, rect, network_size, points):
        box = np.asarray(rect, dtype=np.float32)
        width, height = network_size
        values = np.asarray(points, dtype=np.float32)
        if (box.shape != (4,) or not np.isfinite(box).all() or (box[2:] < 2).any()
                or not all(isinstance(v, int) and 2 <= v <= 32768 for v in network_size)
                or values.ndim != 2 or values.shape[1] != 2 or not 1 <= values.shape[0] <= 512
                or not np.isfinite(values).all()):
            raise ValueError("invalid native coordinate request")
        transform = ct.create_string_buffer(1024)
        self.construct_transform(transform)
        source = mat_view(array=np.ascontiguousarray(values.T))
        result = mat_view()
        try:
            canonical = (ct.c_float * 4)(0, 0, width - 1, height - 1)
            endpoints = (ct.c_float * 4)(box[0], box[1], box[0] + box[2] - 1, box[1] + box[3] - 1)
            self.set_anchors(transform, canonical)
            self.compute_resize(transform, endpoints)
            pointer = self.inverse_ref(transform)
            if not pointer:
                raise ValueError("native inverse matrix is missing")
            matrix = copy_mat(value=Mat.from_address(pointer), dtype=np.float32, channels=1)
            self.transform_points(transform, ct.byref(source), ct.byref(result))
            mapped = copy_mat(value=result, dtype=np.float32, channels=1).T
            if matrix.shape != (2, 3) or mapped.shape != values.shape:
                raise ValueError("native mapping returned incorrect shapes")
            return matrix, mapped
        finally:
            self.destroy_mat(ct.byref(result))
            for offset in range(0, 0x1E0, ct.sizeof(Mat)):
                self.destroy_mat(ct.addressof(transform) + offset)

    def landmark_order(self, *, model=MODEL):
        model = Path(model).resolve()
        with model.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != MODEL_SHA256:
                raise ValueError("unsupported landmark initialization model")
        create = self.library.FsNew_CreateHandler
        create.argtypes, create.restype = [ct.c_uint64, ct.c_char_p, ct.POINTER(ct.c_void_p)], ct.c_int
        release = self.library.FsNew_ReleaseHandle
        release.argtypes, release.restype = [ct.c_void_p], None
        handle = ct.c_void_p()
        try:
            status = create(0, str(model).encode(), ct.byref(handle))
            if status != 0 or not handle.value:
                raise ValueError(f"native landmark initialization failed: {status}")
            base = ct.cast(create, ct.c_void_p).value - 0x2C4418
            order = np.frombuffer(ct.string_at(base + 0x5DC370, 106 * 4), dtype="<i4").copy()
            if not np.array_equal(np.sort(order), np.arange(106)):
                raise ValueError("initialized landmark table is not a 106-point permutation")
            self.order_ready = True
            return order
        finally:
            if handle.value:
                release(handle)

    def build_reorder_probe(self, *, binary):
        from espresso_oracle import private_path

        binary = private_path(path=binary)
        if binary.exists():
            raise ValueError("refusing to overwrite a prior landmark probe")
        binary.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["xcrun", "clang++", "-std=c++17", "-O1", "-dynamiclib",
                        str(Path(__file__).with_name("face_geometry_landmark.mm")), "-o", str(binary)],
                       check=True, timeout=120)
        self.reorder_library = ct.CDLL(str(binary))
        self.reorder_function = self.reorder_library.qcut_geometry_reorder
        self.reorder_function.argtypes, self.reorder_function.restype = [ct.c_void_p] * 4, ct.c_int

    def reorder(self, *, raw_pairs, optimized=False):
        values = np.ascontiguousarray(raw_pairs, dtype=np.float32)
        if (not getattr(self, "order_ready", False) or not hasattr(self, "reorder_function")
                or values.shape != (106, 2) or not np.isfinite(values).all()):
            raise ValueError("initialized order, compiled probe and 106 finite pairs required")
        name = "GetLandmarkOpt" if optimized else "GetLandmark"
        function = getattr(self.library, PREFIX + f"6module5fsnew13BasePredictor{len(name)}{name}Ev")
        output = np.full_like(values, np.nan)
        status = self.reorder_function(ct.cast(function, ct.c_void_p), self.destroy_mat,
                                       values.ctypes.data, output.ctypes.data)
        if status or not np.isfinite(output).all():
            raise ValueError(f"native landmark reorder failed: {status}")
        return output
