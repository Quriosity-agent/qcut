#include "variable_time.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

namespace editor_contract {
namespace {
bool remap_control(double offset) {
  const auto integral = truncate_time(offset);
  const auto magnitude = integral < 0 ? wrapped_difference(0, integral) : integral;
  return static_cast<std::uint64_t>(magnitude) >= 1000;
}
}

ControlTimeRecord resolve_variable_speed_record(const VariableSpeedCurve& curve,
    SegmentTimeRange source, std::int64_t duration, const ControlTimeRecord& input) {
  if (source.duration < 0 || duration <= 0) throw std::invalid_argument("Invalid variable-speed range duration");
  auto result = input;
  const auto relative = wrapped_difference(input.time, source.start);
  if (relative < 0) {
    result.time = 0;
    result.left.time = 0;
    if (remap_control(input.right.time)) result.right.time = static_cast<double>(curve.source_to_sequence(truncate_time(input.right.time), duration));
    return result;
  }
  if (relative > source.duration) {
    result.time = duration;
    result.right.time = 0;
    if (remap_control(input.left.time)) result.left.time = static_cast<double>(curve.source_to_sequence(truncate_time(input.left.time), duration));
    return result;
  }
  result.time = curve.source_to_sequence(relative, duration);
  for (auto* control : {&result.left, &result.right}) {
    if (!remap_control(control->time)) continue;
    const auto source_time = truncate_time(control->time + static_cast<double>(relative));
    control->time = static_cast<double>(wrapped_difference(curve.source_to_sequence(source_time, duration), result.time));
  }
  return result;
}
}  // namespace editor_contract
