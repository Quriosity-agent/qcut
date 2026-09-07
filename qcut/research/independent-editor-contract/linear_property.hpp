#pragma once

#include "segment_time.hpp"

#include <span>
#include <vector>

namespace editor_contract {

struct LinearPropertyInterval {
  std::int64_t left_time;
  std::int64_t right_time;
  std::span<const double> left_values;
  std::span<const double> right_values;
};

// A preselected Video interval: both curve types zero, no graph, and strictly non-hit raw query.
std::vector<double> evaluate_linear_property_interval(const ConstantSpeedSegment& segment,
    const LinearPropertyInterval& interval, std::int64_t query_time);

}  // namespace editor_contract
