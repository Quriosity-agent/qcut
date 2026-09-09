#include "variable_property.hpp"
#include "variable_time_fixtures.hpp"
#include "test_support.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <array>
#include <bit>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace editor_contract;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
template <class Action> void rejects(Action action) {
  try { action(); } catch (const std::invalid_argument&) { return; }
  throw std::runtime_error("Expected invalid argument rejection");
}
void constant_curve() {
  const std::array points{SpeedControlPoint{0, 2}, SpeedControlPoint{1, 2}};
  const VariableSpeedCurve curve(points);
  require(curve.sequence_to_source(500000, 2000000) == 1000000, "constant integral");
  require(curve.source_to_sequence(1000000, 2000000) == 500000, "constant inverse");
  require(curve.source_to_sequence(1, 2000000) == 1, "half rounds upwards");
  require(curve.sequence_to_source(-1, 2000000) == 0, "negative curve query clamps");
  require(curve.sequence_to_source(3000000, 2000000) == 4000000, "curve integral stops at last point");
  require(curve.source_to_sequence(INT64_MAX, 2000000) == 2000000, "inverse clamps to duration");
}
void nonconstant_golden() {
  const std::array points{SpeedControlPoint{0, 1}, SpeedControlPoint{.3, 3}, SpeedControlPoint{1, .5}};
  const VariableSpeedCurve curve(points);
  require(std::bit_cast<std::uint32_t>(curve.sequence_points()[1]) == 0x3e8ba2e9U, "float cumulative normalization");
  constexpr std::array<std::int64_t, 5> queries{0, 100000, 500000, 1000000, 2000000};
  constexpr std::array<std::int64_t, 5> forward{0, 108947, 956394, 2349630, 3636364};
  constexpr std::array<std::int64_t, 5> inverse{0, 92366, 328607, 514873, 862641};
  for (std::size_t i = 0; i < queries.size(); ++i) {
    require(curve.sequence_to_source(queries[i], 2000000) == forward[i], "three-part speed integral golden");
    require(curve.source_to_sequence(queries[i], 2000000) == inverse[i], "quadratic inverse golden");
  }
  require(curve.sequence_to_source(500000, 2000000) != 909091, "whole-curve average is not local integration");
}
void records_and_timeline() {
  const std::array points{SpeedControlPoint{0, 2}, SpeedControlPoint{1, 2}};
  const VariableSpeedCurve curve(points);
  const VariableSpeedSegment segment{{100000, 4000000}, {5000000, 2000000}, 3, 50};
  require(variable_keyframe_to_timeline(curve, segment, 101001) == 5000501, "curve mapper rounds instead of truncating");
  require(variable_keyframe_to_timeline(curve, segment, 100999) == 5000000, "timeline endpoint snap");
  require(variable_keyframe_to_timeline(curve, segment, 97000) == 4999000, "negative raw delta uses material speed");
  require(variable_timeline_to_keyframe(curve, segment, 4999000) == 97000, "negative inverse uses material speed");
  require(variable_keyframe_to_relative_sequence(curve, segment, 102000) == 950, "relative sequence offset");
  const ControlTimeRecord input{102001, {999.9, -0.0}, {-1000.1, 7}};
  const auto result = resolve_variable_speed_record(curve, segment.source, segment.target.duration, input);
  require(result.time == 1001 && result.left.time == 999.9 && result.right.time == -501, "control threshold uses truncated absolute offset");
  require(std::signbit(result.left.value), "control value bits retained");
  const auto boundary = resolve_variable_speed_record(curve, segment.source, segment.target.duration,
      {102001, {1000, 2}, {-1000, 3}});
  require(boundary.left.time == 500 && boundary.right.time == -500, "exact 1000 control threshold is active");
  const auto before = resolve_variable_speed_record(curve, segment.source, segment.target.duration, {99999, {3000, 2}, {2000, 3}});
  require(before.time == 0 && before.left.time == 0 && before.right.time == 1000, "before source handles controls separately");
  const auto after = resolve_variable_speed_record(curve, segment.source, segment.target.duration, {4100001, {-2000, 2}, {3000, 3}});
  require(after.time == 2000000 && after.left.time == 0 && after.right.time == 0, "after source uses raw negative control mapping");
  const auto wrapped = resolve_variable_speed_record(curve, {INT64_MAX, 4000000}, 2000000,
      {wrapped_sum(INT64_MAX, 2000), {0, 0}, {0, 0}});
  require(wrapped.time == 1000, "record source subtraction wraps");
}
void invalid_domains() {
  const std::array valid{SpeedControlPoint{0, 1}, SpeedControlPoint{1, 2}};
  const VariableSpeedCurve curve(valid);
  rejects([&] { curve.sequence_to_source(1, 0); });
  rejects([&] { curve.source_to_sequence(1, -1); });
  for (const auto bad : {0.0, -1.0, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
    auto points = valid; points[1].speed = bad;
    rejects([&] { VariableSpeedCurve rejected(points); });
  }
  const std::array duplicate{SpeedControlPoint{0, 1}, SpeedControlPoint{.5, 1}, SpeedControlPoint{.5 + 0x1p-40, 2}, SpeedControlPoint{1, 1}};
  rejects([&] { VariableSpeedCurve rejected(duplicate); });
  const std::array shifted{SpeedControlPoint{.1, 1}, SpeedControlPoint{1, 2}};
  rejects([&] { VariableSpeedCurve rejected(shifted); });
  for (const auto bad : {std::numeric_limits<double>::denorm_min(), std::numeric_limits<double>::max()}) {
    auto points = valid; points[0].speed = bad;
    rejects([&] { VariableSpeedCurve rejected(points); });
  }
  auto points = valid; points[0].source_fraction = std::numeric_limits<double>::quiet_NaN();
  rejects([&] { VariableSpeedCurve rejected(points); });
  const std::vector<SpeedControlPoint> excessive(4097, {0, 1});
  bool limited = false;
  try { VariableSpeedCurve rejected(excessive); } catch (const std::length_error&) { limited = true; }
  require(limited, "point budget must reject before allocation/iteration");
  const std::array left_values{0.0}, right_values{1.0};
  const NonlinearPropertyInterval interval{{10000, left_values, 1, {}, {}}, {3990000, right_values, 1, {}, {}}};
  rejects([&] { evaluate_variable_property_interval(curve, {{0, -1}, {0, 2000000}, 1, 0}, interval, 2000000); });
  rejects([&] { evaluate_variable_property_interval(curve, {{0, 4000000}, {0, 2000000}, 0, 0}, interval, 2000000); });
}

void portable_native_matrix() {
  std::uint64_t fingerprint = editor_test::kFnvStart;
  for (std::size_t config = 0; config < 48; ++config) {
    const VariableSpeedCurve curve(editor_test::variable_curve(config));
    for (const auto duration : editor_test::kVariableDurations) {
      for (const auto query : editor_test::variable_queries(curve, duration)) {
        editor_test::hash_integer(fingerprint, static_cast<std::uint64_t>(curve.sequence_to_source(query, duration)), 8);
        editor_test::hash_integer(fingerprint, static_cast<std::uint64_t>(curve.source_to_sequence(query, duration)), 8);
      }
    }
  }
  require(fingerprint == 13960850192421931186ULL, "Native forward/inverse matrix fingerprint differs");
}

void property_midpoint() {
  const std::array points{SpeedControlPoint{0, 2}, SpeedControlPoint{1, 2}};
  const VariableSpeedCurve curve(points);
  const VariableSpeedSegment segment{{0, 4000000}, {0, 2000000}, 2, 0};
  const std::array left_values{0.0, -8.0}, right_values{1.0, 4.0};
  const NonlinearPropertyInterval interval{{10000, left_values, 1, {}, {}}, {3990000, right_values, 2, {}, {}}};
  const auto result = evaluate_variable_property_interval(curve, segment, interval, 2000000);
  require(result == std::vector<double>{.5, -2}, "Constant curve midpoint with zero control offsets");
  rejects([&] { evaluate_variable_property_interval(curve, segment, interval, 10000); });
  rejects([&] { evaluate_variable_property_interval(curve, segment, interval, 3990000); });
}
}
int main() {
  try { constant_curve(); nonconstant_golden(); records_and_timeline(); invalid_domains(); portable_native_matrix(); property_midpoint();
    std::cout << "PASS 6 variable-time test groups\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
