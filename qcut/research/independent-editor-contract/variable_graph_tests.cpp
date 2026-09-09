#include "variable_graph_fixtures.hpp"

#include <iostream>
#include <limits>

namespace {
using namespace editor_contract;
using editor_test::require;

void record_clocks() {
  const VariableSpeedCurve curve(std::array{SpeedControlPoint{0, 2}, SpeedControlPoint{1, 2}});
  const VariableSpeedSegment segment{{0, 4000000}, {0, 2000000}, 2, 0};
  const std::array left{0.0, 10.0}, right{1.0, 20.0};
  const NonlinearPropertyInterval interval{{10000, left, 1, {-2000, -.2}, {4000, .3}},
      {3990000, right, 2, {-8000, -.4}, {16000, .5}}};
  const std::array points{GraphPoint{0, 0, 0}, GraphPoint{1, .5, .75}, GraphPoint{0, 1, 1}};
  const auto actual = prepare_variable_graph(curve, segment, interval, points);
  require(actual.size() == 2 && actual.front().time == 5000 && actual.back().time == 1995000, "Record clocks scale to sequence time");
  require(actual.front().outgoing.time == 2000 && actual.back().incoming.time == -4000, "Scalar controls follow the curve clock");
  require(actual.front().channel_outgoing.time == 1326666 && actual.back().channel_incoming.time == -1326667, "Quadratic graph control times retain raw source units");
  require(actual.front().channel_outgoing.values == std::vector<double>{.5, 5}, "Each channel retains its own graph value offset");
  require(actual.front().outgoing.value == .3 && actual.back().incoming.value == -.4, "Scalar values survive time conversion");
  const auto midpoint = evaluate_variable_graph_property(curve, segment, interval, points, 2000000);
  require(midpoint[0] != .5, "Graph curvature is not replaced by linear interpolation");
}

void captured_goldens() {
  struct Golden { std::size_t shape, config; std::int64_t query; std::vector<std::uint64_t> bits; };
  const std::array<Golden, 4> goldens{{
    {1, 8, 171046, {0xbf937f8660000000ULL}},
    {4, 9, 36739470, {0x3fd6a57480000000ULL, 0x3fec1c5b80000000ULL, 0xbff0e2dc40000000ULL}},
    {7, 10, 555263, {0xbfd157d2c0000000ULL, 0x3fee84be20000000ULL, 0xbfe23b6ce0000000ULL, 0x3fe4f53ac0000000ULL, 0xbfd4c2ad80000000ULL, 0x3feccf50c0000000ULL, 0xbfb43a0520000000ULL, 0x3ff254b380000000ULL}},
    {0, 11, 18523687, {0x3fc8610d20000000ULL, 0x3ff3f3e620000000ULL, 0xbfd7ff4b00000000ULL, 0x3fe5cfe340000000ULL, 0xbf84893440000000ULL, 0x3ff0beb200000000ULL, 0x3fd6b6b7c0000000ULL, 0x3fdecaf700000000ULL, 0xbfcaf233c0000000ULL, 0x3feb12fbe0000000ULL, 0x3fc3c3cf40000000ULL, 0x3ff3603e40000000ULL, 0x3fe09e74a0000000ULL, 0x3fe4a89380000000ULL, 0xbfa79743e0000000ULL, 0xbfe79b7c60000000ULL, 0x3fd46818e0000000ULL}}
  }};
  for (const auto& golden : goldens) {
    const auto fixture = editor_test::variable_graph_fixture(golden.shape, golden.config);
    const VariableSpeedCurve curve(fixture.speed);
    const auto actual = evaluate_variable_graph_property(curve, fixture.segment, fixture.graph.input.interval(), fixture.graph.points, golden.query);
    require(actual.size() == golden.bits.size(), "Native variable graph golden shape differs");
    for (std::size_t i = 0; i < actual.size(); ++i) require(std::bit_cast<std::uint64_t>(actual[i]) == golden.bits[i], "Native variable graph golden bits differ");
  }
}

void native_corpus() {
  std::uint64_t fingerprint = editor_test::kFnvStart, calls = 0, values = 0, nan = 0;
  for (std::size_t graph = 0; graph < 12; ++graph) {
    for (std::size_t config = 0; config < 96; ++config) {
      const auto fixture = editor_test::variable_graph_fixture(graph, config);
      const VariableSpeedCurve curve(fixture.speed);
      for (const auto query : editor_test::variable_graph_queries(fixture.graph)) {
        const auto actual = evaluate_variable_graph_property(curve, fixture.segment, fixture.graph.input.interval(), fixture.graph.points, query);
        for (const auto value : actual) {
          const bool is_nan = std::isnan(value);
          editor_test::hash_integer(fingerprint, is_nan ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
          ++values; if (is_nan) ++nan;
        }
        ++calls;
      }
    }
  }
  require(fingerprint == 9119564553003171886ULL, "Variable graph actual-property corpus differs");
  require(calls == 46464 && values == 336864 && nan == 4425, "Variable graph corpus coverage changed");
  std::cout << "Native corpus " << calls << " calls / " << values << " values / " << nan << " NaNs\n";
}

template <class Function> void rejects(Function function) {
  try { function(); } catch (const std::invalid_argument&) { return; } catch (const std::length_error&) { return; }
  throw std::runtime_error("Unsupported variable graph domain was not rejected");
}
void invalid_inputs() {
  auto fixture = editor_test::variable_graph_fixture(4, 8);
  const VariableSpeedCurve curve(fixture.speed);
  auto evaluate = [&] { return evaluate_variable_graph_property(curve, fixture.segment, fixture.graph.input.interval(), fixture.graph.points, 200000); };
  rejects([&] { evaluate_variable_graph_property(curve, fixture.segment, fixture.graph.input.interval(), fixture.graph.points, fixture.graph.input.left_time); });
  auto saved = fixture.graph.points;
  fixture.graph.points.clear(); rejects(evaluate);
  fixture.graph.points = saved; fixture.graph.points.front().type = 1; rejects(evaluate);
  fixture.graph.points = {{0, 0, 0}, {0, .8, .5}, {0, .2, .7}, {0, 1, 1}}; rejects(evaluate);
  fixture.graph.points = saved;
  const auto segment = fixture.segment;
  fixture.segment.source.duration = -1; rejects(evaluate);
  fixture.segment = segment; fixture.segment.target.duration = 0; rejects(evaluate);
  fixture.segment = segment; fixture.segment.negative_time_speed = std::numeric_limits<double>::quiet_NaN(); rejects(evaluate);
  fixture.segment = segment; fixture.graph.input.left_curve = 0; fixture.graph.input.right_curve = 0; rejects(evaluate);
  fixture.graph.input.left_curve = 1; fixture.graph.input.left_values.clear(); rejects(evaluate);
  fixture.graph.input.left_values.resize(1U << 19); fixture.graph.input.right_values.resize(1U << 19); rejects(evaluate);
}

void record_special_values() {
  const VariableSpeedCurve curve(std::array{SpeedControlPoint{0, 2}, SpeedControlPoint{1, 2}});
  const VariableSpeedSegment segment{{INT64_MAX, 4000000}, {0, 2000000}, 2, 0};
  const std::array left{-0.0, std::bit_cast<double>(0x7ff8000000001234ULL)}, right{1.0, 2.0};
  const NonlinearPropertyInterval interval{{wrapped_sum(INT64_MAX, 10000), left, 1, {999.9, -0.0}, {1000, .3}},
      {wrapped_sum(INT64_MAX, 20000), right, 2, {-1000, -.4}, {0, .5}}};
  const std::array points{GraphPoint{0, 0, 0}, GraphPoint{0, 1, 1}};
  const auto records = prepare_variable_graph(curve, segment, interval, points);
  require(records.front().time == 5000 && records.back().time == 10000, "Wrapped source origin preserves record resolution");
  require(std::bit_cast<std::uint64_t>(records.front().values[0]) == 0x8000000000000000ULL &&
      std::bit_cast<std::uint64_t>(records.front().values[1]) == 0x7ff8000000001234ULL, "Record endpoint value copy retains zero and NaN payload bits");
  require(records.front().incoming.time == 999.9 && records.front().outgoing.time == 500, "Record threshold is independent from graph units");
  const std::array copied{.1, std::bit_cast<double>(0x7ff8000000001234ULL)};
  const NonlinearPropertyInterval copy_interval{{10000, left, 1, {}, {}}, {3990000, copied, 2, {}, {}}};
  const auto result = evaluate_variable_graph_property(curve, {{0, 4000000}, {0, 2000000}, 2, -1000}, copy_interval, points, 3989999);
  require(std::bit_cast<std::uint64_t>(result[0]) == std::bit_cast<std::uint64_t>(.1) &&
      std::bit_cast<std::uint64_t>(result[1]) == 0x7ff8000000001234ULL, "Past-last resolved record copies original double values");
}
}  // namespace
int main() {
  try { record_clocks(); captured_goldens(); native_corpus(); invalid_inputs(); record_special_values();
    std::cout << "5 variable graph groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
