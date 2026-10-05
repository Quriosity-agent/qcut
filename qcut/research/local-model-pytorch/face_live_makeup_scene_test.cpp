#include "face_live_makeup_scene.h"
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <string>

namespace {
void require(bool value) {
  if (!value) throw std::runtime_error("makeup inventory test failed");
}
void rejects(const std::function<void()>& call) {
  try { call(); } catch (const std::runtime_error&) { return; }
  throw std::runtime_error("unbounded makeup inventory accepted");
}
struct Fixture {
  static constexpr uintptr_t feature = 0x1000, entries = 0x2000, scene = 0x3000;
  static constexpr uintptr_t systems = 0x4000, makeup = 0x5000, table = 0x6000, update = 0x7000;
  std::map<uintptr_t, uintptr_t> memory = {
    {feature + 0x2e8, entries}, {feature + 0x2f0, entries + 0x58},
    {entries + 0x20, scene}, {scene + 0xb0, systems}, {scene + 0xb8, systems + 0x58},
    {systems, makeup}, {makeup, table}, {table + 0xb8, update}
  };
  uintptr_t sceneResult = scene;
  qcut_live::MakeupInventory inspect() {
    return qcut_live::inspectMakeupScenes(feature,
      [&](uintptr_t address, void* out, size_t size) {
        if (size != sizeof(uintptr_t) || !memory.contains(address)) return false;
        std::memcpy(out, &memory.at(address), size);
        return true;
      }, [](uintptr_t address) -> uintptr_t {
        if (address == table) return qcut_live::kMakeupV2Table;
        return address == update ? qcut_live::kMakeupV2Update : 0;
      }, [&](uintptr_t object, int index) {
        require(object == feature && index >= 0 && index < 32);
        return sceneResult;
      });
  }
};
}
int main() {
  require(qcut_live::recordCount(0, 0, 32) == 0);
  require(qcut_live::recordCount(0x1000, 0x1000 + 32 * 0x58, 32) == 32);
  for (auto endpoints : {std::pair<uintptr_t, uintptr_t>{0, 0x1000}, {0x1000, 0},
      {0x1000, 0x1008}, {0x1001, 0x1059}, {0x1000, 0x1000 + 33 * 0x58}})
    rejects([&] { qcut_live::recordCount(endpoints.first, endpoints.second, 32); });
  Fixture valid;
  auto inventory = valid.inspect();
  require(inventory.scenes == 1 && inventory.systems == 1 && inventory.makeup == std::vector<uintptr_t>{Fixture::makeup});
  for (auto address : {Fixture::feature + 0x2e8, Fixture::entries + 0x20, Fixture::scene + 0xb0,
                      Fixture::systems, Fixture::makeup, Fixture::table + 0xb8}) {
    Fixture missing;
    missing.memory.erase(address);
    rejects([&] { missing.inspect(); });
  }
  Fixture wrongScene;
  wrongScene.sceneResult += 8;
  rejects([&] { wrongScene.inspect(); });
  Fixture wrongSlot;
  wrongSlot.memory[Fixture::table + 0xb8] += 4;
  rejects([&] { wrongSlot.inspect(); });
  Fixture otherSystem;
  otherSystem.memory[Fixture::makeup] += 8;
  require(otherSystem.inspect().makeup.empty());
  Fixture duplicate;
  duplicate.memory[Fixture::scene + 0xb8] += 0x58;
  duplicate.memory[Fixture::systems + 0x58] = Fixture::makeup;
  require(duplicate.inspect().makeup.size() == 1 && duplicate.inspect().systems == 1);
  Fixture duplicateScene;
  duplicateScene.memory[Fixture::feature + 0x2f0] += 0x58;
  duplicateScene.memory[Fixture::entries + 0x58 + 0x20] = Fixture::scene;
  require(duplicateScene.inspect().scenes == 1);
  Fixture pendingScene;
  pendingScene.memory[Fixture::entries + 0x20] = 0;
  require(pendingScene.inspect().scenes == 0);
  Fixture invalidSystem;
  invalidSystem.memory[Fixture::systems] = UINTPTR_MAX - 7;
  rejects([&] { invalidSystem.inspect(); });
  std::cout << "makeup scene inventory bounds, layouts, identity and deduplication passed\n";
}
