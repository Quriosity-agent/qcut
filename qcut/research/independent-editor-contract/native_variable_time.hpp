#pragma once

#include "native_segments.hpp"
#include "variable_time.hpp"

#include <cstring>

namespace editor_probe {
struct SpeedPointArgument {
  std::array<std::byte, 32> unused_prefix{};
  double x;
  double y;
};
static_assert(sizeof(SpeedPointArgument) == 48 && offsetof(SpeedPointArgument, x) == 32);

class NativeVariableTime {
 public:
  NativeVariableTime(const Library& editor, const Library& creator,
      std::span<const editor_contract::SpeedControlPoint> points, std::int64_t duration)
      : editor_(editor) {
    const editor_contract::VariableSpeedCurve validated(points);
    if (duration <= 0) throw std::invalid_argument("Native variable-speed duration must be positive");
    std::vector<float> x, y;
    for (const auto& point : points) {
      x.push_back(static_cast<float>(point.source_fraction));
      y.push_back(static_cast<float>(point.speed));
    }
    void* raw = entry<void* (*)()>(editor_, 0x2d2574c)();
    if (!raw) throw std::runtime_error("Native curve utility factory returned no object");
    utility_ = KeyframeHandle(raw, [editor](void* object) { entry<void (*)(void*)>(editor, 0x2d2594c)(object); });
    verify_table(raw, editor_.base + 0x4d03210);
    void* child = nullptr;
    std::memcpy(&child, static_cast<const std::byte*>(raw) + 0x18, sizeof(child));
    verify_table(child, creator.base + 0x36a69b8);
    void* engine = nullptr;
    std::memcpy(&engine, static_cast<const std::byte*>(child) + 0x10, sizeof(engine));
    verify_table(engine, creator.base + 0x375e780);
    normalized_ = entry<std::vector<float> (*)(void*, const std::vector<float>&, const std::vector<float>&)>(editor_, 0x2d25960)(raw, x, y);
    const auto status = entry<int (*)(void*, const std::vector<float>&, const std::vector<float>&)>(editor_, 0x2d25998)(raw, x, y);
    if (status != 0) throw std::runtime_error("Native curve utility rejected the curve");
    entry<void (*)(void*, const std::int64_t&)>(editor_, 0x2d25b8c)(raw, duration);
  }
  const std::vector<float>& sequence_points() const { return normalized_; }
  std::int64_t sequence_to_source(std::int64_t query) const {
    return entry<std::int64_t (*)(void*, std::int64_t)>(editor_, 0x2d25be0)(utility_.get(), query);
  }
  std::int64_t source_to_sequence(std::int64_t query) const {
    return entry<std::int64_t (*)(void*, std::int64_t)>(editor_, 0x2d25bfc)(utility_.get(), query);
  }

  KeyframeHandle make_curve(std::span<const editor_contract::SpeedControlPoint> points) const {
    const editor_contract::VariableSpeedCurve validated(points);
    const std::string identifier = "qcut-synthetic-variable-time", name = "Original probe curve";
    std::vector<SpeedPointArgument> arguments;
    for (const auto& point : points) arguments.push_back({{}, point.source_fraction, point.speed});
    auto curve = entry<KeyframeHandle (*)(const std::string&, const std::string&, const std::vector<SpeedPointArgument>&, int)>(editor_, 0x1e72f48)(identifier, name, arguments, 0);
    if (!curve) throw std::runtime_error("Native CurveSpeed factory returned no object");
    const auto& native_points = entry<const KeyframeList& (*)(void*)>(editor_, 0xccea28)(curve.get());
    if (native_points.size() != points.size()) throw std::runtime_error("Native CurveSpeed point count differs");
    for (std::size_t i = 0; i < native_points.size(); ++i) {
      const double x = entry<const double& (*)(void*)>(editor_, 0x14201f0)(native_points[i].get());
      const double y = entry<const double& (*)(void*)>(editor_, 0x1420240)(native_points[i].get());
      if (x != points[i].source_fraction || y != points[i].speed) throw std::runtime_error("Native CurveSpeed factory values differ");
    }
    return curve;
  }
  void attach(const KeyframeHandle& segment, const KeyframeHandle& curve) const {
    const auto material = SegmentFactories(editor_).speed(segment);
    if (!material) throw std::runtime_error("Native Video has no MaterialSpeed");
    entry<void (*)(void*, const KeyframeHandle&)>(editor_, 0x1052340)(material.get(), curve);
    const std::int32_t mode = 1;
    entry<void (*)(void*, const std::int32_t&)>(editor_, 0x10522b0)(material.get(), mode);
  }

 private:
  static void verify_table(const void* object, const void* expected) {
    if (!object) throw std::runtime_error("Native variable-time dependency is null");
    const void* table = nullptr;
    std::memcpy(&table, object, sizeof(table));
    if (table != expected) throw std::runtime_error("Unknown native variable-time vtable");
  }
  Library editor_;
  KeyframeHandle utility_;
  std::vector<float> normalized_;
};
}  // namespace editor_probe
