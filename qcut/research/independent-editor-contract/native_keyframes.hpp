#pragma once

#include "native_library.hpp"

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace editor_probe {

using KeyframeHandle = std::shared_ptr<void>;
using KeyframeList = std::vector<KeyframeHandle>;

// Only this value-parameter layout is mirrored; SDK models/control blocks come from factories.
struct KeyframeTypeKey {
  std::string property;
  std::string material;
};
static_assert(sizeof(std::string) == 24 && sizeof(KeyframeTypeKey) == 48);
static_assert(offsetof(KeyframeTypeKey, material) == 24);
static_assert(sizeof(KeyframeHandle) == 16 && sizeof(KeyframeList) == 24);

class KeyframeFactories {
 public:
  explicit KeyframeFactories(const Library& library) : library_(library) {}

  KeyframeHandle group() const {
    const auto create = entry<KeyframeHandle (*)(KeyframeHandle, const KeyframeTypeKey&)>(library_, 0x340a010);
    auto result = create({}, type_key());
    if (!result) throw std::runtime_error("Native group factory returned no object");
    return result;
  }

  KeyframeHandle frame(std::int64_t time, double value) const {
    const auto create = entry<void (*)(KeyframeHandle&, std::int64_t, double)>(library_, 0x2af2edc);
    KeyframeHandle result;
    create(result, time, value);
    if (!result) throw std::runtime_error("Native keyframe factory returned no object");
    return result;
  }

  void set_list(const KeyframeHandle& group, const KeyframeList& frames) const {
    entry<void (*)(void*, const KeyframeList&)>(library_, 0xc8412c)(group.get(), frames);
  }
  const KeyframeList& list(const KeyframeHandle& group) const {
    return entry<const KeyframeList& (*)(void*)>(library_, 0xc84118)(group.get());
  }
  std::int64_t time(const KeyframeHandle& frame) const {
    return entry<const std::int64_t& (*)(void*)>(library_, 0xc7dfb0)(frame.get());
  }
  static const KeyframeTypeKey& type_key() {
    static const KeyframeTypeKey key{"qcut-window-probe", "synthetic-only"};
    return key;
  }

 private:
  Library library_;
};

}  // namespace editor_probe
