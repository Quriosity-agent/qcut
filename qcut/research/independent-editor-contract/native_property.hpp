#pragma once

#include "native_keyframes.hpp"

#include <cstring>

namespace editor_probe {

inline KeyframeHandle hold_cubic_utility(const Library& editor, const Library& creator) {
  auto utility = entry<KeyframeHandle (*)()>(editor, 0x2e877bc)();
  if (!utility) throw std::runtime_error("Property utility factory returned no object");
  const void* vtable;
  const void* cubic;
  std::memcpy(&vtable, utility.get(), sizeof(vtable));
  if (vtable != creator.base + 0x36aced0) throw std::runtime_error("Unknown property utility vtable");
  std::memcpy(&cubic, static_cast<const std::byte*>(vtable) + 0x168, sizeof(cubic));
  if (cubic != creator.base + 0x1d803e8) throw std::runtime_error("Unknown property cubic slot");
  return utility;
}

}  // namespace editor_probe
