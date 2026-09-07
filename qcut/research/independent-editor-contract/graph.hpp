#pragma once

#include "nonlinear_property.hpp"

namespace editor_contract {

struct GraphPoint {
  std::int32_t type = 0;
  double time_fraction = 0;
  double value_fraction = 0;
};

struct ChannelControls {
  std::int64_t time = 0;
  std::vector<double> values;
};

struct GraphRecord {
  std::int64_t time = 0;
  std::int32_t curve_type = 0;
  std::vector<double> values;
  ControlOffset incoming{};
  ControlOffset outgoing{};
  ChannelControls channel_incoming;
  ChannelControls channel_outgoing;
};

// The right frame supplies graph points. Type zero is an anchor; every nonzero type is a control.
// First and last points must be anchors. Extra controls beyond the first two are ignored by expansion.
std::vector<GraphRecord> expand_graph(const NonlinearPropertyInterval& interval,
                                     std::span<const GraphPoint> right_graph);

// Two preselected Video frames, positive constant speed and an interior raw query only.
std::vector<double> evaluate_graph_property(const ConstantSpeedSegment& segment,
    const NonlinearPropertyInterval& interval, std::span<const GraphPoint> right_graph,
    std::int64_t query_midpoint);

}  // namespace editor_contract
