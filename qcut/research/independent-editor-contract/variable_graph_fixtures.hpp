#pragma once

#include "graph_fixtures.hpp"
#include "variable_time_fixtures.hpp"
#include "variable_graph.hpp"

namespace editor_test {
struct VariableGraphFixture {
  GraphFixture graph;
  std::vector<editor_contract::SpeedControlPoint> speed;
  editor_contract::VariableSpeedSegment segment;
};
inline VariableGraphFixture variable_graph_fixture(std::size_t shape, std::size_t config) {
  VariableGraphFixture result;
  result.graph = graph_fixture(shape, config);
  result.speed = variable_curve(config % 48);
  const auto duration = config % 2 == 0 ? 2000000 : 100000000;
  result.segment = variable_segment(duration, config);
  auto& input = result.graph.input;
  input.left_time = result.segment.source.start + (config % 3 == 0 ? -10000 : 10000);
  input.right_time = result.segment.source.start + result.segment.source.duration + (config % 3 == 0 ? 10000 : -10000);
  if (config % 8 == 7) {
    input.left_values.front() = std::bit_cast<double>(kDoubleBits[config % kDoubleBits.size()]);
    input.right_values.back() = std::bit_cast<double>(kDoubleBits[(config + 7) % kDoubleBits.size()]);
  }
  return result;
}
inline std::vector<std::int64_t> variable_graph_queries(const GraphFixture& fixture) {
  const auto left = fixture.input.left_time, right = fixture.input.right_time;
  std::set<std::int64_t> queries{left + 1, right - 1};
  for (std::int64_t step = 1; step < 33; ++step) queries.insert(left + (right - left) * step / 33);
  for (const auto& point : fixture.points) {
    if (point.type != 0 || !std::isfinite(point.time_fraction)) continue;
    const auto center = editor_contract::truncate_time(static_cast<double>(right - left) * point.time_fraction + static_cast<double>(left));
    for (const auto delta : {-1, 0, 1}) {
      const auto query = editor_contract::wrapped_sum(center, delta);
      if (query > left && query < right) queries.insert(query);
    }
  }
  return {queries.begin(), queries.end()};
}
}  // namespace editor_test
