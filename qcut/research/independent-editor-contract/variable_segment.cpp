#include "variable_time.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

namespace editor_contract {
namespace {
std::int64_t map_variable_time(const VariableSpeedCurve& curve, const VariableSpeedSegment& segment,
    std::int64_t time, bool to_timeline) {
  if (segment.source.duration < 0 || segment.target.duration <= 0 ||
      !std::isfinite(segment.negative_time_speed) || segment.negative_time_speed <= 0) {
    throw std::invalid_argument("Invalid variable-speed segment ranges or negative-time fallback speed");
  }
  const auto from = to_timeline ? segment.source : segment.target;
  const auto to = to_timeline ? segment.target : segment.source;
  const auto relative = wrapped_difference(time, from.start);
  std::int64_t result;
  if (static_cast<std::uint64_t>(wrapped_distance(relative, 0)) < 1000) result = 0;
  else if (static_cast<std::uint64_t>(wrapped_distance(relative, from.duration)) < 1000) result = to.duration;
  else if (relative < 0) {
    const double numeric = static_cast<double>(relative);
    result = truncate_time(to_timeline ? numeric / segment.negative_time_speed : numeric * segment.negative_time_speed);
  } else {
    result = to_timeline ? curve.source_to_sequence(relative, segment.target.duration)
                         : curve.sequence_to_source(relative, segment.target.duration);
  }
  return wrapped_sum(to.start, result);
}
}
std::int64_t variable_keyframe_to_timeline(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time) {
  return map_variable_time(curve, segment, time, true);
}
std::int64_t variable_timeline_to_keyframe(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time) {
  return map_variable_time(curve, segment, time, false);
}
std::int64_t variable_keyframe_to_relative_sequence(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time) {
  return wrapped_difference(variable_keyframe_to_timeline(curve, segment, time),
      wrapped_sum(segment.target.start, segment.offset));
}
}  // namespace editor_contract
