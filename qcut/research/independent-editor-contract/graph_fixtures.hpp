#pragma once

#include "graph.hpp"
#include "nonlinear_property_fixtures.hpp"

namespace editor_test {

struct GraphFixture {
  NonlinearFixture input;
  std::vector<editor_contract::GraphPoint> points;
};

inline GraphFixture graph_fixture(std::size_t graph, std::size_t config) {
  GraphFixture result;
  auto& input = result.input;
  constexpr std::array speeds{.125, .3, .75, 1.0, 1.2, 2.0, 8.0};
  constexpr std::array<std::size_t, 4> shapes{1, 3, 8, 17};
  const auto source = static_cast<std::int64_t>(config % 5) * 100000 - 200000;
  input.segment = {{source, 2000000}, {5000000, static_cast<std::int64_t>(2000000 / speeds[config % speeds.size()])},
      speeds[config % speeds.size()], static_cast<std::int64_t>(config % 5) * 731 - 1462};
  input.left_time = source + (config % 3 == 0 ? -10000 : 10000);
  input.right_time = source + (config % 3 == 0 ? 2010000 : 1990000);
  input.left_curve = config % 2 == 0 ? 0 : -1;
  input.right_curve = config % 2 == 0 ? 2 : 0;
  input.left_incoming = {-456, .19}; input.left_outgoing = {12345, .37};
  input.right_incoming = {-24680, -.23}; input.right_outgoing = {789, -.09};
  input.left_values.clear(); input.right_values.clear();
  for (std::size_t i = 0; i < shapes[config % shapes.size()]; ++i) {
    input.left_values.push_back(static_cast<double>(static_cast<int>(i * 19 + config) % 37 - 17) / 13);
    input.right_values.push_back(static_cast<double>(static_cast<int>(i * 7 + config * 3) % 41 - 19) / 17);
  }
  using P = editor_contract::GraphPoint;
  switch (graph % 12) {
    case 0: result.points = {{0, 0, 0}, {0, 1, 1}}; break;
    case 1: result.points = {{0, 0, 0}, {1, .37, .83}, {0, 1, 1}}; break;
    case 2: result.points = {{0, 0, 0}, {-1, .2, .8}, {2, .7, .3}, {0, 1, 1}}; break;
    case 3: result.points = {{0, .4, .8}, {0, .37, 1.3}, {0, .6, .2}}; break;
    case 4: result.points = {{0, 0, 0}, {1, .12, .7}, {0, .41, .9}, {1, .51, -.2}, {2, .8, 1.3}, {0, 1, 1}}; break;
    case 5: result.points = {{0, 0, 0}, {1, .7, 1.2}, {-7, .2, -.1}, {INT32_MAX, .999, 40}, {0, 1, 1}}; break;
    case 6: result.points = {{0, 0, 0}, {INT32_MIN, -.3, -1}, {2, 1.2, 2}, {0, 1, 1}}; break;
    case 7: result.points = {{0, 0, 0}, {0, .5, .3}, {0, .5, .8}, {1, .6, 1}, {0, 1, 1}}; break;
    case 8: result.points = {{0, 0, 0}, {0, .0001, .4}, {1, .0002, -.3}, {0, .9999, .7}, {0, 1, 1}}; break;
    case 9: result.points = {{0, 0, 0}, {1, .2, .8}, {0, .3, .4}, {1, .4, .3}, {0, .6, .5}, {1, .9, .7}, {0, 1, 1}}; break;
    case 10: result.points = {{0, 0, 0}, {1, -0.0, -0.0}, {1, 1, 1}, {0, 1, 1}}; break;
    default:
      for (std::size_t i = 0; i < 19; ++i) result.points.push_back(P{0, static_cast<double>(i) / 18, static_cast<double>((i * 7) % 19) / 18});
      break;
  }
  return result;
}

inline GraphFixture graph_rounding_fixture() {
  auto fixture = graph_fixture(0, 3);
  fixture.input.left_values.assign(1, -1.0);
  fixture.input.right_values.assign(1, 0x1p-52);
  fixture.points = {{0, 0, 0}, {0, .5, 0x1.fffffffffffffp-1}, {0, 1, 1}};
  return fixture;
}
}  // namespace editor_test
