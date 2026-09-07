#pragma once

#include "segment_time.hpp"

#include <span>
#include <vector>

namespace editor_contract {

struct CurvePropertyKeyframe {
  std::int64_t time;
  std::span<const double> values;
  std::int32_t curve_type;
  ControlOffset incoming;
  ControlOffset outgoing;
};

struct NonlinearPropertyInterval {
  CurvePropertyKeyframe left;
  CurvePropertyKeyframe right;
};

// Two preselected graph-free Video frames, at least one nonzero curve, and a non-hit raw midpoint.
std::vector<double> evaluate_nonlinear_property_interval(const ConstantSpeedSegment& segment,
    const NonlinearPropertyInterval& interval, std::int64_t query_midpoint);

}  // namespace editor_contract
