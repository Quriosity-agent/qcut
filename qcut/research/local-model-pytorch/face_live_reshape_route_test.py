"""Compile/run CPU fixtures only; no proprietary runtime, inference or GPU process."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
CPP = r'''
#include "face_live_reshape_route.h"
#include "face_live_makeup_scene.h"
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <vector>
using namespace qcut_live;
void expect(bool value) { if (!value) throw std::runtime_error("fixture assertion"); }
void rejects(const std::function<void()>& call) {
  bool rejected = false;
  try { call(); } catch (const std::runtime_error&) { rejected = true; }
  expect(rejected);
}
int nativeCalls = 0;
double nativeDelta = 0;
std::function<void()> duringNative;
void original(void* system, double delta) {
  expect(system == reinterpret_cast<void*>(0x1000));
  ++nativeCalls;
  nativeDelta = delta;
  if (duringNative) duringNative();
}
void replacement(void*, double) {}
struct Fixture {
  std::array<uintptr_t, 32> table{};
  uintptr_t vptr;
  ReshapeUpdateBinding binding;
  bool readable = true, writesFail = false, writeBeforeFailure = false;
  int publications = 0, validations = 0, failureValidation = 0;
  std::vector<ReshapeUpdateReceipt> receipts;
  Fixture() : vptr(reinterpret_cast<uintptr_t>(table.data() + 2)) {
    for (size_t index = 0; index < table.size(); ++index) table[index] = 0x8000 + index * 8;
    table[25] = reinterpret_cast<uintptr_t>(original);
  }
  bool read(uintptr_t address, void* output, size_t size) {
    if (!readable) return false;
    if (address == 0x1000 && size == sizeof(vptr)) { std::memcpy(output, &vptr, size); return true; }
    for (uintptr_t begin : {reinterpret_cast<uintptr_t>(table.data()), binding.shadowAddress() - 16})
      if (address == begin && size == sizeof(table)) {
        std::memcpy(output, reinterpret_cast<const void*>(begin), size); return true;
      }
    return false;
  }
  bool write(uintptr_t address, const void* input, size_t size) {
    expect(address == 0x1000 && size == sizeof(vptr));
    if (writesFail && !writeBeforeFailure) return false;
    std::memcpy(&vptr, input, size);
    return !writesFail;
  }
  auto reader() { return [this](auto address, auto out, auto size) { return read(address, out, size); }; }
  auto writer() { return [this](auto address, auto in, auto size) { return write(address, in, size); }; }
  void prepare(ReshapeImageIdentity identity = {kReshapeCoreUuid, kReshapeCoreSha256}) {
    binding.prepare(0x1000, identity, reader(), [this](uintptr_t address) -> uintptr_t {
      if (address == reinterpret_cast<uintptr_t>(table.data() + 2)) return kReshapeTable;
      return address == reinterpret_cast<uintptr_t>(original) ? kReshapeUpdate : 0;
    });
  }
  void install() { binding.install(replacement, reader(), writer()); }
  void setup() { prepare(); install(); }
  void restore() { binding.restore(reader(), writer()); }
  ReshapeUpdateRequest request(int64_t prediction = 0) {
    return {.system=0x1000, .callerOffset=kReshapeUpdateCaller, .thread=72, .seekThread=72,
      .prediction=prediction, .timestamp=0, .delta=0.0123456789123, .injecting=true};
  }
  ReshapePublication publication(int64_t prediction = 0) {
    const uintptr_t shift = prediction == 0 ? 0 : 0x10000;
    return {.graph=0x2000, .sourceBuffer=0x3000, .ownedBuffer=0x8000+shift,
      .sourceBase=0x4000, .ownedBase=0x9000+shift, .sourcePoints=0x5000, .ownedPoints=0xa000+shift,
      .bindingId=static_cast<uint64_t>(prediction+1), .graphId=1, .thread=72,
      .prediction=prediction, .timestamp=0, .faceId=0, .faces=1};
  }
  ReshapeUpdateReceipt update(ReshapeUpdateRequest request, ReshapePublication publication) {
    return binding.update(request, reader(), [&] { ++publications; return publication; },
      [&](const auto&) { if (++validations == failureValidation) throw std::runtime_error("changed candidate"); },
      [&](const auto& receipt) { receipts.push_back(receipt); });
  }
  ReshapeUpdateReceipt update(int64_t prediction = 0) { return update(request(prediction), publication(prediction)); }
};
void run(const std::string& test) {
  Fixture f;
  if (test == "identity") {
    rejects([&] { f.prepare({"foreign", kReshapeCoreSha256}); });
    expect(f.binding.failed() && !f.binding.installed());
    Fixture g;
    rejects([&] { g.prepare({kReshapeCoreUuid, "foreign"}); });
  } else if (test == "layout") {
    f.table[25] += 4;
    rejects([&] { f.prepare(); });
    Fixture g; g.vptr += 8; rejects([&] { g.prepare(); });
    Fixture h; h.readable = false; rejects([&] { h.prepare(); });
  } else if (test == "fresh") {
    f.prepare(); rejects([&] { f.prepare(); });
    Fixture g; g.prepare(); g.table[4] += 8; rejects([&] { g.install(); });
    Fixture h; h.prepare();
    rejects([&] { h.binding.install(nullptr, h.reader(), h.writer()); });
    Fixture i; i.prepare();
    rejects([&] { i.binding.install(original, i.reader(), i.writer()); });
  } else if (test == "happy") {
    f.setup();
    expect(f.vptr == f.binding.shadowAddress());
    f.update(); f.update(1);
    expect(nativeCalls == 2 && nativeDelta == f.request().delta && f.validations == 4);
    expect(f.receipts.size() == 4 && !f.receipts[0].nativeReturned && f.receipts[1].nativeReturned);
    for (const auto& row : f.receipts) expect(!row.rendererConsumption && row.sourceValidated);
    f.restore(); expect(!f.binding.failed() && !f.binding.installed());
    expect(f.vptr == reinterpret_cast<uintptr_t>(f.table.data() + 2));
  } else if (test == "request") {
    for (int mutation = 0; mutation < 10; ++mutation) {
      Fixture g; g.setup(); auto request = g.request();
      if (mutation == 0) request.system += 8;
      if (mutation == 1) request.callerOffset += 4;
      if (mutation == 2) request.thread = 0;
      if (mutation == 3) request.seekThread += 1;
      if (mutation == 4) request.prediction = 1;
      if (mutation == 5) request.timestamp = 1;
      if (mutation == 6) request.injecting = false;
      if (mutation == 7) request.priorFailure = true;
      if (mutation == 8) request.delta = std::numeric_limits<double>::quiet_NaN();
      if (mutation == 9) request.delta = std::numeric_limits<double>::infinity();
      rejects([&] { g.update(request, g.publication()); });
      expect(g.publications == 0 && g.binding.failed()); g.restore();
    }
    expect(nativeCalls == 0);
  } else if (test == "metadata") {
    for (int mutation = 0; mutation < 9; ++mutation) {
      Fixture g; g.setup(); auto published = g.publication();
      if (mutation == 0) published.prediction = 1;
      if (mutation == 1) published.thread += 1;
      if (mutation == 2) published.timestamp = 1;
      if (mutation == 3) published.faces = 0;
      if (mutation == 4) published.faces = 2;
      if (mutation == 5) published.faceId = 1;
      if (mutation == 6) published.bindingId = 0;
      if (mutation == 7) published.graphId = 0;
      if (mutation == 8) published.ownedBase = UINTPTR_MAX;
      rejects([&] { g.update(g.request(), published); });
      expect(g.binding.failed() && g.receipts.empty()); g.restore();
    }
    expect(nativeCalls == 0);
  } else if (test == "alias") {
    for (int mutation = 0; mutation < 6; ++mutation) {
      Fixture g; g.setup(); auto published = g.publication();
      if (mutation == 0) published.ownedBuffer = published.sourceBuffer;
      if (mutation == 1) published.ownedBase = published.sourceBase;
      if (mutation == 2) published.ownedPoints = published.sourcePoints;
      if (mutation == 3) published.ownedPoints = published.sourcePoints + 8;
      if (mutation == 4) published.ownedPoints = published.sourcePoints - 8;
      if (mutation == 5) published.ownedBuffer = published.ownedPoints + 840;
      rejects([&] { g.update(g.request(), published); }); g.restore();
    }
    expect(nativeCalls == 0);
  } else if (test == "reuse") {
    for (int mutation = 0; mutation < 7; ++mutation) {
      Fixture g; g.setup(); g.update(); auto published = g.publication(1);
      if (mutation == 0) published.ownedBuffer = g.publication().ownedBuffer;
      if (mutation == 1) published.ownedPoints = g.publication().ownedPoints + 8;
      if (mutation == 2) published.sourcePoints = g.publication().ownedPoints + 8;
      if (mutation == 3) published.graph += 8;
      if (mutation == 4) published.graphId += 1;
      if (mutation == 5) published.bindingId = 1;
      if (mutation == 6) published.ownedBuffer = g.publication().sourceBase;
      rejects([&] { g.update(g.request(1), published); }); g.restore();
    }
    expect(nativeCalls == 7);
  } else if (test == "shadow") {
    f.setup(); auto* table = reinterpret_cast<uintptr_t*>(f.binding.shadowAddress()); table[0] += 8;
    rejects([&] { f.update(); }); expect(nativeCalls == 0); f.restore();
  } else if (test == "changed") {
    f.setup(); duringNative = [&] { f.vptr = 0x900000; };
    rejects([&] { f.update(); }); expect(nativeCalls == 1 && f.receipts.size() == 1);
    rejects([&] { f.restore(); }); expect(f.vptr == 0x900000);
  } else if (test == "superseded") {
    f.setup(); f.vptr = reinterpret_cast<uintptr_t>(f.table.data() + 2);
    rejects([&] { f.restore(); }); expect(f.binding.installed());
  } else if (test == "write_failure") {
    for (bool changed : {false, true}) {
      Fixture g; g.prepare(); g.writesFail = true; g.writeBeforeFailure = changed;
      rejects([&] { g.install(); }); expect(g.binding.installed() && g.binding.failed());
      g.writesFail = false; g.restore(); expect(!g.binding.installed());
      rejects([&] { g.update(); });
    }
  } else if (test == "validation") {
    for (int validation : {1, 2}) {
      Fixture g; g.setup(); g.failureValidation = validation;
      rejects([&] { g.update(); }); expect(g.binding.failed());
      expect(g.receipts.size() == static_cast<size_t>(validation - 1)); g.restore();
    }
    expect(nativeCalls == 1);
  } else if (test == "reentry") {
    f.setup(); duringNative = [&] { f.update(); };
    rejects([&] { f.update(); }); expect(nativeCalls == 1 && f.binding.failed()); f.restore();
  } else if (test == "sequence") {
    f.setup(); f.update(); rejects([&] { f.update(); }); f.restore();
    Fixture g; g.setup(); g.update(); g.update(1); rejects([&] { g.update(2); }); g.restore();
  } else if (test == "uninstalled") {
    rejects([&] { f.update(); }); expect(nativeCalls == 0);
    Fixture g; g.setup(); g.restore(); rejects([&] { g.update(); }); expect(nativeCalls == 0);
  } else if (test == "inventory") {
    const std::map<uintptr_t, uintptr_t> values{
      {0x12e8,0x2000},{0x12f0,0x2058},{0x2020,0x3000},{0x30b0,0x4000},{0x30b8,0x4058},
      {0x4000,0x5000},{0x5000,0x6000},{0x60b8,0x7000}};
    auto read = [&](uintptr_t address, void* out, size_t size) {
      if (size != 8 || !values.contains(address)) return false;
      std::memcpy(out, &values.at(address), size); return true;
    };
    auto offset = [](uintptr_t address) -> uintptr_t {
      return address == 0x6000 ? kReshapeTable : address == 0x7000 ? kReshapeUpdate : 0;
    };
    auto scene = [](uintptr_t, int) -> uintptr_t { return 0x3000; };
    auto inventory = inspectFaceSystemScenes(0x1000, kReshapeTable, kReshapeUpdate, read, offset, scene);
    expect(inventory.matched == std::vector<uintptr_t>{0x5000});
    expect(inspectMakeupScenes(0x1000, read, offset, scene).makeup.empty());
  } else throw std::runtime_error("unknown fixture");
}
int main(int argc, char** argv) {
  try { expect(argc == 2); run(argv[1]); }
  catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
'''


class ReshapeRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which("clang++")
        if compiler is None:
            raise RuntimeError("clang++ is required for the CPU ABI fixture")
        cls.temporary = tempfile.TemporaryDirectory(prefix="qcut-reshape-cpu-")
        cls.addClassCleanup(cls.temporary.cleanup)
        directory = Path(cls.temporary.name)
        source = directory / "fixture.cpp"
        source.write_text(CPP, encoding="utf-8")
        cls.binary = directory / "fixture"
        subprocess.run([compiler, "-std=c++20", "-Wall", "-Wextra", "-Werror",
                        "-I", str(HERE), str(source), "-o", str(cls.binary)],
                       check=True, capture_output=True, text=True, timeout=30)

    def run_case(self, *, name):
        result = subprocess.run([str(self.binary), name], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_pinned_image_identity(self):
        self.run_case(name="identity")

    def test_vtable_layout_and_reads(self):
        self.run_case(name="layout")

    def test_fresh_installation_and_races(self):
        self.run_case(name="fresh")

    def test_owned_two_prediction_roundtrip_is_not_consumption(self):
        self.run_case(name="happy")

    def test_request_scope_guards(self):
        self.run_case(name="request")

    def test_publication_metadata(self):
        self.run_case(name="metadata")

    def test_clone_aliases_and_point_overlap(self):
        self.run_case(name="alias")

    def test_cross_prediction_storage_reuse(self):
        self.run_case(name="reuse")

    def test_shadow_mutation(self):
        self.run_case(name="shadow")

    def test_native_superseding_pointer_is_never_overwritten(self):
        self.run_case(name="changed")

    def test_external_restoration_is_not_our_receipt(self):
        self.run_case(name="superseded")

    def test_failed_write_keeps_shadow_until_cleanup(self):
        self.run_case(name="write_failure")

    def test_source_validation_before_and_after_update(self):
        self.run_case(name="validation")

    def test_nested_native_update_is_fatal(self):
        self.run_case(name="reentry")

    def test_duplicate_and_extra_predictions_are_fatal(self):
        self.run_case(name="sequence")

    def test_update_requires_installed_hook(self):
        self.run_case(name="uninstalled")

    def test_typed_inventory_keeps_makeup_default_unchanged(self):
        self.run_case(name="inventory")


if __name__ == "__main__":
    unittest.main()
