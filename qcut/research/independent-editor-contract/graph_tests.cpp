#include "graph_fixtures.hpp"
#include "integer_time.hpp"

#include <cmath>
#include <iostream>

namespace {
using namespace editor_contract;
using editor_test::require;

void quadratic_golden() {
  const std::vector<double> left{0, 10}, right{9, -2};
  const NonlinearPropertyInterval interval{{0, left, 0, {}, {}}, {300, right, 0, {}, {}}};
  const std::array<GraphPoint, 3> points{{{0, .7, -.8}, {1, .5, .75}, {0, .2, 6}}};
  const auto records = expand_graph(interval, points);
  require(records.size() == 2, "Quadratic graph has two endpoint records");
  require(records[0].time == 0 && records[1].time == 300, "Endpoint graph coordinates do not replace endpoint records");
  require(records[0].curve_type == 1 && records[1].curve_type == 2, "Zero curves are promoted by endpoint role");
  require(records[0].channel_outgoing.time == 100 && records[1].channel_incoming.time == -100,
          "Quadratic control elevation has one-third time offsets");
  require(records[0].channel_outgoing.values == std::vector<double>({4.5, -6}), "Quadratic outgoing channel values");
  require(records[1].channel_incoming.values == std::vector<double>({-1.5, 2}), "Quadratic incoming channel values");
}

void cubic_and_anchor_golden() {
  const std::vector<double> left{0, 10}, right{9, -2};
  const NonlinearPropertyInterval interval{{0, left, -7, {12, .4}, {24, .8}}, {300, right, 2, {-9, .1}, {3, .2}}};
  std::vector<GraphPoint> points{{0, 0, 0}, {INT32_MIN, .25, .75}, {INT32_MAX, .75, .25}, {3, 20, 30}, {0, 1, 1}};
  const auto records = expand_graph(interval, points);
  require(records[0].curve_type == -7 && records[1].curve_type == 2, "Existing numeric curve codes are preserved");
  require(records[0].channel_outgoing.time == 75 && records[1].channel_incoming.time == -75, "First two controls determine times");
  require(records[0].channel_outgoing.values == std::vector<double>({6.75, -9}), "First control determines outgoing channels");
  require(records[1].channel_incoming.values == std::vector<double>({-6.75, 9}), "Second control determines incoming channels");
  require(records[0].outgoing.time == 24 && records[1].incoming.value == .1, "Scalar fallback controls survive graph expansion");
  points = {{0, 0, 0}, {0, .5, .5}, {0, .5, .75}, {0, 1, 1}};
  const auto anchors = expand_graph(interval, points);
  require(anchors.size() == 4 && anchors[1].time == 150 && anchors[2].time == 150, "Duplicate anchor times remain in input order");
  require(anchors[1].values == std::vector<double>({4.5, 4}) && anchors[1].curve_type == 3, "Intermediate anchor maps each channel");
  require(anchors[1].incoming.time == 0 && anchors[1].outgoing.value == 0 && anchors[1].channel_incoming.values.empty(),
          "Uncontrolled intermediate anchors are explicitly zero initialized");
}

void numerical_edges() {
  const auto rounding = editor_test::graph_rounding_fixture();
  const auto rounded = expand_graph(rounding.input.interval(), rounding.points);
  require(std::bit_cast<std::uint64_t>(rounded[1].values[0]) == 0, "Point multiply rounds before cancellation; fused multiply-add differs");
  const std::vector<double> left{-0.0, .1}, right{0.0, .9};
  const NonlinearPropertyInterval wrapped{{INT64_MIN, left, 1, {}, {}}, {INT64_MAX, right, 2, {}, {}}};
  const std::array<GraphPoint, 3> points{{{0, 0, 0}, {0, .5, .5}, {0, 1, 1}}};
  const auto records = expand_graph(wrapped, points);
  require(records[1].time == INT64_MIN, "Wrapped duration is -1 before double conversion");
  require(std::signbit(records.front().values.front()), "Endpoint raw signed zero survives copying");
  const auto nan = std::numeric_limits<double>::quiet_NaN();
  require(truncate_time(nan) == 0 && truncate_time(INFINITY) == INT64_MAX && truncate_time(-INFINITY) == INT64_MIN,
          "FCVTZS special values are defined without an out-of-range cast");
}

template<class Function> void rejected(Function&& function, const char* message) {
  bool failed = false;
  try { function(); } catch (const std::invalid_argument&) { failed = true; }
  catch (const std::length_error&) { failed = true; }
  require(failed, message);
}

void invalid_inputs() {
  auto fixture = editor_test::graph_fixture(2, 3);
  rejected([&] { expand_graph(fixture.input.interval(), {}); }, "Empty graph is outside this nonempty contract");
  fixture.points.front().type = 1;
  rejected([&] { expand_graph(fixture.input.interval(), fixture.points); }, "Leading control is rejected");
  fixture.points.front().type = 0; fixture.points.back().type = 1;
  rejected([&] { expand_graph(fixture.input.interval(), fixture.points); }, "Trailing control is rejected");
  fixture.points.back().type = 0;
  rejected([&] { evaluate_graph_property(fixture.input.segment, fixture.input.interval(), fixture.points, fixture.input.left_time); },
           "Raw exact hits use a different native dispatch branch");
  fixture.input.segment.speed = 0;
  rejected([&] { evaluate_graph_property(fixture.input.segment, fixture.input.interval(), fixture.points, 300000); }, "Zero speed is rejected");
  fixture.input.segment.speed = 1;
  fixture.points = {{0, 0, 0}, {0, .8, .5}, {0, .2, .7}, {0, 1, 1}};
  rejected([&] { evaluate_graph_property(fixture.input.segment, fixture.input.interval(), fixture.points, 300000); }, "Descending resolved graph records are rejected");
  fixture.input.left_values.resize((1U << 19) + 1);
  fixture.input.right_values.resize(fixture.input.left_values.size());
  rejected([&] { expand_graph(fixture.input.interval(), fixture.points); }, "Graph scalar product is bounded before allocation");
}

void corpus() {
  std::uint64_t fingerprint = editor_test::kFnvStart, outputs = 0;
  for (std::size_t graph = 0; graph < 12; ++graph) {
    for (std::size_t config = 0; config < 84; ++config) {
      const auto fixture = editor_test::graph_fixture(graph, config);
      const auto duration = fixture.input.right_time - fixture.input.left_time;
      for (std::int64_t step = 1; step < 19; ++step) {
        const auto result = evaluate_graph_property(fixture.input.segment, fixture.input.interval(), fixture.points,
            fixture.input.left_time + duration * step / 19);
        for (double value : result) {
          editor_test::hash_integer(fingerprint, std::isnan(value) ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
          ++outputs;
        }
      }
    }
  }
  require(outputs == 131544, "Graph property corpus output count changed");
  require(fingerprint == 14033642324964053166ULL, "Graph property corpus differs from the pinned native fingerprint");
}
}  // namespace

int main() {
  try {
    quadratic_golden(); cubic_and_anchor_golden(); numerical_edges(); invalid_inputs(); corpus();
    std::cout << "5 graph contract groups passed\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
