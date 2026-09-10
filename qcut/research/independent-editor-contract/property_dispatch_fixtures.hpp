#pragma once

#include "property_dispatch.hpp"
#include "test_support.hpp"
#include "wrapped_time.hpp"

#include <array>
#include <bit>
#include <cstdint>
#include <vector>

namespace editor_test {

struct DispatchFrameData {
  std::int64_t time = 0;
  std::vector<double> values;
  std::int32_t curve_type = 0;
  editor_contract::ControlOffset incoming{};
  editor_contract::ControlOffset outgoing{};
};

struct DispatchFixture {
  editor_contract::ConstantSpeedSegment segment{};
  std::vector<DispatchFrameData> frames;
  std::vector<editor_contract::KeyframeWindow> designed;
  // Views borrow the fixture's value storage; the fixture must outlive every produced span.
  std::vector<editor_contract::DispatchKeyframe> view() const {
    std::vector<editor_contract::DispatchKeyframe> result;
    result.reserve(frames.size());
    for (const auto& frame : frames) {
      result.push_back({{frame.time, frame.values, frame.curve_type, frame.incoming, frame.outgoing}, false});
    }
    return result;
  }
};

inline constexpr std::size_t kDispatchShapes = 12;
inline constexpr std::size_t kDispatchConfigs = 32;
// Each shape names the segment that reaches its designed branch; other configs cross the rest.
inline constexpr std::array<std::size_t, kDispatchShapes> kDispatchShapeSegment{0, 5, 1, 2, 0, 0, 4, 0, 0, 6, 0, 3};

inline editor_contract::ConstantSpeedSegment dispatch_segment(std::size_t index) {
  switch (index % 8) {
    case 0: return {{1000, 40000}, {5000, 20000}, 2, 300};
    case 1: return {{1000, 40000}, {5000, 5}, 2, 0};        // target far shorter than the speed ratio
    case 2: return {{1000, 40000}, {5000, 1000000}, 2, 0};  // target far longer than the speed ratio
    case 3: return {{0, 8000}, {0, 16000}, .5, -100};
    case 4: return {{2000, 0}, {7000, 0}, 1, 0};
    case 5: return {{1000, 40000}, {5000, 40000}, 1, 0};
    case 6: return {{editor_contract::wrapped_difference(INT64_MAX, 5000), 40000}, {-3000, 20000}, 2, 7};
    default: return {{1000, 40000}, {5000, 20000}, 3.25, -20000};
  }
}

inline std::vector<std::int64_t> dispatch_times(std::size_t shape) {
  switch (shape % kDispatchShapes) {
    case 0: return {2000, 9000, 17000, 26000, 35000};
    case 1: return {10000, 10017};                     // seventeen units apart for a 4/17 progress
    case 2: return {31000, 40500};                     // the right frame snaps to a shorter target
    case 3: return {40500, 50000};                     // the left frame snaps to a longer target
    case 4: return {1200, 1500, 20000};                // two frames snap to the source origin
    case 5: return {20000, 40200, 40500};              // two frames snap to the source end
    case 6: return {0, 1, 2, 3, 4};
    case 7: return {-5000, 0, 12000, 12000, 39000};
    case 8: return {40000, 30000, 20000, 10000, 0};
    case 9: return {INT64_MIN, -1, 0, 1, INT64_MAX};
    case 10: return {1200, 1300};
    default: return {2000, 9000, 17000};
  }
}

inline std::vector<editor_contract::KeyframeWindow> dispatch_designed(std::size_t shape) {
  switch (shape % kDispatchShapes) {
    case 1: return {{10004, 10004}, {10001, 10001}, {10013, 10013}};
    case 2: return {{33000, 33000}, {35000, 35000}, {38000, 38000}, {40000, 40000}};
    case 3: return {{45000, 45000}, {44000, 46000}};
    case 4: return {{1350, 1350}, {1450, 1450}, {1600, 1600}};
    case 5: return {{30100, 30100}, {40050, 40150}, {40100, 40100}};
    default: return {};
  }
}

inline std::vector<double> dispatch_values(std::size_t shape, std::size_t config, std::size_t index, bool last) {
  const std::size_t channels = 1 + (shape + config) % 4 + (last && config % 7 == 6 ? 1 : 0);
  std::vector<double> values(channels);
  for (std::size_t channel = 0; channel < channels; ++channel) {
    switch (config % 5) {
      case 3: values[channel] = channel % 2 == 0 ? -0.0 : 0.0; break;
      case 4: values[channel] = std::bit_cast<double>(
                  kDoubleBits[(shape + config + index + channel) % kDoubleBits.size()]); break;
      default: values[channel] = (config % 5 == 2 ? .1 : 1.) * static_cast<double>(index + 1) +
                   static_cast<double>(channel) * (config % 5 == 1 ? -.25 : .5);
    }
  }
  // The seventeen-unit shape keeps the recorded .1 to .9 endpoints that separate fused arithmetic.
  if (shape % kDispatchShapes == 1) values.front() = index == 0 ? .1 : .9;
  return values;
}

inline std::int32_t dispatch_curve(std::size_t shape, std::size_t config, std::size_t index) {
  switch (config % 4) {
    case 0: return 0;
    case 1: return index % 2 == 0 ? 0 : 3;
    case 2: return 5;
    default: return (shape + index) % 3 == 0 ? 7 : 0;
  }
}

inline editor_contract::ControlOffset dispatch_control(std::size_t config, std::size_t index, bool outgoing) {
  const double magnitude = static_cast<double>(index + 1) * (config % 3 == 0 ? 250. : 1200.);
  if (outgoing) return {magnitude, .25 + static_cast<double>(config % 4) * .1};
  return {-magnitude, -.3 + static_cast<double>(index) * .05};
}

inline DispatchFixture dispatch_fixture(std::size_t shape, std::size_t config) {
  DispatchFixture result;
  result.segment = dispatch_segment(config / 8 == 0 ? kDispatchShapeSegment[shape % kDispatchShapes] : config % 8);
  result.designed = dispatch_designed(shape);
  const auto times = dispatch_times(shape);
  const std::size_t count = 1 + (config / 4) % times.size();
  for (std::size_t index = 0; index < count; ++index) {
    result.frames.push_back({times[index], dispatch_values(shape, config, index, index + 1 == count),
        dispatch_curve(shape, config, index), dispatch_control(config, index, false),
        dispatch_control(config, index, true)});
  }
  return result;
}

inline std::vector<editor_contract::KeyframeWindow> dispatch_windows(const DispatchFixture& fixture) {
  using editor_contract::KeyframeWindow;
  std::vector<KeyframeWindow> windows{{0, 0}, {-1, 1}, {1, -1}, {INT64_MIN, INT64_MIN},
      {INT64_MAX, INT64_MAX}, {INT64_MIN, INT64_MAX}, {-100000, -99000}, {900000, 910000}};
  for (const auto& frame : fixture.frames) {
    windows.push_back({frame.time, frame.time});
    windows.push_back({editor_contract::wrapped_difference(frame.time, 1000),
                       editor_contract::wrapped_sum(frame.time, 1000)});
    windows.push_back({editor_contract::wrapped_difference(frame.time, 1),
                       editor_contract::wrapped_difference(frame.time, 1)});
    windows.push_back({editor_contract::wrapped_sum(frame.time, 1), editor_contract::wrapped_sum(frame.time, 1)});
  }
  for (std::size_t i = 1; i < fixture.frames.size(); ++i) {
    const auto middle = editor_contract::wrapped_midpoint(fixture.frames[i - 1].time, fixture.frames[i].time);
    windows.push_back({middle, middle});
    windows.push_back({editor_contract::wrapped_difference(middle, 1), editor_contract::wrapped_difference(middle, 1)});
    windows.push_back({editor_contract::wrapped_sum(middle, 1), editor_contract::wrapped_sum(middle, 1)});
  }
  for (const auto window : fixture.designed) windows.push_back(window);
  return windows;
}

}  // namespace editor_test
