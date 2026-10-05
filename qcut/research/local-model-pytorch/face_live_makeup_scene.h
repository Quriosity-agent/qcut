#pragma once
#include <cstddef>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <vector>

namespace qcut_live {
constexpr uintptr_t kMakeupV2Table = 0x35e6378;
constexpr uintptr_t kMakeupV2Update = 0x9ea110;

struct MakeupInventory {
  size_t scenes = 0;
  size_t systems = 0;
  std::vector<uintptr_t> makeup;
};

struct FaceSystemInventory {
  size_t scenes = 0;
  size_t systems = 0;
  std::vector<uintptr_t> matched;
};

inline size_t recordCount(uintptr_t begin, uintptr_t end, size_t maximum) {
  if (!begin && !end) return 0;
  constexpr size_t stride = 0x58;
  if (begin < 4096 || begin % 8 || end < begin || end % 8 ||
      end - begin > maximum * stride || (end - begin) % stride)
    throw std::runtime_error("unverified makeup record span");
  return (end - begin) / stride;
}

template <typename Read, typename Offset, typename Scene>
FaceSystemInventory inspectFaceSystemScenes(uintptr_t feature, uintptr_t tableOffset,
    uintptr_t updateOffset, Read read, Offset offset, Scene sceneAt) {
  const auto pointer = [&](uintptr_t address) {
    uintptr_t value = 0;
    if (address < 4096 || address % 8 || !read(address, &value, sizeof(value)))
      throw std::runtime_error("unreadable makeup pointer");
    return value;
  };
  const auto checkedObject = [](uintptr_t object) {
    if (object < 4096 || object % 8 || object > UINTPTR_MAX - 0x400)
      throw std::runtime_error("invalid makeup object address");
  };
  checkedObject(feature);
  const auto begin = pointer(feature + 0x2e8), end = pointer(feature + 0x2f0);
  const size_t count = recordCount(begin, end, 32);
  FaceSystemInventory inventory;
  std::set<uintptr_t> seenScenes, seenSystems;
  for (size_t index = 0; index < count; ++index) {
    const auto scene = pointer(begin + index * 0x58 + 0x20);
    if (!scene) continue;
    checkedObject(scene);
    if (sceneAt(feature, static_cast<int>(index)) != scene)
      throw std::runtime_error("makeup scene getter disagrees with pinned records");
    if (!seenScenes.insert(scene).second) continue;
    ++inventory.scenes;
    const auto systems = pointer(scene + 0xb0), systemsEnd = pointer(scene + 0xb8);
    const size_t systemCount = recordCount(systems, systemsEnd, 256);
    for (size_t systemIndex = 0; systemIndex < systemCount; ++systemIndex) {
      const auto system = pointer(systems + systemIndex * 0x58);
      checkedObject(system);
      if (!seenSystems.insert(system).second) continue;
      if (++inventory.systems > 512) throw std::runtime_error("makeup system inventory budget exceeded");
      const auto table = pointer(system);
      checkedObject(table);
      if (offset(table) != tableOffset) continue;
      if (offset(pointer(table + 0xb8)) != updateOffset)
        throw std::runtime_error("unverified makeup update slot");
      inventory.matched.push_back(system);
    }
  }
  return inventory;
}

template <typename Read, typename Offset, typename Scene>
MakeupInventory inspectMakeupScenes(uintptr_t feature, Read read, Offset offset, Scene sceneAt) {
  const auto inventory = inspectFaceSystemScenes(feature, kMakeupV2Table, kMakeupV2Update,
      read, offset, sceneAt);
  return {inventory.scenes, inventory.systems, inventory.matched};
}
}
