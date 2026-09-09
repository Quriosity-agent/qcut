#include "nonlinear_property.hpp"
#include "resolved_property.hpp"

#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

std::vector<double> copy_values(std::span<const double> values) {
  return {values.begin(), values.end()};
}

ControlTimeRecord resolve_record(const ConstantSpeedSegment& segment, const CurvePropertyKeyframe& frame) {
  const bool has_controls = frame.curve_type != 0;
  return resolve_constant_speed_record(segment, {frame.time,
      has_controls ? frame.incoming : ControlOffset{}, has_controls ? frame.outgoing : ControlOffset{}});
}

}  // namespace

std::vector<double> evaluate_nonlinear_property_interval(const ConstantSpeedSegment& segment,
    const NonlinearPropertyInterval& interval, std::int64_t query_midpoint) {
  const auto& left = interval.left;
  const auto& right = interval.right;
  property_detail::validate_interval(interval, query_midpoint);
  const auto mapped_left = keyframe_time_to_relative_sequence(segment, left.time);
  const auto mapped_right = keyframe_time_to_relative_sequence(segment, right.time);
  const auto query = keyframe_time_to_relative_sequence(segment, query_midpoint);
  if (mapped_left > mapped_right) throw std::invalid_argument("Descending mapped interval is outside the verified domain");
  if (query < mapped_left) return copy_values(left.values);
  if (query > mapped_right) return copy_values(right.values);

  const auto first = resolve_record(segment, left);
  const auto last = resolve_record(segment, right);
  return property_detail::evaluate_records(interval, first, last, mapped_left, query);
}

}  // namespace editor_contract
