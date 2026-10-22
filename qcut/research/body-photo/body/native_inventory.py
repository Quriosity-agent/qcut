"""Inspect actual loaded libraries before publishing a portable body render."""
import ctypes
from pathlib import Path
import platform
import sys


MAX_MODULES = 16_384
MAX_MAP_BYTES = 16 * 1024**2
FORBIDDEN_TOKENS = ("libcccreator", "libbytenn", "liblens", "libagfx",
                    "jianyingpro.app", "/runtime/frameworks/")
FORBIDDEN_DLLS = {"cccreator.dll", "bytenn.dll", "lens.dll", "agfx.dll"}


def parse_linux_maps(*, content):
    if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_MAP_BYTES:
        raise ValueError("loaded-library map exceeds the inventory limit")
    paths = set()
    for line in content.splitlines():
        columns = line.split(maxsplit=5)
        if len(columns) != 6 or not columns[5].startswith("/"):
            continue
        if "x" not in columns[1]:
            continue
        path = columns[5].removesuffix(" (deleted)")
        # procfs escapes newlines in pathnames as octal; spaces remain literal.
        paths.add(path.replace("\\012", "\n"))
    if not paths or len(paths) > MAX_MODULES:
        raise ValueError("empty or excessive loaded-library map")
    return sorted(paths)


def _linux_images():
    with Path("/proc/self/maps").open("rb") as stream:
        payload = stream.read(MAX_MAP_BYTES + 1)
    if len(payload) > MAX_MAP_BYTES:
        raise ValueError("loaded-library map exceeds the inventory limit")
    return parse_linux_maps(content=payload.decode("utf-8", errors="strict"))


def _mac_images():
    library = ctypes.CDLL(None)
    count_function = library._dyld_image_count
    count_function.argtypes = []
    count_function.restype = ctypes.c_uint32
    name_function = library._dyld_get_image_name
    name_function.argtypes = [ctypes.c_uint32]
    name_function.restype = ctypes.c_char_p
    count = int(count_function())
    if not 0 < count <= MAX_MODULES:
        raise ValueError("empty or excessive dyld loaded-library inventory")
    names = []
    for index in range(count):
        name = name_function(index)
        if not name:
            raise ValueError("dyld returned an incomplete loaded-library inventory")
        names.append(name.decode("utf-8", errors="strict"))
    return sorted(set(names))


def _windows_images():
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    dword, handle = ctypes.c_uint32, ctypes.c_void_p
    current_process = kernel.GetCurrentProcess
    current_process.argtypes = []
    current_process.restype = handle
    enumerate_modules = psapi.EnumProcessModulesEx
    enumerate_modules.argtypes = [handle, ctypes.POINTER(handle), dword, ctypes.POINTER(dword), dword]
    enumerate_modules.restype = ctypes.c_int32
    module_name = psapi.GetModuleFileNameExW
    module_name.argtypes = [handle, handle, ctypes.POINTER(ctypes.c_wchar), dword]
    module_name.restype = dword
    process = current_process()
    if not process:
        raise RuntimeError("GetCurrentProcess failed during library inventory")
    capacity = 256
    modules = None
    count = 0
    for _ in range(4):
        modules = (handle * capacity)()
        needed = dword()
        if not enumerate_modules(process, modules, ctypes.sizeof(modules), ctypes.byref(needed), 3):
            raise RuntimeError("EnumProcessModulesEx failed during library inventory")
        if needed.value % ctypes.sizeof(handle):
            raise ValueError("Windows returned an invalid loaded-module byte count")
        count = needed.value // ctypes.sizeof(handle)
        if not 0 < count <= MAX_MODULES:
            raise ValueError("empty or excessive Windows loaded-library inventory")
        if count <= capacity:
            break
        capacity = count
    if count > capacity or modules is None or count > len(modules):
        raise RuntimeError("Windows loaded-module list kept changing during inventory")
    names = []
    for index in range(count):
        buffer = ctypes.create_unicode_buffer(32_768)
        length = int(module_name(process, modules[index], buffer, len(buffer)))
        if not 0 < length < len(buffer):
            raise RuntimeError("GetModuleFileNameExW returned a missing or truncated module path")
        names.append(buffer.value)
    return sorted(set(names))


def private_native_images(*, images):
    matches = []
    for image in images:
        normalized = image.replace("\\", "/").lower()
        if (any(token in normalized for token in FORBIDDEN_TOKENS)
                or normalized.rsplit("/", 1)[-1] in FORBIDDEN_DLLS):
            matches.append(image)
    return sorted(set(matches))


def get_native_inventory(*, reject_private=True):
    if sys.platform == "darwin":
        images, method = _mac_images(), "dyld-image-list"
    elif sys.platform == "win32":
        images, method = _windows_images(), "EnumProcessModulesEx/GetModuleFileNameExW"
    elif sys.platform.startswith("linux"):
        images, method = _linux_images(), "/proc/self/maps executable mappings"
    else:
        raise ValueError("loaded-library inventory is unsupported on this operating system")
    private = private_native_images(images=images)
    if reject_private and private:
        raise RuntimeError("private native libraries loaded: " + ", ".join(private))
    return {"platform": sys.platform, "machine": platform.machine(), "method": method,
            "loaded_images": images, "private_native_images": private, "complete": True}
