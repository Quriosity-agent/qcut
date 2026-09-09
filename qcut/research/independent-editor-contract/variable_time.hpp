#pragma once

#include "segment_time.hpp"

#include <span>
#include <vector>

namespace editor_contract {

struct SpeedControlPoint {
  double source_fraction;
  double speed;
};

struct VariableSpeedSegment {
  SegmentTimeRange source;
  SegmentTimeRange target;
  double negative_time_speed = 1;
  std::int64_t offset = 0;
};

class VariableSpeedCurve {
 public:
  // Forward, continuous curves with endpoints 0/1 and strictly increasing float coordinates.
  explicit VariableSpeedCurve(std::span<const SpeedControlPoint> points);
  std::span<const float> sequence_points() const noexcept { return sequence_; }
  std::span<const float> speeds() const noexcept { return speeds_; }
  std::int64_t sequence_to_source(std::int64_t query, std::int64_t sequence_duration) const;
  std::int64_t source_to_sequence(std::int64_t query, std::int64_t sequence_duration) const;

 private:
  std::vector<float> sequence_;
  std::vector<float> speeds_;
};

ControlTimeRecord resolve_variable_speed_record(const VariableSpeedCurve& curve,
    SegmentTimeRange source, std::int64_t sequence_duration, const ControlTimeRecord& record);

std::int64_t variable_keyframe_to_timeline(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time);
std::int64_t variable_timeline_to_keyframe(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time);
std::int64_t variable_keyframe_to_relative_sequence(const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, std::int64_t time);

}  // namespace editor_contract
