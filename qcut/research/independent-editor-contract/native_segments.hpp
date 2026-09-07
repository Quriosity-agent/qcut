#pragma once

#include "native_keyframes.hpp"

namespace editor_probe {

class SegmentFactories {
 public:
  explicit SegmentFactories(const Library& library) : library_(library) {}

  KeyframeHandle video() const {
    // The verified null-Draft branch owns construction of the complete detached object tree.
    auto result = entry<KeyframeHandle (*)(const KeyframeHandle&)>(library_, 0x3014cac)({});
    if (!result) throw std::runtime_error("Native SegmentVideo factory returned no object");
    return result;
  }

  KeyframeHandle range(std::int64_t start, std::int64_t duration) const {
    auto result = entry<KeyframeHandle (*)(std::int64_t, std::int64_t)>(library_, 0x1e6e2c4)(start, duration);
    if (!result) throw std::runtime_error("Native TimeRange factory returned no object");
    return result;
  }

  void set_source_range(const KeyframeHandle& segment, const KeyframeHandle& range) const {
    entry<void (*)(void*, const KeyframeHandle&)>(library_, 0x137ddf8)(segment.get(), range);
  }

  void set_target_range(const KeyframeHandle& segment, const KeyframeHandle& range) const {
    entry<void (*)(void*, const KeyframeHandle&)>(library_, 0x122127c)(segment.get(), range);
  }

  KeyframeHandle speed(const KeyframeHandle& segment) const {
    return entry<const KeyframeHandle& (*)(void*)>(library_, 0x137e6b4)(segment.get());
  }

  void set_offset(const KeyframeHandle& segment, std::int64_t offset) const {
    entry<void (*)(void*, const std::int64_t&)>(library_, 0x122150c)(segment.get(), offset);
  }

  void set_constant_speed(const KeyframeHandle& segment, double factor) const {
    const auto material = speed(segment);
    if (!material) throw std::runtime_error("Native SegmentVideo has no MaterialSpeed");
    const std::int32_t mode = 0;
    entry<void (*)(void*, const std::int32_t&)>(library_, 0x10522b0)(material.get(), mode);
    entry<void (*)(void*, const double&)>(library_, 0x10522f0)(material.get(), factor);
  }

 private:
  Library library_;
};

}  // namespace editor_probe
