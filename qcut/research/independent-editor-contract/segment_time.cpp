#include "segment_time.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

void validate(const ConstantSpeedSegment& segment) {
  if (segment.source.duration < 0 || segment.target.duration < 0 ||
      !std::isfinite(segment.speed) || segment.speed <= 0) {
    throw std::invalid_argument("Only nonnegative ranges and positive finite constant speed are verified");
  }
}

bool near_endpoint(std::int64_t delta, std::int64_t endpoint) noexcept {
  return static_cast<std::uint64_t>(wrapped_distance(delta, endpoint)) < 1000;
}

std::int64_t map_time(const ConstantSpeedSegment& segment, std::int64_t time, bool to_timeline) {
  validate(segment);
  const auto from = to_timeline ? segment.source : segment.target;
  const auto to = to_timeline ? segment.target : segment.source;
  const auto delta = wrapped_difference(time, from.start);
  std::int64_t mapped;
  if (near_endpoint(delta, 0)) mapped = 0;
  else if (near_endpoint(delta, from.duration)) mapped = to.duration;
  else {
    const double numeric = static_cast<double>(delta);
    mapped = truncate_time(to_timeline ? numeric / segment.speed : numeric * segment.speed);
  }
  return wrapped_sum(to.start, mapped);
}

}  // namespace

std::int64_t keyframe_time_to_timeline(const ConstantSpeedSegment& segment, std::int64_t time) {
  return map_time(segment, time, true);
}

std::int64_t timeline_to_keyframe_time(const ConstantSpeedSegment& segment, std::int64_t time) {
  return map_time(segment, time, false);
}

std::int64_t keyframe_time_to_relative_sequence(const ConstantSpeedSegment& segment, std::int64_t time) {
  return wrapped_difference(keyframe_time_to_timeline(segment, time),
                            wrapped_sum(segment.target.start, segment.offset));
}

ControlTimeRecord resolve_constant_speed_record(const ConstantSpeedSegment& segment,
                                               const ControlTimeRecord& record) {
  validate(segment);
  auto delta = wrapped_difference(record.time, segment.source.start);
  if (delta < 1000) delta = 0;
  else if (delta >= segment.source.duration || near_endpoint(delta, segment.source.duration)) {
    delta = segment.source.duration;
  }
  const double time = static_cast<double>(delta);
  const auto resolved = truncate_time(time / segment.speed);
  const double integral = static_cast<double>(resolved);
  return {resolved, {(record.left.time + time) / segment.speed - integral, record.left.value},
          {(record.right.time + time) / segment.speed - integral, record.right.value}};
}

}  // namespace editor_contract
