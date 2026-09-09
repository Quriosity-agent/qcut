#pragma once

#include "variable_property.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <array>
#include <set>

namespace editor_test {
inline constexpr std::array<std::int64_t, 8> kVariableDurations{2000, 10000, 2000000, 100000000,
    4294967295LL, 5000000000LL, 1000000000000LL, INT64_MAX};

inline std::vector<editor_contract::SpeedControlPoint> variable_curve(std::size_t index) {
  constexpr std::array<std::size_t, 8> counts{2, 3, 4, 7, 16, 17, 33, 65};
  const auto count = counts[index % counts.size()];
  std::vector<editor_contract::SpeedControlPoint> result;
  for (std::size_t i = 0; i < count; ++i) {
    const double x = static_cast<double>(i) / static_cast<double>(count - 1);
    double speed = .125 + static_cast<double>((i * 19 + index * 17) % 127) / 7;
    if (index < 8) speed = .5 + static_cast<double>(index) * .5;
    if (index >= 40) speed *= index % 2 == 0 ? 0x1p-8 : 0x1p8;
    result.push_back({x, speed});
  }
  return result;
}

inline std::vector<std::int64_t> variable_queries(const editor_contract::VariableSpeedCurve& curve,
    std::int64_t duration) {
  std::set<std::int64_t> times{INT64_MIN, INT64_MIN + 1, -1001, -1000, -999, -1, 0, 1, 999, 1000, 1001, INT64_MAX - 1, INT64_MAX};
  auto neighbors = [&](double time) {
    const auto center = editor_contract::truncate_time(time);
    times.insert(editor_contract::wrapped_sum(center, -1)); times.insert(center);
    times.insert(editor_contract::wrapped_sum(center, 1));
  };
  for (std::int32_t i = 0; i <= 256; ++i) neighbors(static_cast<double>(duration) * static_cast<double>(i) / 64);
  for (const auto x : curve.sequence_points()) neighbors(static_cast<double>(duration) * static_cast<double>(x));
  return {times.begin(), times.end()};
}

inline editor_contract::VariableSpeedSegment variable_segment(std::int64_t duration, std::size_t config) {
  return {{static_cast<std::int64_t>(config % 7) * 100003 - 300009, duration - static_cast<std::int64_t>(config % 3) * (duration / 4)},
      {static_cast<std::int64_t>(config % 11) * 200003 - 900007, duration},
      .3 + static_cast<double>(config % 4), static_cast<std::int64_t>(config % 5) * 731 - 1462};
}
}  // namespace editor_test
