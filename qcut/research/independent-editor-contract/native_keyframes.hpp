#pragma once

#include "native_library.hpp"
#include "time_adapter.hpp"

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
  std::int32_t curve(const KeyframeHandle& frame) const {
    return entry<const std::int32_t& (*)(void*)>(library_, 0xc7df70)(frame.get());
  }
  void set_curve(const KeyframeHandle& frame, std::int32_t curve_type) const {
    entry<void (*)(void*, const std::int32_t&)>(library_, 0xc7df78)(frame.get(), curve_type);
  }
  const std::vector<double>& values(const KeyframeHandle& frame) const {
    return entry<const std::vector<double>& (*)(void*)>(library_, 0xc7e1b8)(frame.get());
  }
  void set_values(const KeyframeHandle& frame, const std::vector<double>& values) const {
    entry<void (*)(void*, const std::vector<double>&)>(library_, 0xc7e1c8)(frame.get(), values);
  }
  bool has_graph(const KeyframeHandle& frame) const {
    return static_cast<bool>(entry<const KeyframeHandle& (*)(void*)>(library_, 0xc7e508)(frame.get()));
  }
  editor_contract::ControlOffset control(const KeyframeHandle& frame, bool outgoing) const {
    const auto point = control_point(frame, outgoing);
    return {entry<const double& (*)(void*)>(library_, 0xc8eba4)(point.get()),
            entry<const double& (*)(void*)>(library_, 0xc8ebf4)(point.get())};
  }
  void set_control(const KeyframeHandle& frame, bool outgoing, editor_contract::ControlOffset control) const {
    const auto point = control_point(frame, outgoing);
    const auto set_x = entry<void (*)(void*, const double&)>(library_, 0xc8ebac);
    const auto set_y = entry<void (*)(void*, const double&)>(library_, 0xc8ebfc);
    // Equal-value setters preserve old zero bits; seed a distinct value before requesting -0.
    const double seed = 1;
    set_x(point.get(), seed);
    set_y(point.get(), seed);
    set_x(point.get(), control.time);
    set_y(point.get(), control.value);
  }
  static const KeyframeTypeKey& type_key() {
    static const KeyframeTypeKey key{"qcut-window-probe", "synthetic-only"};
    return key;
  }

 private:
  KeyframeHandle control_point(const KeyframeHandle& frame, bool outgoing) const {
    auto point = entry<const KeyframeHandle& (*)(void*)>(library_, outgoing ? 0xc7e0d4 : 0xc7dff0)(frame.get());
    if (!point) throw std::runtime_error("Native keyframe has no control point");
    return point;
  }
  Library library_;
};

}  // namespace editor_probe
