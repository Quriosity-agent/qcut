#pragma once

#include "nonlinear_property.hpp"
#include "variable_time.hpp"

namespace editor_contract {
// Two preselected graph-free frames, at least one nonzero curve, interior raw query.
std::vector<double> evaluate_variable_property_interval(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const NonlinearPropertyInterval& interval, std::int64_t query);
}  // namespace editor_contract
