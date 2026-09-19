from pathlib import Path
import unittest

from portable_smoke import PRIVATE, ROOT, denied_access


class SmokeGuardTests(unittest.TestCase):
    def denied(self, event, *args):
        return denied_access(event=event, args=args, allowed={PRIVATE / "m.pt", PRIVATE / "i.npz"}, output=PRIVATE / "out")

    def test_bundle_and_input_are_allowed(self):
        self.assertIsNone(self.denied("open", str(PRIVATE / "m.pt"), "rb"))
        self.assertIsNone(self.denied("open", str(PRIVATE / "i.npz"), "rb"))

    def test_source_weights_and_vendor_library_are_denied(self):
        self.assertIsNotNone(self.denied("open", str(PRIVATE / "raw/model.bytenn"), "rb"))
        self.assertIsNotNone(self.denied("ctypes.dlopen", str(Path.home() / "Library/Application Support/QCut/PrivateRuntimes/libbytenn.dylib")))
        self.assertIsNotNone(self.denied("open", "/tmp/source.tflite", "rb"))

    def test_authored_code_and_output_allowed(self):
        self.assertIsNone(self.denied("open", str(ROOT / "research/local-model-pytorch/infer.py"), "rb"))
        self.assertIsNone(self.denied("open", str(PRIVATE / "out/output.npz"), "wb"))

    def test_network_and_file_descriptors(self):
        self.assertIsNotNone(self.denied("socket.connect", object(), ("127.0.0.1", 80)))
        self.assertIsNone(self.denied("open", 1, "wb"))
        self.assertIsNone(self.denied("import", "torch"))


if __name__ == "__main__":
    unittest.main()
