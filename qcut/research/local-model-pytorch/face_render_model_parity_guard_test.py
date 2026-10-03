"""Torch-free dependency guards isolated from ambient test-suite imports."""

import importlib.machinery
import sys
import unittest
from unittest.mock import patch

import face_render_model_parity as probe


def torch_free_modules():
    return {name: module for name, module in sys.modules.copy().items()
            if name != "torch" and not name.startswith("torch.")}


class TorchTests(unittest.TestCase):
    def setUp(self):
        modules = patch.dict(sys.modules, torch_free_modules(), clear=True)
        modules.start()
        self.addCleanup(modules.stop)

    def test_installed_torch_is_rejected_without_importing_it(self):
        spec = importlib.machinery.ModuleSpec("torch", loader=None)
        with patch("importlib.util.find_spec", return_value=spec) as lookup:
            with self.assertRaisesRegex(ValueError, "Torch-free"):
                probe.no_torch()
            lookup.assert_called_once_with("torch")

    def test_imported_root_and_submodules_are_rejected_before_spec_lookup(self):
        for name in ("torch", "torch.example"):
            with self.subTest(name=name), patch.dict(sys.modules, {name: None}), \
                    patch("importlib.util.find_spec") as lookup:
                with self.assertRaisesRegex(ValueError, "Torch-free"):
                    probe.no_torch()
                lookup.assert_not_called()

    def test_unrelated_module_prefix_is_allowed(self):
        with patch.dict(sys.modules, {"torchlike": None}), patch("importlib.util.find_spec", return_value=None):
            probe.no_torch()


if __name__ == "__main__":
    unittest.main()
