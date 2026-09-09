#include "variable_property.hpp"
#include "resolved_property.hpp"

#include <stdexcept>

namespace editor_contract {
std::vector<double> evaluate_variable_property_interval(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval, std::int64_t query) {
  property_detail::validate_interval(interval, query);
  const auto left_time = variable_keyframe_to_relative_sequence(curve, segment, interval.left.time);
  const auto right_time = variable_keyframe_to_relative_sequence(curve, segment, interval.right.time);
  const auto mapped = variable_keyframe_to_relative_sequence(curve, segment, query);
  if (left_time > right_time) throw std::invalid_argument("Descending mapped variable-speed interval");
  if (mapped < left_time) return {interval.left.values.begin(), interval.left.values.end()};
  if (mapped > right_time) return {interval.right.values.begin(), interval.right.values.end()};
  auto resolve = [&](const CurvePropertyKeyframe& frame) {
    const bool active = frame.curve_type != 0;
    return resolve_variable_speed_record(curve, segment.source, segment.target.duration,
        {frame.time, active ? frame.incoming : ControlOffset{}, active ? frame.outgoing : ControlOffset{}});
  };
  return property_detail::evaluate_records(interval, resolve(interval.left), resolve(interval.right), left_time, mapped);
}
}  // namespace editor_contract
