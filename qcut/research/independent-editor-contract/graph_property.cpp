#include "graph.hpp"
#include "resolved_graph.hpp"

#include <stdexcept>

namespace editor_contract {

std::vector<double> evaluate_graph_property(const ConstantSpeedSegment& segment,
    const NonlinearPropertyInterval& interval, std::span<const GraphPoint> graph,
    std::int64_t query_midpoint) {
  const auto& left = interval.left;
  const auto& right = interval.right;
  if ((left.curve_type == 0 && right.curve_type == 0) || query_midpoint <= left.time || query_midpoint >= right.time) {
    throw std::invalid_argument("Graph property requires a nonzero curve and a strictly interior raw midpoint");
  }
  auto records = expand_graph(interval, graph);
  const auto mapped_left = keyframe_time_to_relative_sequence(segment, left.time);
  const auto mapped_right = keyframe_time_to_relative_sequence(segment, right.time);
  const auto query = keyframe_time_to_relative_sequence(segment, query_midpoint);
  if (mapped_left > mapped_right) throw std::invalid_argument("Descending mapped interval is outside the verified domain");
  if (query < mapped_left) return {left.values.begin(), left.values.end()};
  if (query > mapped_right) return {right.values.begin(), right.values.end()};

  for (auto& record : records) {
    const auto resolved = resolve_constant_speed_record(segment, {record.time, record.incoming, record.outgoing});
    record.time = resolved.time;
    record.incoming = resolved.left;
    record.outgoing = resolved.right;
    // Native constant-speed preparation leaves graph channel offsets in their original integer units.
  }
  return graph_detail::evaluate_records(records, right.values, mapped_left, query);
}

}  // namespace editor_contract
