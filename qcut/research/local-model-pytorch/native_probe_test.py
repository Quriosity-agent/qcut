"""macOS probe failure-path tests against a synthetic SDK, never private model assets."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLANG = "/Library/Developer/CommandLineTools/usr/bin/clang++"
SDK = Path("/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk")
SDK_STUB = r'''
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
namespace smash { namespace package {
class ModelPackage {
public:
  ModelPackage(const std::string &);
  int InitFromBuf(const char *, int);
  int InitFromPath(const std::string &);
  int GetVersion(std::string &);
  int Extract(const std::string &, std::map<std::string, std::string> &);
  int Release();
};
ModelPackage::ModelPackage(const std::string &) {}
int ModelPackage::InitFromBuf(const char *, int) {
  const char *result = std::getenv("TEST_INIT_RC");
  return result ? std::atoi(result) : 0;
}
int ModelPackage::InitFromPath(const std::string &) { return 0; }
int ModelPackage::GetVersion(std::string &out) { out = "synthetic"; return 0; }
int ModelPackage::Extract(const std::string &, std::map<std::string, std::string> &out) {
  out["config"] = "test-payload"; return 0;
}
int ModelPackage::Release() { return 0; }
}}
namespace BYTENN {
class ByteNNEngine {};
class EngineFactory { public: static std::shared_ptr<ByteNNEngine> Create(); };
std::shared_ptr<ByteNNEngine> EngineFactory::Create() { std::abort(); }
}
extern "C" int SK_CreateHandle(void **handle) {
  const char *mode = std::getenv("TEST_SK_MODE");
  *handle = mode && std::string(mode) == "valid" ? reinterpret_cast<void *>(1) : nullptr;
  return mode && std::string(mode) == "error" ? -7 : 0;
}
extern "C" int SK_InitModel(void *handle, int, const char *) { if (!handle) std::abort(); return 0; }
extern "C" int SK_ReleaseHandle(void *handle) { if (!handle) std::abort(); return 0; }
'''

CAPTURE_STUB = r'''
void originalConstruct(void *, const std::string &) {}
int originalInitFromPath(void *, const std::string &) { return 0; }
int originalInitFromBuf(void *, const char *, int) { return 0; }
int originalExtract(void *, const std::string &, std::map<std::string, std::string> &) { return 0; }
int main() { capturedConstruct(nullptr, "synthetic-secret-must-not-be-logged"); }
'''

HEAP_STUB = r'''
long originalCreateNetBytes(void *, const unsigned char *, unsigned long) { return 0; }
long originalCreateNetNamed(void *, const std::string &, const unsigned char *, unsigned long) { return 0; }
long originalCreateNetConfig(void *, const std::string &, const unsigned char *, unsigned long, const void *) { return 0; }
long originalCreateNetFromFile(void *, const char *) { return 0; }
int originalThrustorCreateNet(void *, const std::string &, void *, std::vector<std::string> &) { return 0; }
int originalEspressoCreateNet(void *, const std::string &, void *, std::vector<std::string> &) { return 17; }
int originalEspressoReInferShape(void *, int, int) { return 0; }
int originalEspressoSetInput(void *, std::string, void *, int, int, int) { return 0; }
int originalEspressoInference(void *) { return 0; }
TensorView originalEspressoExtract(void *, const std::string &) { return {}; }
std::shared_ptr<BYTENN::ByteNNEngine> originalEngineCreate() { return {}; }
int main() {
  unsetenv("QCUT_BYTENN_CAPTURE_DIR");
  unsetenv("QCUT_BYTENN_CAPTURE_IO");
  setenv("QCUT_BYTENN_SCAN_AFTER_CREATE", "1", 1);
  std::vector<std::string> names;
  return capturedEspressoCreateNet(nullptr, "", nullptr, names) == 17 ? 0 : 1;
}
'''


@unittest.skipUnless(sys.platform == "darwin", "native probes require macOS")
class NativeProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiler = CLANG if Path(CLANG).exists() else shutil.which("clang++")
        if not cls.compiler:
            raise RuntimeError("macOS native tests require clang++")
        cls.sdk = SDK if SDK.exists() else Path(subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip())
        temporary = tempfile.TemporaryDirectory(prefix="qcut-native-probe-test-")
        cls.addClassCleanup(temporary.cleanup)
        cls.root = Path(temporary.name)
        stub = cls.root / "sdk.mm"
        stub.write_text(SDK_STUB)
        cls.library = cls.root / "sdk.dylib"
        cls.compile(source=stub, output=cls.library, extra=["-dynamiclib"])
        for name in ("smash_package_host", "smash_sk_host", "bytenn_init_host"):
            cls.compile(source=ROOT / f"{name}.mm", output=cls.root / name,
                        extra=[str(cls.library)] if name == "bytenn_init_host" else [])
        for name, source, body in (("capture", "smash_package_capture.mm", CAPTURE_STUB),
                                   ("heap", "bytenn_model_capture.mm", HEAP_STUB)):
            harness = cls.root / f"{name}.mm"
            harness.write_text(f'#include "{ROOT / source}"\n' + body)
            cls.compile(source=harness, output=cls.root / name, extra=[])

    @classmethod
    def compile(cls, *, source, output, extra):
        result = subprocess.run([cls.compiler, "-std=c++17", "-O1", "-fobjc-arc", "-framework", "Foundation",
                                 "-isysroot", str(cls.sdk), "-isystem", str(cls.sdk / "usr/include/c++/v1"),
                                 str(source), "-o", str(output), *extra], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(temporary.cleanup)
        self.case = Path(temporary.name)
        self.model = self.case / "model"
        self.model.write_bytes(b"synthetic-model")
        self.out = self.case / "output"

    def run_probe(self, *, name="smash_package_host", args=None, overrides=None):
        env = {key: value for key, value in os.environ.items() if not key.startswith(("QCUT_", "DYLD_", "TEST_"))}
        env["QCUT_SMASH_PACKAGE_KEY"] = "synthetic-test-value"
        env.update(overrides or {})
        if args is None:
            args = [str(self.library), str(self.model), str(self.out), "record"]
        return subprocess.run([str(self.root / name), *args], env=env, capture_output=True, text=True, timeout=10)

    def test_package_creates_output_and_writes_payload(self):
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.out / "record.config.bin").read_text(), "test-payload")
        self.assertEqual(json.loads(result.stdout)["key_index"], 0)

    def test_package_missing_input_and_oversized_input(self):
        self.model.unlink()
        self.assertEqual(self.run_probe().returncode, 2)
        with self.model.open("wb") as stream:
            stream.truncate(2**31)
        self.assertEqual(self.run_probe().returncode, 2)

    def test_package_rejects_invalid_output_directory(self):
        self.out.write_text("not-a-directory")
        self.assertEqual(self.run_probe().returncode, 2)

    def test_package_rejects_payload_open_failure(self):
        self.out.mkdir()
        (self.out / "record.config.bin").mkdir()
        result = self.run_probe()
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot open payload", result.stderr)

    def test_package_rejects_payload_write_failure(self):
        self.out.mkdir()
        # A subprocess file-size limit gives a portable disk-write failure without filling a disk.
        import resource
        import signal
        def limit_output():
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (1, 1))
        env = {"QCUT_SMASH_PACKAGE_KEY": "synthetic-test-value"}
        result = subprocess.run([str(self.root / "smash_package_host"), str(self.library), str(self.model),
                                 str(self.out), "record"], env=env, preexec_fn=limit_output,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot write payload", result.stderr)

    def test_package_preserves_last_failure_without_accepted_index(self):
        candidates = self.case / "candidates"
        candidates.write_text("synthetic-a\nsynthetic-b\n")
        result = self.run_probe(overrides={"QCUT_SMASH_PACKAGE_KEY": "", "QCUT_SMASH_PACKAGE_KEYS": str(candidates),
                                           "TEST_INIT_RC": "-4"})
        self.assertEqual(result.returncode, 1)
        report = json.loads(result.stdout)
        self.assertEqual(report, {"keys_tried": 2, "init": -4, "records": []})

    def test_bytenn_rejects_missing_or_uint32_overflow_before_sdk(self):
        self.model.unlink()
        self.assertEqual(self.run_probe(name="bytenn_init_host", args=[str(self.model)]).returncode, 2)
        with self.model.open("wb") as stream:
            stream.truncate(2**32)
        self.assertEqual(self.run_probe(name="bytenn_init_host", args=[str(self.model)]).returncode, 2)

    def test_skeleton_checks_status_and_handle(self):
        for mode, expected in (("null", 2), ("error", 2), ("valid", 0)):
            with self.subTest(mode=mode):
                result = self.run_probe(name="smash_sk_host", args=[str(self.library), str(self.model), "0"],
                                        overrides={"TEST_SK_MODE": mode})
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_capture_log_does_not_contain_constructor_argument(self):
        result = self.run_probe(name="capture", args=[], overrides={"QCUT_SMASH_CAPTURE_DIR": str(self.case)})
        self.assertEqual(result.returncode, 0, result.stderr)
        log = (self.case / "calls.log").read_text()
        self.assertIn("construct self=", log)
        self.assertNotIn("synthetic-secret", log)
        self.assertNotIn("argument=", log)

    def test_heap_sweep_disabled_without_capture_directory(self):
        result = self.run_probe(name="heap", args=[])
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
