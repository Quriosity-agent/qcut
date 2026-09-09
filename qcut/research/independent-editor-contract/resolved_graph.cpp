#include "resolved_graph.hpp"

#include <stdexcept>

namespace editor_contract {
namespace graph_detail {
namespace {
ControlOffset control(const GraphRecord& record, bool outgoing, std::size_t channel) {
  const auto& channels = outgoing ? record.channel_outgoing : record.channel_incoming;
  if (channel < channels.values.size()) return {static_cast<double>(channels.time), channels.values[channel]};
  return outgoing ? record.outgoing : record.incoming;
}
}  // namespace

std::vector<double> evaluate_records(std::span<const GraphRecord> records,
    std::span<const double> right_values, std::int64_t mapped_left, std::int64_t query) {
  if (records.empty()) throw std::invalid_argument("Graph record evaluation requires a nonempty list");
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
  return {right_values.begin(), right_values.end()};
}
}  // namespace graph_detail
}  // namespace editor_contract
