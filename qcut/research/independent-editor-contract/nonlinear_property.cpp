#include "nonlinear_property.hpp"

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
  if (left.values.empty() || left.values.size() != right.values.size()) {
    throw std::invalid_argument("Nonlinear property values require the same nonempty shape");
  }
  if (left.values.size() > (1U << 20)) throw std::length_error("Property shape exceeds the independent budget");
  if ((left.curve_type == 0 && right.curve_type == 0) || query_midpoint <= left.time || query_midpoint >= right.time) {
    throw std::invalid_argument("This branch requires a nonzero curve and a strictly interior raw midpoint");
  }
  const auto mapped_left = keyframe_time_to_relative_sequence(segment, left.time);
  const auto mapped_right = keyframe_time_to_relative_sequence(segment, right.time);
  const auto query = keyframe_time_to_relative_sequence(segment, query_midpoint);
  if (mapped_left > mapped_right) throw std::invalid_argument("Descending mapped interval is outside the verified domain");
  if (query < mapped_left) return copy_values(left.values);
  if (query > mapped_right) return copy_values(right.values);

  const auto first = resolve_record(segment, left);
  const auto last = resolve_record(segment, right);
  if (first.time > last.time) throw std::invalid_argument("Descending resolved records are outside the verified domain");
  if (query > last.time) return copy_values(right.values);

  const bool before_or_at_first = query <= first.time;
  const auto& selected_right = before_or_at_first ? first : last;
  const auto right_values = before_or_at_first ? left.values : right.values;
  // The first-record path retains the original mapped left bound, even when both records are the same object.
  const IntervalProgress progress{before_or_at_first ? mapped_left : first.time, selected_right.time, query};
  std::vector<double> result(left.values.size());
  for (std::size_t i = 0; i < result.size(); ++i) {
    const auto prepared = prepare_cubic_interval({first.time, selected_right.time,
        left.values[i], right_values[i], first.right, selected_right.left}, progress);
    result[i] = static_cast<double>(evaluate_cubic(prepared.curve, prepared.progress));
  }
  return result;
}

}  // namespace editor_contract
