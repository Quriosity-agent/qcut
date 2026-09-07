#pragma once

#include "bezier.hpp"

#include <cstdint>

namespace editor_contract {

struct ControlOffset { double time; double value; };

struct CubicInterval {
  std::int64_t left_time;
  std::int64_t right_time;
  double left_value;
  double right_value;
  ControlOffset left_outgoing;
  ControlOffset right_incoming;
};

struct PreparedCubic {
  CubicCurve curve;
  float progress;
};

struct IntervalProgress {
  std::int64_t left_time;
  std::int64_t right_time;
  std::int64_t query_time;
};

// Records and progress bounds must already be resolved by the caller's Segment/graph policy.
PreparedCubic prepare_cubic_interval(const CubicInterval& interval,
                                    IntervalProgress progress) noexcept;

}  // namespace editor_contract
