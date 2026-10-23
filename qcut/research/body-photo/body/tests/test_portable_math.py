"""System libm bridging preserves scoped loader behavior and pinned source compatibility."""
import ctypes
import math
from pathlib import Path
import subprocess
import sys
import threading
import types
import unittest
from unittest.mock import Mock, patch

from body.portable_math import (
    _ProcessMath, _SinCosReturn, _linux_math_path, _system_math, _windows_math_path, portable_math,
)


class SinCos(ctypes.Structure):
    _fields_ = [("s", ctypes.c_float), ("c", ctypes.c_float)]


class Pair(ctypes.Structure):
    _fields_ = [("x", ctypes.c_float), ("y", ctypes.c_float)]


def host_library():
    """A real host libm lets scope tests run without pretending to be another OS."""
    if sys.platform == "win32":
        return ctypes.CDLL(_windows_math_path(), winmode=0x00000800)
    if sys.platform.startswith("linux"):
        return ctypes.CDLL(_linux_math_path())
    return ctypes.CDLL(None)


class PortableMathTests(unittest.TestCase):
    def setUp(self):
        self.library = host_library()
        for name in ("sinf", "cosf"):
            function = getattr(self.library, name)
            function.argtypes = [ctypes.c_float]
            function.restype = ctypes.c_float

    def test_sincos_preserves_float_input_rounding_and_actual_return_layout(self):
        function = _SinCosReturn(library=self.library)
        for result_type in (SinCos, Pair):
            function.restype = result_type
            for value in (-math.pi, -.2, 0, .7, math.pi, ctypes.c_float(.2)):
                result = function(value)
                argument = value.value if isinstance(value, ctypes.c_float) else ctypes.c_float(value).value
                expected = result_type(self.library.sinf(argument), self.library.cosf(argument))
                self.assertEqual(bytes(result), bytes(expected))
                self.assertEqual(ctypes.sizeof(result), 8)

    def test_sincos_rejects_unexpected_return_abi(self):
        function = _SinCosReturn(library=self.library)
        for result_type in (None, float, ctypes.c_float, ctypes.Structure):
            function.restype = result_type
            with self.assertRaises(ValueError):
                function(.2)

    def test_each_process_proxy_has_independent_mutable_sincos_signature(self):
        first = _ProcessMath(library=self.library, cdll=ctypes.CDLL)
        second = _ProcessMath(library=self.library, cdll=ctypes.CDLL)
        a = getattr(first, "__sincosf_stret")
        b = getattr(second, "__sincosf_stret")
        a.restype, b.restype = SinCos, Pair
        self.assertIsInstance(a(.2), SinCos)
        self.assertIsInstance(b(.2), Pair)
        self.assertIs(getattr(first, "__sincosf_stret"), a)

    def test_scoped_loader_restores_after_success_and_exception(self):
        original = ctypes.CDLL
        with patch("body.portable_math._system_math", return_value=self.library):
            with portable_math(platform_name="linux"):
                self.assertIsNot(ctypes.CDLL, original)
                retained = ctypes.CDLL(None)
                with portable_math(platform_name="linux"):
                    self.assertAlmostEqual(retained.cosf(0), 1)
                self.assertIsNot(ctypes.CDLL, original)
            self.assertIs(ctypes.CDLL, original)
            self.assertAlmostEqual(retained.cosf(0), 1)
            with self.assertRaisesRegex(RuntimeError, "render failed"):
                with portable_math(platform_name="linux"):
                    raise RuntimeError("render failed")
            self.assertIs(ctypes.CDLL, original)

    def test_nested_context_cannot_switch_platform(self):
        with patch("body.portable_math._system_math", return_value=self.library):
            with portable_math(platform_name="linux"):
                with self.assertRaises(ValueError):
                    with portable_math(platform_name="win32"):
                        pass

    def test_darwin_is_a_noop_without_loading_any_bridge(self):
        original = ctypes.CDLL
        with patch("body.portable_math._system_math") as load:
            with portable_math(platform_name="darwin"):
                self.assertIs(ctypes.CDLL, original)
            load.assert_not_called()

    def test_explicit_libraries_arguments_and_other_threads_use_original_loader(self):
        original = Mock(return_value="original-handle")
        with patch("body.portable_math._system_math", return_value=self.library), \
                patch.object(ctypes, "CDLL", original):
            with portable_math(platform_name="linux"):
                self.assertIsInstance(ctypes.CDLL(None), _ProcessMath)
                self.assertEqual(ctypes.CDLL("/explicit/library", mode=0), "original-handle")
                self.assertEqual(ctypes.CDLL(None, use_errno=True), "original-handle")
                result = []
                worker = threading.Thread(target=lambda: result.append(ctypes.CDLL(None)))
                worker.start()
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
                self.assertEqual(result, ["original-handle"])
            self.assertIs(ctypes.CDLL, original)
        self.assertEqual(original.call_count, 3)

    def test_unknown_symbols_delegate_to_real_process_handle(self):
        process = types.SimpleNamespace(known="process-symbol")
        original = Mock(return_value=process)
        proxy = _ProcessMath(library=self.library, cdll=original)
        self.assertEqual(proxy.known, "process-symbol")
        original.assert_called_once_with(None)
        with self.assertRaises(AttributeError):
            _ = proxy.missing

    def test_windows_system_directory_uses_bounded_wide_api(self):
        def directory(buffer, size):
            buffer.value = r"C:\Windows\System32"
            return len(buffer.value)

        kernel = types.SimpleNamespace(GetSystemDirectoryW=Mock(side_effect=directory))
        with patch.object(ctypes, "WinDLL", return_value=kernel, create=True) as load:
            self.assertEqual(_windows_math_path(), r"C:\Windows\System32\ucrtbase.dll")
            self.assertEqual(load.call_args.kwargs["winmode"], 0x800)
        kernel.GetSystemDirectoryW = Mock(return_value=32768)
        with patch.object(ctypes, "WinDLL", return_value=kernel, create=True):
            with self.assertRaises(RuntimeError):
                _windows_math_path()

    def test_system_library_requires_every_math_symbol_and_exact_float_signatures(self):
        names = ("acosf", "atanf", "cosf", "sinf", "tanf", "expf", "powf", "fmaf", "fma")
        fake = types.SimpleNamespace(**{name: Mock() for name in names})
        loader = Mock(return_value=fake)
        with patch("body.portable_math._linux_math_path", return_value="/usr/lib/libm.so.6"):
            _system_math(platform_name="linux", cdll=loader)
        loader.assert_called_once_with("/usr/lib/libm.so.6")
        self.assertEqual(fake.fma.argtypes, [ctypes.c_double] * 3)
        self.assertEqual(fake.fmaf.argtypes, [ctypes.c_float] * 3)
        self.assertEqual(fake.powf.argtypes, [ctypes.c_float] * 2)
        with patch("body.portable_math._linux_math_path", return_value="/usr/lib/libm.so.6"):
            with self.assertRaises(RuntimeError):
                _system_math(platform_name="linux", cdll=Mock(return_value=object()))

    def test_real_host_imports_pinned_engine_and_runs_trigonometry_without_apple_only_symbols(self):
        root = Path(__file__).resolve().parents[2]
        code = """
import sys, ctypes
from pathlib import Path
from body.portable_math import portable_math
original = ctypes.CDLL
with portable_math():
    sys.path.insert(0, str(Path('body/engine/research').resolve()))
    import body_smart_render
    from body_neck_descriptor import neck_axis
    from body_ortho_shoulder_geometry import rotate
    from alignment_pose_heads import fused_multiply_add
    from alignment_transform import system_fma
    import numpy as np
    assert np.isfinite(neck_axis(np.float32(.2))).all()
    assert np.isfinite(rotate(np.array([1, 0], np.float32), np.float32(.4))).all()
    assert fused_multiply_add()(2, 3, 4) == 10
    assert system_fma()(2, 3, 4) == 10
assert ctypes.CDLL is original
"""
        # This import smoke needs the already-declared ONNX dependencies, but no model assets.
        completed = subprocess.run([sys.executable, "-B", "-c", code], cwd=root,
                                   capture_output=True, text=True, timeout=45)
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
