"""Pinned original Stage1 decoding and explicit detection/base branch controls.

The diagnostic config disables refinement, enhanced tracking and quality gates.
It is not the application's automatic routing or a replacement backend.
"""
import ctypes as ct
from numbers import Real
from pathlib import Path
import subprocess

import numpy as np

from espresso_oracle import private_path
from face_alignment_input_native import copy_tensor
from face_alignment_warp_native import loaded_bytenn
from face_detector_native import TensorView, pointer
from face_geometry_native import Mat, PREFIX, copy_mat, mat_view


LANDMARK = PREFIX + "6module5fsnew13BasePredictor"
PHASE = PREFIX + "6module5fsnew14FsNewAlignAlgo23doCnnAlignmentNewPhase2ERKN9mobilecv23MatES6_biRKNS1_14RunningConfigsERNS1_15RunningTimeInfoE"


def validate_control(*, pixels, size, optimized):
    values = np.asarray(pixels)
    if (type(size) is not int or size not in (120, 160) or type(optimized) is not bool
            or values.dtype != np.uint8 or values.shape != (size, size, 3)):
        raise ValueError("bounded 120/160 uint8 BGR Stage1 control required")
    return np.ascontiguousarray(values)


def read_pairs(*, value):
    points = copy_mat(value=value, dtype=np.float32, channels=1).T
    if points.shape != (106, 2) or not np.isfinite(points).all():
        raise ValueError("original Stage1 points are invalid")
    return np.ascontiguousarray(points)


class NativeAlignmentDecode:
    def __init__(self, *, native, output):
        native.detector.require_open()
        output = private_path(path=output)
        if output.exists():
            raise ValueError("use a fresh decode bridge directory")
        output.mkdir(parents=True)
        self.native, self.geometry = native, native.detector.geometry
        self.runtime = loaded_bytenn()
        base = ct.cast(native.library.FsNew_CreateHandler, ct.c_void_p).value - 0x2C4418
        container = pointer(address=native.alignment + 0x918)
        if (pointer(address=container + 0x10) != native.predictors[120]
                or pointer(address=container + 0x20) != native.predictors[160]
                or tuple((ct.c_int * 4).from_address(native.alignment + 0x954)) != (120, 120, 160, 160)
                or ct.c_double.from_address(base + 0x499040).value != 256):
            raise ValueError("unsupported original Stage1 branch layout")
        self.means = {}
        for name, offset in (("base", 0x5DCD38), ("tracking", 0x5DC9E8)):
            values = np.frombuffer(ct.string_at(base + offset, 212 * 4), dtype="<f4").reshape(106, 2).copy()
            if not np.isfinite(values).all() or not np.all((values > 0) & (values < 256)):
                raise ValueError("original mean face has not been initialized")
            self.means[name] = values
        self.order = np.frombuffer(ct.string_at(base + 0x5DC370, 106 * 4), dtype="<i4").copy()
        if not np.array_equal(np.sort(self.order), np.arange(106)):
            raise ValueError("initialized Stage1 order is not a permutation")
        binary = output / "decode-bridge.dylib"
        subprocess.run(["xcrun", "clang++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror",
                        "-dynamiclib", str(Path(__file__).with_name("face_alignment_decode_bridge.mm")),
                        "-o", str(binary)], check=True, timeout=120)
        self.bridge = ct.CDLL(str(binary))
        self.read_function = self.bridge.qcut_alignment_decode
        self.read_function.argtypes, self.read_function.restype = [ct.c_void_p] * 6, ct.c_int
        self.get = {False: getattr(native.library, LANDMARK + "11GetLandmarkEv"),
                    True: getattr(native.library, LANDMARK + "14GetLandmarkOptEv")}
        self.phase = getattr(native.library, PHASE)
        self.phase.argtypes = [ct.c_void_p] * 3 + [ct.c_bool, ct.c_int] + [ct.c_void_p] * 2
        self.phase.restype = ct.c_bool

    def read(self, *, size, optimized):
        self.native.detector.require_open()
        if type(size) is not int or size not in (120, 160) or type(optimized) is not bool:
            raise ValueError("unsupported Stage1 profile")
        inputs, raw = TensorView(), TensorView()
        decoded = np.empty((106, 2), np.float32)
        status = self.read_function(self.get[optimized], self.geometry.destroy_mat, self.native.predictors[size],
                                    ct.byref(inputs), ct.byref(raw), decoded.ctypes.data)
        if status:
            raise ValueError(f"original Stage1 decoding failed: {status}")
        input_values, input_format = copy_tensor(view=inputs)
        raw_values, raw_format = copy_tensor(view=raw)
        expected_format = (2, 6) if size == 120 else (1, 6)
        if (input_values.shape != (1, size, size, 3) or input_format != expected_format
                or raw_values.size != 212 or raw_format != (4, 0) or not np.isfinite(decoded).all()):
            raise ValueError("unsupported original Stage1 output descriptor")
        return input_values, raw_values.reshape(106, 2), decoded

    def run_phase(self, *, pixels, optimized, threshold=0.0):
        self.native.detector.require_open()
        values = np.asarray(pixels)
        size = values.shape[0] if values.ndim == 3 else 0
        values = validate_control(pixels=values, size=size, optimized=optimized)
        if (isinstance(threshold, bool) or not isinstance(threshold, Real)
                or not np.isfinite(threshold) or not 0 <= threshold <= 1):
            raise ValueError("bounded diagnostic quality threshold required")
        source = mat_view(array=values)
        config, timing = ct.create_string_buffer(32), ct.create_string_buffer(0x200)
        # Explicit base/detection controls, not the host's defaults or quality acceptance.
        config[0], config[3], config[11] = b"\x01", b"\x01", bytes([optimized])
        ct.c_float.from_buffer(timing, 0x100).value = threshold
        ct.c_int.from_buffer(timing, 0x108).value = 0
        ct.c_int.from_buffer(timing, 0x124).value = -1
        if size == 160:
            transform = self.native.alignment + 0xFE8
            endpoints = (ct.c_float * 4)(0, 0, size - 1, size - 1)
            self.geometry.set_anchors(transform, endpoints)
            self.geometry.compute_resize(transform, endpoints)
        if not self.phase(self.native.alignment, ct.byref(source), ct.byref(source), size == 160, 2, config, timing):
            raise ValueError("original controlled Stage1 phase rejected the input")
        phase_points = read_pairs(value=Mat.from_address(self.native.alignment + 0xAA8))
        inputs, raw, decoded = self.read(size=size, optimized=optimized)
        confidence = float(ct.c_float.from_buffer(timing, 0x28).value)
        if not np.isfinite(confidence):
            raise ValueError("original quality result is nonfinite")
        return inputs, raw, decoded, phase_points, confidence
