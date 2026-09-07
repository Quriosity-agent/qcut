#include "graph.hpp"

#include <stdexcept>

namespace editor_contract {
namespace {
ControlOffset control(const GraphRecord& record, bool outgoing, std::size_t channel) {
  const auto& channels = outgoing ? record.channel_outgoing : record.channel_incoming;
  if (channel < channels.values.size()) return {static_cast<double>(channels.time), channels.values[channel]};
  return outgoing ? record.outgoing : record.incoming;
}
}  // namespace

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
  for (std::size_t i = 1; i < records.size(); ++i) {
    if (records[i - 1].time > records[i].time) {
      throw std::invalid_argument("Descending graph records are outside the verified property domain");
    }
  }
  std::size_t previous = 0;
  auto progress_left = mapped_left;
  for (std::size_t selected = 0; selected < records.size(); ++selected) {
    const auto& end = records[selected];
    if (end.time < query) {
      previous = selected;
      progress_left = end.time;
      continue;
    }
    const auto& start = records[previous];
    std::vector<double> result(start.values.size());
    for (std::size_t channel = 0; channel < result.size(); ++channel) {
      const auto prepared = prepare_cubic_interval({start.time, end.time, start.values[channel], end.values[channel],
          control(start, true, channel), control(end, false, channel)}, {progress_left, end.time, query});
      result[channel] = static_cast<double>(evaluate_cubic(prepared.curve, prepared.progress));
    }
    return result;
  }
  return {right.values.begin(), right.values.end()};
}

}  // namespace editor_contract
