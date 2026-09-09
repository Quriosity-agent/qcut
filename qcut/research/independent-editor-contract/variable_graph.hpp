#pragma once

#include "graph.hpp"
#include "variable_time.hpp"

namespace editor_contract {
// Per-channel graph controls retain source integer units; ordinary controls use the curve resolver.
std::vector<GraphRecord> prepare_variable_graph(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval,
    std::span<const GraphPoint> graph);

// Preselected two-frame Video interval; same graph domain as expand_graph, interior raw query.
std::vector<double> evaluate_variable_graph_property(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval,
    std::span<const GraphPoint> graph, std::int64_t query);
}  // namespace editor_contract
