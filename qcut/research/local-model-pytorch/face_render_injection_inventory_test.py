"""Static instruction classification and fail-closed inventory guards."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from face_render_injection_inventory import branch_target, command, constant_return, run


class InjectionInventoryTest(unittest.TestCase):
    def test_only_single_unconditional_branch_is_followed(self):
        text = "symbol:\n 16298a0:\t1e 68 f3 17\tb\t0x1303918\n"
        self.assertEqual(branch_target(text=text), 0x1303918)
        for candidate in ("", text.replace("\tb\t", "\tbl\t"), text + " 16298a4: c0 03 5f d6 ret\n",
                          text.replace("0x1303918", "another_symbol")):
            self.assertIsNone(branch_target(text=candidate))

    def test_only_complete_constant_return_sequence_is_classified(self):
        text = "image[0x1303918] <+0>: mov w0, #-0x3 ; =-3\nimage[0x130391c] <+4>: ret\n"
        self.assertEqual(constant_return(text=text), -3)
        self.assertEqual(constant_return(text=text.replace("-0x3", "-3")), -3)
        for candidate in ("", text.replace("w0", "x0"), text.replace("ret", "br x8"),
                          text + "image[0x1303920] <+8>: ret\n", text.replace("mov", "ldr")):
            self.assertIsNone(constant_return(text=candidate))

    def test_zero_return_is_not_mistaken_for_negative_error(self):
        text = "image[0x100] <+0>: mov w0, #0x0\nimage[0x104] <+4>: ret\n"
        self.assertEqual(constant_return(text=text), 0)

    def test_bounded_subprocess_output_required(self):
        with patch("face_render_injection_inventory.subprocess.run") as execute:
            execute.return_value.stdout = "target"
            self.assertEqual(command(args=["synthetic"]), "target")
            execute.assert_called_once_with(["synthetic"], capture_output=True, text=True, check=True, timeout=60)
            execute.return_value.stdout = "x" * 200001
            with self.assertRaisesRegex(ValueError, "unbounded"):
                command(args=["synthetic"])

    def test_existing_output_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                run(library=Path("missing"), output=Path(directory))

    def test_wrong_platform_or_hash_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory, patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)), patch(
                "face_render_injection_inventory.command") as execute:
            output = Path(directory) / "new"
            with patch("face_render_injection_inventory.sys.platform", "linux"), self.assertRaisesRegex(ValueError, "macOS"):
                run(library=Path("missing"), output=output)
            with patch("face_render_injection_inventory.sys.platform", "darwin"), patch("platform.machine", return_value="arm64"), patch(
                    "espresso_oracle.sha256", return_value="bad"), self.assertRaisesRegex(ValueError, "hash"):
                run(library=Path("missing"), output=output)
            execute.assert_not_called()
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
