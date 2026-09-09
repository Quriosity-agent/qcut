#include "graph.hpp"
#include "integer_time.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {
constexpr double kOneThird = 0x1.5555555555555p-2;
constexpr double kTwoThirds = 0x1.5555555555555p-1;
constexpr std::size_t kScalarBudget = 1U << 20;

GraphRecord copy_frame(const CurvePropertyKeyframe& frame, std::int32_t default_curve) {
  return {frame.time, frame.curve_type == 0 ? default_curve : frame.curve_type,
      {frame.values.begin(), frame.values.end()},
      frame.curve_type == 0 ? ControlOffset{} : frame.incoming,
      frame.curve_type == 0 ? ControlOffset{} : frame.outgoing, {}, {}};
}

ChannelControls relative_control(const GraphRecord& anchor, const GraphRecord& control) {
  ChannelControls result{wrapped_difference(control.time, anchor.time), {}};
  result.values.reserve(anchor.values.size());
  for (std::size_t i = 0; i < anchor.values.size(); ++i) {
    result.values.push_back(control.values[i] - anchor.values[i]);
  }
  return result;
}

ChannelControls quadratic_control(const GraphRecord& anchor, const GraphRecord& control, bool incoming) {
  const double a = static_cast<double>(anchor.time) * kOneThird;
  const double c = static_cast<double>(control.time) * kTwoThirds;
  ChannelControls result{wrapped_difference(truncate_time(incoming ? c + a : a + c), anchor.time), {}};
  result.values.reserve(anchor.values.size());
  for (std::size_t i = 0; i < anchor.values.size(); ++i) {
    const double anchor_part = anchor.values[i] * kOneThird;
    const double control_part = control.values[i] * kTwoThirds;
    const double absolute = incoming ? control_part + anchor_part : anchor_part + control_part;
    result.values.push_back(absolute - anchor.values[i]);
  }
  return result;
}
}  // namespace

std::vector<GraphRecord> expand_graph(const NonlinearPropertyInterval& interval,
                                     std::span<const GraphPoint> graph) {
  const auto& left = interval.left;
  const auto& right = interval.right;
  if (left.values.empty() || left.values.size() != right.values.size()) {
    throw std::invalid_argument("Graph values require the same nonempty shape");
  }
  if (graph.size() < 2 || graph.front().type != 0 || graph.back().type != 0) {
    throw std::invalid_argument("The verified graph domain starts and ends with anchors");
  }
  if (graph.size() > kScalarBudget || left.values.size() > kScalarBudget / graph.size()) {
    throw std::length_error("Graph expansion exceeds the independent scalar budget");
  }
  std::vector<double> delta(left.values.size());
  for (std::size_t i = 0; i < delta.size(); ++i) delta[i] = right.values[i] - left.values[i];
  const double duration = static_cast<double>(wrapped_difference(right.time, left.time));
  std::vector<GraphRecord> records;
  std::vector<GraphRecord> pending;
  for (std::size_t i = 0; i < graph.size(); ++i) {
    const auto& point = graph[i];
    GraphRecord transformed;
    const double elapsed = point.time_fraction * duration;
    transformed.time = truncate_time(elapsed + static_cast<double>(left.time));
    transformed.values.reserve(delta.size());
    for (std::size_t channel = 0; channel < delta.size(); ++channel) {
      const double scaled = point.value_fraction * delta[channel];
      transformed.values.push_back(left.values[channel] + scaled);
    }
    if (point.type != 0) {
      if (pending.size() < 2) pending.push_back(std::move(transformed));
      continue;
    }
    auto anchor = i == 0 ? copy_frame(left, 1) :
        i == graph.size() - 1 ? copy_frame(right, 2) : std::move(transformed);
    if (i != 0 && i != graph.size() - 1) anchor.curve_type = 3;
    if (!records.empty() && !pending.empty()) {
      auto& previous = records.back();
      if (pending.size() == 1) {
        previous.channel_outgoing = quadratic_control(previous, pending[0], false);
        anchor.channel_incoming = quadratic_control(anchor, pending[0], true);
      } else {
        previous.channel_outgoing = relative_control(previous, pending[0]);
        anchor.channel_incoming = relative_control(anchor, pending[1]);
      }
    }
    pending.clear();
    records.push_back(std::move(anchor));
  }
  return records;
}

}  // namespace editor_contract
