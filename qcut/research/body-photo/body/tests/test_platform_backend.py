"""Platform defaults and explicit overrides are independent of installed assets."""
import unittest

from body.platform_backend import select_backend, backend_label


class PlatformBackendTests(unittest.TestCase):
    def test_defaults_preserve_macos_and_enable_portable_platforms(self):
        for platform, expected in (("darwin", "metal"), ("win32", "cpu"), ("linux", "cpu")):
            with self.subTest(platform=platform):
                self.assertEqual(select_backend(platform=platform), expected)
                self.assertEqual(select_backend(platform=platform, backend="cpu"), "cpu")
        self.assertEqual(backend_label(backend="metal"), "macOS-Metal")
        self.assertEqual(backend_label(backend="cpu"), "portable-CPU")

    def test_incompatible_or_misspelled_selection_never_silently_falls_back(self):
        for platform, backend in (("win32", "metal"), ("linux", "metal"), ("freebsd", "cpu"),
                                  ("darwin", "cuda"), ("darwin", ""), ("darwin", None)):
            with self.subTest(platform=platform, backend=backend), self.assertRaises(ValueError):
                select_backend(platform=platform, backend=backend)
