#include "time_adapter.hpp"
#include "test_support.hpp"

#include <bit>
#include <cmath>
#include <iostream>
#include <limits>

namespace {
using editor_contract::CubicInterval;
using editor_contract::prepare_cubic_interval;
using editor_test::require;

editor_contract::PreparedCubic prepare_same_interval(const CubicInterval& interval, std::int64_t query) {
  return prepare_cubic_interval(interval, {interval.left_time, interval.right_time, query});
}

void test_offsets_and_normalized_progress() {
  const CubicInterval input{100, 300, 2, 8, {50, 3}, {-50, -2}};
  const auto result = prepare_same_interval(input, 150);
  const auto& p = result.curve.points;
  require(result.progress == .25F, "Query was treated as absolute progress");
  require(p[0].time == 100 && p[0].value == 2 && p[1].time == 150 && p[1].value == 5 &&
          p[2].time == 250 && p[2].value == 6 && p[3].time == 300 && p[3].value == 8,
          "Control offsets were applied to the wrong endpoint");
  require(prepare_same_interval(input, 100).progress == 0, "Left endpoint differs");
  require(prepare_same_interval(input, 300).progress == 1, "Right endpoint differs");
  require(prepare_same_interval(input, 500).progress == 2, "Adapter silently clamped progress");
  const auto separate = prepare_cubic_interval(input, {1000, 2000, 1750});
  require(separate.progress == .75F && separate.curve.points[0].time == 100 &&
          separate.curve.points[3].time == 300, "Progress bounds were conflated with resolved record coordinates");
}

void test_double_addition_before_float_narrowing() {
  const CubicInterval input{16777217, 16777225, 16777217, 16777225, {1, 1}, {-1, -1}};
  const auto result = prepare_same_interval(input, 16777219);
  const auto& p = result.curve.points;
  require(p[0].time == 16777216 && p[0].value == 16777216, "Endpoint float rounding differs");
  require(p[1].time == 16777218 && p[1].value == 16777218, "Offset was added after premature float conversion");
  require(p[2].time == 16777224 && p[2].value == 16777224, "Incoming control rounding differs");
  require(result.progress == .25F, "Progress was computed from rounded float endpoints");
  const std::int64_t large = 9007199791611905LL;
  const auto narrowed = prepare_same_interval({large, large + 8, 0, 1, {0, 0}, {0, 0}}, large + 2);
  require(std::bit_cast<std::uint32_t>(narrowed.curve.points[0].time) == 0x5a000000U,
          "int64 to double to float rounding was replaced by direct int64 to float");
}

void test_overflow_and_ieee_boundaries() {
  constexpr auto low = std::numeric_limits<std::int64_t>::min();
  constexpr auto high = std::numeric_limits<std::int64_t>::max();
  const auto wrapped = prepare_same_interval({high - 4, low + 5, 0, 1, {0, 0}, {0, 0}}, low);
  require(wrapped.progress == .5F, "Integer duration/query delta was widened instead of wrapped");
  const CubicInterval same{5, 5, -0., 0., {0, 0}, {0, 0}};
  require(std::isnan(prepare_same_interval(same, 5).progress), "Coincident times did not retain zero division");
  require(std::isinf(prepare_same_interval(same, 6).progress), "Outside coincident query was repaired");
  require(std::signbit(prepare_same_interval(same, 5).curve.points[0].value), "Endpoint signed zero lost");
  const auto nonfinite = prepare_same_interval({0, 1, INFINITY, NAN, {0, -INFINITY}, {0, 0}}, 0);
  require(std::isnan(nonfinite.curve.points[1].value) && std::isnan(nonfinite.curve.points[3].value),
          "Nonfinite control arithmetic changed");
}
}  // namespace

int main() {
  try {
    test_offsets_and_normalized_progress();
    test_double_addition_before_float_narrowing();
    test_overflow_and_ieee_boundaries();
    std::cout << "3 time-adapter groups passed (static instruction contract)\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
