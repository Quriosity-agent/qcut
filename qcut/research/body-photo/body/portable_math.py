"""Scoped system-math compatibility for the byte-pinned body engine on Windows/Linux."""
from contextlib import contextmanager
import ctypes
from pathlib import Path, PureWindowsPath
import sys
import threading


_LOCK = threading.RLock()
_ACTIVE = None
_FLOAT_UNARY = ("acosf", "atanf", "cosf", "sinf", "tanf", "expf")
_FUNCTIONS = {*_FLOAT_UNARY, "powf", "fmaf", "fma"}


def _windows_math_path():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True, winmode=0x00000800)
    get_directory = kernel.GetSystemDirectoryW
    get_directory.argtypes = [ctypes.POINTER(ctypes.c_wchar), ctypes.c_uint32]
    get_directory.restype = ctypes.c_uint32
    buffer = ctypes.create_unicode_buffer(32_768)
    length = int(get_directory(buffer, len(buffer)))
    if not 0 < length < len(buffer) or not PureWindowsPath(buffer.value).is_absolute():
        raise RuntimeError("Windows system directory unavailable for portable body math")
    return str(PureWindowsPath(buffer.value) / "ucrtbase.dll")


def _linux_math_path():
    paths = []
    with Path("/proc/self/maps").open("rb") as stream:
        payload = stream.read(16 * 1024**2 + 1)
    if len(payload) > 16 * 1024**2:
        raise ValueError("system library map exceeds the portable math limit")
    for line in payload.decode("utf-8", errors="strict").splitlines():
        columns = line.split(maxsplit=5)
        if len(columns) == 6 and columns[5].startswith("/"):
            candidate = Path(columns[5])
            if candidate.name == "libm.so.6" and not columns[5].endswith(" (deleted)"):
                paths.append(candidate)
    for prefix in ("/lib", "/lib64", "/usr/lib", "/usr/lib64"):
        paths.append(Path(prefix) / "libm.so.6")
        for architecture in ("x86_64-linux-gnu", "aarch64-linux-gnu"):
            paths.append(Path(prefix) / architecture / "libm.so.6")
    roots = tuple(Path(prefix).resolve() for prefix in ("/lib", "/lib64", "/usr/lib", "/usr/lib64"))
    for candidate in paths:
        resolved = candidate.resolve()
        if resolved.is_file() and any(resolved.is_relative_to(root) for root in roots):
            return str(resolved)
    raise RuntimeError("absolute system libm.so.6 unavailable for portable body math")


def _system_math(*, platform_name, cdll):
    if platform_name == "win32":
        library = cdll(_windows_math_path(), winmode=0x00000800)
    elif platform_name.startswith("linux"):
        library = cdll(_linux_math_path())
    else:
        raise ValueError("portable body math requires Windows or Linux")
    for name in _FUNCTIONS:
        try:
            function = getattr(library, name)
        except AttributeError as error:
            raise RuntimeError("system math function unavailable: " + name) from error
        kind = ctypes.c_double if name == "fma" else ctypes.c_float
        count = 3 if name in ("fma", "fmaf") else 2 if name == "powf" else 1
        function.argtypes = [kind] * count
        function.restype = kind
    return library


class _SinCosReturn:
    def __init__(self, *, library):
        self.library = library
        self.argtypes = [ctypes.c_float]
        self.restype = None

    def __call__(self, value):
        result_type = self.restype
        fields = getattr(result_type, "_fields_", ())
        if (self.argtypes != [ctypes.c_float] or not isinstance(result_type, type)
                or not issubclass(result_type, ctypes.Structure) or len(fields) != 2
                or any(len(field) != 2 or field[1] is not ctypes.c_float for field in fields)
                or ctypes.sizeof(result_type) != 8
                or getattr(result_type, fields[0][0]).offset != 0
                or getattr(result_type, fields[1][0]).offset != 4):
            raise ValueError("portable sincos requires a two-float sine/cosine return structure")
        argument = value.value if isinstance(value, ctypes.c_float) else float(value)
        argument = ctypes.c_float(argument).value
        return result_type(self.library.sinf(argument), self.library.cosf(argument))


class _ProcessMath:
    def __init__(self, *, library, cdll):
        self.library = library
        self.cdll = cdll
        self.process = None
        self.sincos = _SinCosReturn(library=library)

    def __getattr__(self, name):
        if name in _FUNCTIONS:
            return getattr(self.library, name)
        if name == "__sincosf_stret":
            return self.sincos
        if self.process is None:
            self.process = self.cdll(None)
        return getattr(self.process, name)


@contextmanager
def portable_math(*, platform_name=None):
    """Patch only this thread's plain CDLL(None); named libraries and Darwin stay unchanged."""
    global _ACTIVE
    selected = sys.platform if platform_name is None else platform_name
    with _LOCK:
        if _ACTIVE is not None:
            if _ACTIVE["platform"] != selected:
                raise ValueError("nested portable math cannot switch operating systems")
            yield
            return
        if selected == "darwin":
            yield
            return
        original = ctypes.CDLL
        library = _system_math(platform_name=selected, cdll=original)
        owner = threading.get_ident()

        def compatible_cdll(name, *arguments, **keywords):
            if name is None and not arguments and not keywords and threading.get_ident() == owner:
                return _ProcessMath(library=library, cdll=original)
            return original(name, *arguments, **keywords)

        _ACTIVE = {"platform": selected}
        ctypes.CDLL = compatible_cdll
        try:
            yield
        finally:
            ctypes.CDLL = original
            _ACTIVE = None
