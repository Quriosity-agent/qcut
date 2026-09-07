#include "linear_property.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {

std::vector<double> evaluate_linear_property_interval(const ConstantSpeedSegment& segment,
    const LinearPropertyInterval& interval, std::int64_t query_time) {
  if (interval.left_values.empty() || interval.left_values.size() != interval.right_values.size()) {
    throw std::invalid_argument("Linear property values must have the same nonempty shape");
  }
  if (interval.left_values.size() > (1U << 20)) throw std::length_error("Property shape exceeds the independent budget");
  if (query_time <= interval.left_time || query_time >= interval.right_time) {
    throw std::invalid_argument("This property branch requires a strictly interior raw-time query");
  }
  const auto left = keyframe_time_to_relative_sequence(segment, interval.left_time);
  const auto right = keyframe_time_to_relative_sequence(segment, interval.right_time);
  const auto query = keyframe_time_to_relative_sequence(segment, query_time);
  if (left >= right || query < left || query > right) {
    throw std::invalid_argument("Mapped time is outside the verified increasing interval");
  }
  const double progress = static_cast<double>(wrapped_difference(query, left)) /
                          static_cast<double>(wrapped_difference(right, left));
  std::vector<double> result(interval.left_values.size());
  for (std::size_t i = 0; i < result.size(); ++i) {
    const double difference = interval.right_values[i] - interval.left_values[i];
    const double scaled = difference * progress;
    result[i] = interval.left_values[i] + scaled;
  }
  return result;
}

}  // namespace editor_contract
