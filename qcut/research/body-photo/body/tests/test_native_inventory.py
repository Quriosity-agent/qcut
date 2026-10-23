"""Loaded-library evidence must come from each OS, and private libraries fail closed."""
import ctypes
import sys
import types
import unittest
from unittest.mock import Mock, patch

from body import native_inventory


class NativeInventoryTests(unittest.TestCase):
    def test_linux_maps_keep_executable_paths_with_spaces_and_remove_duplicates(self):
        sample = "\n".join([
            "10-20 r-xp 0 08:01 42 /usr/lib/libpython.so",
            "20-30 r--p 0 08:01 42 /usr/lib/libpython.so",
            "30-40 r-xp 0 08:01 43 /path with spaces/libnumpy.so (deleted)",
            "40-50 r-xp 0 00:00 0 [vdso]",
            "50-60 rw-p 0 00:00 0 /data/model.onnx",
            "60-70 r-xp 0 08:01 42 /usr/lib/libpython.so",
        ])
        self.assertEqual(native_inventory.parse_linux_maps(content=sample),
                         ["/path with spaces/libnumpy.so", "/usr/lib/libpython.so"])

    def test_linux_maps_reject_empty_and_overlong_contents(self):
        for content in ("", "not a map", None):
            with self.assertRaises(ValueError):
                native_inventory.parse_linux_maps(content=content)
        with patch.object(native_inventory, "MAX_MAP_BYTES", 3):
            with self.assertRaises(ValueError):
                native_inventory.parse_linux_maps(content="long")

    def test_forbidden_native_names_and_paths_cover_windows_and_unix(self):
        bad = ["/app/libcccreator.dylib", "/app/LIBBYTENN.so", "/app/liblens.so",
               "/app/libAGFX.dylib", "/Applications/JianyingPro.app/Contents/a",
               "/app/runtime/Frameworks/vendor", r"C:\App\cccreator.dll", r"D:\APP\BYTENN.DLL",
               r"C:\App\lens.dll", r"C:\App\AGFX.dll"]
        clean = ["/usr/lib/libpython.so", r"C:\Python\onnxruntime.dll", "/tmp/lens.json"]
        self.assertEqual(native_inventory.private_native_images(images=bad + clean), sorted(bad))

    def test_private_inventory_fails_closed_by_default_but_can_report_for_diagnostics(self):
        with patch.object(sys, "platform", "linux"), \
                patch.object(native_inventory, "_linux_images", return_value=["/lib/libcccreator.so"]):
            with self.assertRaisesRegex(RuntimeError, "private native libraries"):
                native_inventory.get_native_inventory()
            report = native_inventory.get_native_inventory(reject_private=False)
            self.assertEqual(report["private_native_images"], ["/lib/libcccreator.so"])
            self.assertTrue(report["complete"])

    def test_os_dispatch_reports_real_provider_and_errors_do_not_become_empty_success(self):
        cases = [("linux", "_linux_images", "/proc/self/maps executable mappings"),
                 ("darwin", "_mac_images", "dyld-image-list"),
                 ("win32", "_windows_images", "EnumProcessModulesEx/GetModuleFileNameExW")]
        for system, function, expected in cases:
            with patch.object(sys, "platform", system), \
                    patch.object(native_inventory, function, return_value=["/safe/lib.so"]):
                result = native_inventory.get_native_inventory()
                self.assertEqual(result["method"], expected)
                self.assertEqual(result["platform"], system)
                self.assertEqual(result["loaded_images"], ["/safe/lib.so"])
            with patch.object(sys, "platform", system), \
                    patch.object(native_inventory, function, side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    native_inventory.get_native_inventory()
        with patch.object(sys, "platform", "unknown"):
            with self.assertRaises(ValueError):
                native_inventory.get_native_inventory()

    def windows_libraries(self, *, count=2, error=False, truncated=False):
        handles = [0x100000001 + index for index in range(count)]

        def enumerate_modules(process, modules, byte_count, needed, flags):
            self.assertEqual(process, 0x100000123)
            self.assertEqual(flags, 3)
            needed._obj.value = count * ctypes.sizeof(ctypes.c_void_p)
            for index in range(min(count, len(modules))):
                modules[index] = handles[index]
            return 0 if error else 1

        def module_name(process, module, output, size):
            self.assertGreater(module, 0xFFFFFFFF)
            output.value = rf"C:\Python\module{handles.index(module)}.dll"
            return size if truncated else len(output.value)

        kernel = types.SimpleNamespace(GetCurrentProcess=Mock(return_value=0x100000123))
        psapi = types.SimpleNamespace(EnumProcessModulesEx=Mock(side_effect=enumerate_modules),
                                      GetModuleFileNameExW=Mock(side_effect=module_name))
        return kernel, psapi

    def test_windows_uses_pointer_sized_handles_and_reports_real_paths(self):
        kernel, psapi = self.windows_libraries()
        with patch.object(ctypes, "WinDLL", side_effect=[kernel, psapi], create=True):
            result = native_inventory._windows_images()
        self.assertEqual(result, [r"C:\Python\module0.dll", r"C:\Python\module1.dll"])
        self.assertIs(kernel.GetCurrentProcess.restype, ctypes.c_void_p)
        self.assertIs(psapi.EnumProcessModulesEx.argtypes[0], ctypes.c_void_p)
        self.assertIs(psapi.GetModuleFileNameExW.argtypes[1], ctypes.c_void_p)

    def test_windows_retries_with_required_capacity(self):
        kernel, psapi = self.windows_libraries(count=300)
        with patch.object(ctypes, "WinDLL", side_effect=[kernel, psapi], create=True):
            result = native_inventory._windows_images()
        self.assertEqual(len(result), 300)
        self.assertEqual(psapi.EnumProcessModulesEx.call_count, 2)

    def test_windows_rejects_failed_truncated_and_excessive_inventory(self):
        for settings in ({"error": True}, {"truncated": True}, {"count": 20_000}, {"count": 0}):
            kernel, psapi = self.windows_libraries(**settings)
            with patch.object(ctypes, "WinDLL", side_effect=[kernel, psapi], create=True):
                with self.assertRaises((ValueError, RuntimeError)):
                    native_inventory._windows_images()

    def test_mac_uses_dyld_and_rejects_missing_module_name(self):
        library = types.SimpleNamespace(_dyld_image_count=Mock(return_value=2),
                                         _dyld_get_image_name=Mock(side_effect=[b"/usr/lib/a", b"/usr/lib/b"]))
        with patch.object(ctypes, "CDLL", return_value=library):
            self.assertEqual(native_inventory._mac_images(), ["/usr/lib/a", "/usr/lib/b"])
        library._dyld_get_image_name = Mock(return_value=None)
        with patch.object(ctypes, "CDLL", return_value=library):
            with self.assertRaises(ValueError):
                native_inventory._mac_images()

    @unittest.skipUnless(sys.platform in ("darwin", "win32") or sys.platform.startswith("linux"),
                         "host does not support loaded-library inventory")
    def test_real_host_inventory_is_nonempty_and_has_no_private_vendor_libraries(self):
        report = native_inventory.get_native_inventory()
        self.assertGreater(len(report["loaded_images"]), 0)
        self.assertEqual(report["private_native_images"], [])
        self.assertEqual(report["platform"], sys.platform)
        self.assertTrue(report["complete"])


if __name__ == "__main__":
    unittest.main()
