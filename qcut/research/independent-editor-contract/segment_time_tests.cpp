#include "segment_time.hpp"
#include "test_support.hpp"

#include <array>
#include <cmath>
#include <iostream>
#include <limits>

namespace {
using namespace editor_contract;
using editor_test::require;

void test_endpoint_mapping_and_noninvertibility() {
  const ConstantSpeedSegment segment{{100000, 2000000}, {5000000, 1000000}, 2};
  const std::array<std::int64_t, 9> input{98999, 99000, 99001, 100000, 100999, 101000, 101001, 1100000, 2100000};
  const std::array<std::int64_t, 9> expected{4999500, 4999500, 5000000, 5000000, 5000000, 5000500, 5000500, 5500000, 6000000};
  for (std::size_t i = 0; i < input.size(); ++i) {
    require(keyframe_time_to_timeline(segment, input[i]) == expected[i], "Strict 1000 endpoint tolerance or truncation changed");
  }
  require(timeline_to_keyframe_time(segment, 5000500) == 100000, "Round trip incorrectly bypassed endpoint snap");
  require(keyframe_time_to_timeline(segment, 3100000) == 6500000, "Timeline mapping clamped beyond end");
  require(timeline_to_keyframe_time(segment, 6500000) == 3100000, "Inverse mapping clamped beyond end");
  const ConstantSpeedSegment inconsistent{{0, 2000}, {0, 3000}, 2};
  require(keyframe_time_to_timeline(inconsistent, 2000) == 3000, "Endpoint ignored authoritative target duration");
  require(keyframe_time_to_timeline(inconsistent, 1000) == 500, "Exactly 1000 distance snapped");
  require(keyframe_time_to_timeline(inconsistent, 1001) == 3000, "999 end distance failed to snap");
  require(keyframe_time_to_timeline({{0, 1500}, {0, 750}, 2}, 750) == 0, "Overlapping tolerances did not prioritize start");
}

void test_record_clamp_and_control_residual() {
  const ConstantSpeedSegment segment{{100000, 2000000}, {5000000, 1000000}, 2, 700};
  const auto result = resolve_constant_speed_record(segment, {101001, {5, -0.0}, {-3, 7}});
  require(result.time == 500 && result.left.time == 3 && result.right.time == -1, "Control residual lost integer truncation remainder");
  require(std::signbit(result.left.value) && result.right.value == 7, "Time mapping changed control values");
  require(resolve_constant_speed_record(segment, {98999, {5, 0}, {-3, 0}}).time == 0,
          "Record before source start was extrapolated");
  require(resolve_constant_speed_record(segment, {3100000, {0, 0}, {0, 0}}).time == 1000000,
          "Record past source end was extrapolated");
  const auto residual = resolve_constant_speed_record(segment, {101001, {0, 0}, {0, 0}});
  require(residual.left.time == .5 && residual.right.time == .5, "Zero control failed to retain half-unit residual");
  require(keyframe_time_to_relative_sequence(segment, 1100000) == 499300, "Relative sequence offset was ignored");
  require(keyframe_time_to_timeline(segment, 1100000) == 5500000, "Video timeline helper incorrectly added Segment offset");
  const auto nonfinite = resolve_constant_speed_record(segment, {101001, {INFINITY, NAN}, {-INFINITY, -0.0}});
  require(std::isinf(nonfinite.left.time) && std::isnan(nonfinite.left.value) &&
      std::signbit(nonfinite.right.time) && std::signbit(nonfinite.right.value), "IEEE control values were repaired");
}

void test_wrap_saturation_and_input_domain() {
  constexpr auto low = std::numeric_limits<std::int64_t>::min();
  constexpr auto high = std::numeric_limits<std::int64_t>::max();
  require(keyframe_time_to_timeline({{high, 100000}, {7, 50000}, 2}, low) == 7,
          "Source subtraction did not wrap before near-zero test");
  const ConstantSpeedSegment tiny{{0, 100000}, {100, 100000}, 0x1p-1074};
  require(keyframe_time_to_timeline(tiny, 2000) == low + 99, "Positive FCVTZS saturation or final sum wrap differs");
  require(keyframe_time_to_timeline(tiny, -2000) == low + 100, "Negative FCVTZS saturation differs");
  require(resolve_constant_speed_record(tiny, {2000, {0, 0}, {0, 0}}).time == high,
          "Record saturation differs");
  const ConstantSpeedSegment enormous{{0, 100000}, {0, 100000}, 0x1.fffffffffffffp1023};
  require(timeline_to_keyframe_time(enormous, 2000) == high, "Overflowed multiplication did not saturate");
  require(timeline_to_keyframe_time(enormous, -2000) == low, "Negative multiplication did not saturate");
  for (const auto speed : {0.0, -0.0, -1.0, INFINITY * 1.0, NAN * 1.0}) {
    bool rejected = false;
    try { static_cast<void>(keyframe_time_to_timeline({{0, 1}, {0, 1}, speed}, 0)); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Unsupported speed was silently repaired");
  }
  for (const auto source : {true, false}) {
    auto segment = ConstantSpeedSegment{{0, 1}, {0, 1}, 1};
    (source ? segment.source : segment.target).duration = -1;
    bool rejected = false;
    try { static_cast<void>(resolve_constant_speed_record(segment, {0, {0, 0}, {0, 0}})); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Negative duration was accepted outside the verified domain");
  }
}
}  // namespace

int main() {
  try {
    test_endpoint_mapping_and_noninvertibility();
    test_record_clamp_and_control_residual();
    test_wrap_saturation_and_input_domain();
    std::cout << "3 Segment constant-time groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
