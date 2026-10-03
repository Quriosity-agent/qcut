"""Terminal readback against a synthetic SDK, never vendor libraries or models."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import native_probe_test as native

ROOT = Path(__file__).resolve().parent
HEADS = ("fc_landmark_s1", "prob", "fc_pitch", "fc_yaw", "fc_visible")
STUB_SUPPORT = r'''
#include <thread>
int inferenceCalls = 0, inputReads = 0, terminalReads = 0, lastInferenceResult = 0;
void requireUnlocked() {
  bool unlocked = false;
  std::thread check([&] {
    unlocked = captureMutex.try_lock();
    if (unlocked) captureMutex.unlock();
  });
  check.join();
  if (!unlocked) std::abort();
}
int environmentInt(const char *name, int fallback) {
  const char *value = std::getenv(name);
  return value ? std::atoi(value) : fallback;
}
const std::vector<std::string> heads = {"fc_landmark_s1", "prob", "fc_pitch", "fc_yaw", "fc_visible"};
std::vector<std::string> profileNames(const std::string &profile) {
  std::vector<std::string> names = heads;
  if (profile == "reversed") std::reverse(names.begin(), names.end());
  if (profile == "missing") names.pop_back();
  if (profile == "extra") names.push_back("extra");
  if (profile == "duplicate") names.back() = names.front();
  if (profile == "unknown") names.back() = "not_a_head";
  if (profile == "long") names.back() = std::string(4096, 'x');
  if (profile == "nonstage1") names = {"landmarks"};
  if (profile == "empty") names.clear();
  return names;
}
'''
INFERENCE_STUB = r'''
int originalEspressoInference(void *) {
  requireUnlocked();
  ++inferenceCalls;
  lastInferenceResult = environmentInt("TEST_INFERENCE_RC", 0);
  if (inferenceCalls == 1)
    lastInferenceResult = environmentInt("TEST_FIRST_INFERENCE_RC", lastInferenceResult);
  return lastInferenceResult;
}
'''
EXTRACT_STUB = r'''
TensorView originalEspressoExtract(void *, const std::string &name) {
  requireUnlocked();
  static std::map<std::string, std::vector<int16_t>> tensors;
  const bool input = name == "data";
  if (input) ++inputReads;
  else {
    if (!inferenceCalls) std::abort();
    if (lastInferenceResult && !environmentInt("TEST_CALLER_EXTRACTS", 0)) std::abort();
    ++terminalReads;
  }
  const int count = input ? 120 * 120 * 3 : name == "fc_landmark_s1" ? 212 :
                    name == "fc_visible" ? 106 : name == "prob" ? 2 : 1;
  auto &values = tensors[name];
  if (values.empty()) {
    int seed = 0;
    for (unsigned char byte : name) seed += byte;
    for (int index = 0; index < count; ++index) values.push_back((seed + index) % 101 - 50);
  }
  return {values.data(), {1, input ? 120 : 1, input ? 120 : 1, input ? 3 : count}, {2, 0}};
}
'''
MAIN_STUB = r'''
int main() {
  int object = 0;
  void *self = &object;
  const char *profile = std::getenv("TEST_PROFILE");
  std::vector<std::string> names = profileNames(profile ? profile : "stage1");
  const std::string graph = "1 1 7\nDataV2 data 1 120 120 3\n";
  const int createResult = capturedEspressoCreateNet(self, graph, nullptr, names);
  if (createResult != 17) return 1;
  if (environmentInt("TEST_RECREATE", 0)) {
    names = profileNames("nonstage1");
    capturedEspressoCreateNet(self, graph, nullptr, names);
  }
  names.clear(); // declared outputs belong to NetState, not the caller vector
  const int count = environmentInt("TEST_INFERENCES", 1);
  if (count < 1 || count > 3) return 2;
  for (int index = 0; index < count; ++index) {
    const int result = capturedEspressoInference(self);
    if (result != lastInferenceResult) return 3;
    const int caller = environmentInt("TEST_CALLER_EXTRACTS", 0);
    for (const std::string &name : heads) {
      if (!caller || (caller == 2 && name != "prob" && name != "fc_visible")) continue;
      const TensorView view = capturedEspressoExtract(self, name);
      int seed = 0;
      for (unsigned char byte : name) seed += byte;
      if (view.raw[0] != 2 || view.raw[1] != 0 || view.dims[0] != 1 ||
          static_cast<const int16_t *>(view.data)[0] != seed % 101 - 50) return 4;
    }
  }
  const auto state = netStates.find(self);
  std::printf("{\"calls\":%d,\"input_reads\":%d,\"terminal_reads\":%d,"
              "\"completed\":%d,\"declared_outputs\":%zu,\"sequence\":%d,\"rc\":%d}\n",
              inferenceCalls, inputReads, terminalReads,
              state == netStates.end() ? 0 : state->second.inferences,
              state == netStates.end() ? 0 : state->second.terminalOutputs.size(),
              qcut_bytenn_capture_sequence(), lastInferenceResult);
}
'''


@unittest.skipUnless(sys.platform == "darwin", "synthetic capture harness requires macOS")
class TerminalCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-terminal-capture-test-")
        cls.addClassCleanup(temporary.cleanup)
        cls.root = Path(temporary.name)
        cls.executable = cls.root / "terminals"
        body = native.HEAP_STUB.split("int main()", 1)[0]
        for original, replacement in (
            ("int originalEspressoInference(void *) { return 0; }", INFERENCE_STUB),
            ("TensorView originalEspressoExtract(void *, const std::string &) { return {}; }", EXTRACT_STUB),
        ):
            if body.count(original) != 1:
                raise RuntimeError("synthetic SDK stub changed")
            body = body.replace(original, replacement)
        harness = cls.root / "terminals.mm"
        harness.write_text(f'#include "{ROOT / "bytenn_model_capture.mm"}"\n' + STUB_SUPPORT + body + MAIN_STUB)
        compiler = native.CLANG if Path(native.CLANG).exists() else "clang++"
        sdk = native.SDK if native.SDK.exists() else Path(
            subprocess.check_output(["xcrun", "--show-sdk-path"], text=True, timeout=10).strip())
        result = subprocess.run(
            [compiler, "-std=c++17", "-O1", "-Werror", "-fobjc-arc", "-framework", "Foundation",
             "-isysroot", str(sdk), "-isystem", str(sdk / "usr/include/c++/v1"),
             str(harness), "-o", str(cls.executable)], capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr)

    def run_capture(self, *, overrides=None, directory=True):
        temporary = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("QCUT_", "DYLD_", "TEST_"))}
        env.update({"QCUT_BYTENN_CAPTURE_IO": "1", "QCUT_BYTENN_CAPTURE_TERMINALS": "1"})
        if directory:
            env["QCUT_BYTENN_CAPTURE_DIR"] = str(output)
        for key, value in (overrides or {}).items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        result = subprocess.run([str(self.executable)], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        records = []
        for path in sorted(output.glob("*.json")):
            record = json.loads(path.read_text())
            record["fields"] = dict(item.split("=", 1) for item in record["detail"].split())
            if record["kind"] in ("espresso-input", "espresso-output"):
                data = path.with_suffix(".bin").read_bytes()
                self.assertEqual(len(data), record["bytes"])
                record["sha256"] = hashlib.sha256(data).hexdigest()
            records.append(record)
        summary = json.loads(result.stdout)
        if summary["sequence"] >= 0:
            self.assertEqual(summary["sequence"], len(records))
            self.assertEqual([record["index"] for record in records], list(range(len(records))))
        return summary, records

    @staticmethod
    def outputs(records):
        return [record for record in records if record["kind"] == "espresso-output"]

    def assert_accounting(self, *, summary, records, results):
        count = len(results)
        self.assertEqual(summary["calls"], count)
        self.assertEqual(summary["completed"], count)
        self.assertEqual(summary["input_reads"], count)
        calls = [record for record in records if record["kind"] == "espresso-inference"]
        inputs = [record for record in records if record["kind"] == "espresso-input"]
        self.assertEqual([int(record["fields"]["inference"]) for record in calls], list(range(count)))
        self.assertEqual([int(record["fields"]["rc"]) for record in calls], results)
        self.assertEqual([int(record["fields"]["inference"]) for record in inputs], list(range(count)))
        self.assertTrue(all(record["fields"]["name"] == "data" for record in inputs))
        self.assertEqual(len({record["fields"]["self"] for record in calls + inputs + self.outputs(records)}), 1)

    def test_opt_in_reads_exact_declared_heads_after_success(self):
        summary, records = self.run_capture()
        self.assert_accounting(summary=summary, records=records, results=[0])
        outputs = self.outputs(records)
        self.assertEqual(summary["declared_outputs"], 5)
        self.assertEqual(summary["terminal_reads"], 5)
        self.assertEqual([record["fields"]["name"] for record in outputs], list(HEADS))
        inference = next(record["index"] for record in records if record["kind"] == "espresso-inference")
        self.assertTrue(all(record["index"] > inference and record["fields"]["inference"] == "0"
                            for record in outputs))

    def test_terminal_flag_requires_exact_one(self):
        for flag in ("", "0", "10", "1true", "true", " 1"):
            with self.subTest(flag=flag):
                summary, records = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_TERMINALS": flag})
                self.assert_accounting(summary=summary, records=records, results=[0])
                self.assertEqual(summary["terminal_reads"], 0)
                self.assertEqual(self.outputs(records), [])

    def test_unset_flag_preserves_default_caller_only_capture(self):
        summary, records = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_TERMINALS": None,
                                                       "TEST_CALLER_EXTRACTS": "1"})
        self.assert_accounting(summary=summary, records=records, results=[0])
        self.assertEqual(summary["terminal_reads"], 5)
        self.assertEqual(len(self.outputs(records)), 5)

    def test_capture_io_off_does_not_read_or_record_terminals(self):
        summary, records = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_IO": "0"})
        self.assertEqual(summary["calls"], 1)
        self.assertEqual(summary["sequence"], -1)
        self.assertEqual(summary["input_reads"], 0)
        self.assertEqual(summary["terminal_reads"], 0)
        self.assertEqual([record["kind"] for record in records], ["espresso"])

    def test_capture_io_existing_prefix_behavior_is_unchanged(self):
        summary, records = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_IO": "10"})
        self.assert_accounting(summary=summary, records=records, results=[0])
        self.assertEqual(len(self.outputs(records)), 5)

    def test_no_capture_directory_does_not_read_any_tensors(self):
        summary, records = self.run_capture(directory=False)
        self.assertEqual(summary["calls"], 1)
        self.assertEqual(summary["input_reads"], 0)
        self.assertEqual(summary["terminal_reads"], 0)
        self.assertEqual(records, [])

    def test_profiles_require_five_unique_whitelisted_bounded_names(self):
        for profile in ("missing", "extra", "duplicate", "unknown", "long", "nonstage1", "empty"):
            with self.subTest(profile=profile):
                summary, records = self.run_capture(overrides={"TEST_PROFILE": profile})
                self.assert_accounting(summary=summary, records=records, results=[0])
                self.assertEqual(summary["declared_outputs"], 0)
                self.assertEqual(summary["terminal_reads"], 0)
                self.assertEqual(self.outputs(records), [])

    def test_output_declaration_order_is_not_a_profile_constraint(self):
        summary, records = self.run_capture(overrides={"TEST_PROFILE": "reversed"})
        self.assertEqual(summary["terminal_reads"], 5)
        self.assertEqual([record["fields"]["name"] for record in self.outputs(records)], list(reversed(HEADS)))

    def test_failure_never_proactively_extracts_outputs(self):
        for result in (-7, 9):
            with self.subTest(result=result):
                summary, records = self.run_capture(overrides={"TEST_INFERENCE_RC": str(result)})
                self.assert_accounting(summary=summary, records=records, results=[result])
                self.assertEqual(summary["rc"], result)
                self.assertEqual(summary["terminal_reads"], 0)
                self.assertEqual(self.outputs(records), [])

    def test_failure_then_success_preserves_completed_call_indices(self):
        summary, records = self.run_capture(overrides={"TEST_FIRST_INFERENCE_RC": "-7", "TEST_INFERENCES": "2"})
        self.assert_accounting(summary=summary, records=records, results=[-7, 0])
        self.assertEqual(summary["terminal_reads"], 5)
        self.assertEqual({record["fields"]["inference"] for record in self.outputs(records)}, {"1"})

    def test_multiple_inferences_do_not_add_native_inference_calls(self):
        summary, records = self.run_capture(overrides={"TEST_INFERENCES": "3"})
        self.assert_accounting(summary=summary, records=records, results=[0, 0, 0])
        self.assertEqual(summary["terminal_reads"], 15)
        self.assertEqual([record["fields"]["inference"] for record in self.outputs(records)],
                         [str(index) for index in range(3) for _ in HEADS])

    def test_recreating_network_clears_prior_terminal_profile(self):
        summary, records = self.run_capture(overrides={"TEST_RECREATE": "1"})
        self.assert_accounting(summary=summary, records=records, results=[0])
        self.assertEqual(summary["declared_outputs"], 0)
        self.assertEqual(self.outputs(records), [])

    def test_duplicate_caller_extracts_preserve_hashes_and_returned_views(self):
        summary, records = self.run_capture(overrides={"TEST_CALLER_EXTRACTS": "1"})
        self.assert_accounting(summary=summary, records=records, results=[0])
        self.assertEqual(summary["terminal_reads"], 10)
        _, baseline = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_TERMINALS": "0",
                                                  "TEST_CALLER_EXTRACTS": "1"})
        for name in HEADS:
            observed = [record for record in self.outputs(records) if record["fields"]["name"] == name]
            reference = next(record for record in self.outputs(baseline) if record["fields"]["name"] == name)
            self.assertEqual(len(observed), 2)
            self.assertTrue(all(record["sha256"] == reference["sha256"] for record in observed))
            self.assertTrue(all(record["fields"]["inference"] == "0" for record in observed))

    def test_terminal_reads_leave_native_inputs_and_inference_results_unchanged(self):
        observed, records = self.run_capture(overrides={"TEST_INFERENCES": "2"})
        baseline, references = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_TERMINALS": None,
                                                           "TEST_INFERENCES": "2"})
        for field in ("calls", "input_reads", "completed", "rc"):
            self.assertEqual(observed[field], baseline[field])
        observed_inputs = [record["sha256"] for record in records if record["kind"] == "espresso-input"]
        baseline_inputs = [record["sha256"] for record in references if record["kind"] == "espresso-input"]
        self.assertEqual(observed_inputs, baseline_inputs)

    def test_rejecting_caller_still_captures_all_five_heads(self):
        summary, records = self.run_capture(overrides={"TEST_CALLER_EXTRACTS": "2"})
        self.assertEqual(summary["terminal_reads"], 7)
        self.assertEqual({record["fields"]["name"] for record in self.outputs(records)}, set(HEADS))
        _, baseline = self.run_capture(overrides={"QCUT_BYTENN_CAPTURE_TERMINALS": "0",
                                                  "TEST_CALLER_EXTRACTS": "2"})
        self.assertEqual({record["fields"]["name"] for record in self.outputs(baseline)}, {"prob", "fc_visible"})

    def test_unknown_profile_does_not_change_actual_caller_extracts(self):
        summary, records = self.run_capture(overrides={"TEST_PROFILE": "nonstage1", "TEST_CALLER_EXTRACTS": "1"})
        self.assertEqual(summary["terminal_reads"], 5)
        self.assertEqual([record["fields"]["name"] for record in self.outputs(records)], list(HEADS))


if __name__ == "__main__":
    unittest.main()
