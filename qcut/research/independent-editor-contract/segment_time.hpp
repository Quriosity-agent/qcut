#pragma once

#include "time_adapter.hpp"

namespace editor_contract {

struct SegmentTimeRange {
  std::int64_t start;
  std::int64_t duration;
};

struct ConstantSpeedSegment {
  SegmentTimeRange source;
  SegmentTimeRange target;
  double speed;
  std::int64_t offset = 0;
};

struct ControlTimeRecord {
  std::int64_t time;
  ControlOffset left;
  ControlOffset right;
};

// Durations must be nonnegative and constant speed finite/positive. Queries retain raw int64 units.
std::int64_t keyframe_time_to_timeline(const ConstantSpeedSegment& segment, std::int64_t time);
std::int64_t timeline_to_keyframe_time(const ConstantSpeedSegment& segment, std::int64_t time);
std::int64_t keyframe_time_to_relative_sequence(const ConstantSpeedSegment& segment, std::int64_t time);

// Record preparation clamps beyond the source range; timeline conversion instead extrapolates.
ControlTimeRecord resolve_constant_speed_record(const ConstantSpeedSegment& segment,
                                               const ControlTimeRecord& record);

}  // namespace editor_contract
