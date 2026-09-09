#include "variable_graph.hpp"
#include "resolved_graph.hpp"
#include "resolved_property.hpp"

#include <stdexcept>

namespace editor_contract {
std::vector<GraphRecord> prepare_variable_graph(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval,
    std::span<const GraphPoint> graph) {
  if (segment.source.duration < 0 || segment.target.duration <= 0) {
    throw std::invalid_argument("Invalid variable graph record range durations");
  }
  auto records = expand_graph(interval, graph);
  for (auto& record : records) {
    const auto time = resolve_variable_speed_record(curve, segment.source, segment.target.duration,
        {record.time, record.incoming, record.outgoing});
    record.time = time.time;
    record.incoming = time.left;
    record.outgoing = time.right;
  }
  return records;
}

std::vector<double> evaluate_variable_graph_property(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval,
    std::span<const GraphPoint> graph, std::int64_t query) {
  property_detail::validate_interval(interval, query);
  // Validate graph topology before returning raw-value range copies, matching the existing API contract.
  auto records = prepare_variable_graph(curve, segment, interval, graph);
  const auto mapped_left = variable_keyframe_to_relative_sequence(curve, segment, interval.left.time);
  const auto mapped_right = variable_keyframe_to_relative_sequence(curve, segment, interval.right.time);
  const auto mapped = variable_keyframe_to_relative_sequence(curve, segment, query);
  if (mapped_left > mapped_right) throw std::invalid_argument("Descending mapped variable graph interval");
  if (mapped < mapped_left) return {interval.left.values.begin(), interval.left.values.end()};
  if (mapped > mapped_right) return {interval.right.values.begin(), interval.right.values.end()};
  return graph_detail::evaluate_records(records, interval.right.values, mapped_left, mapped);
}
}  // namespace editor_contract
