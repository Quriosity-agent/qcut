#pragma once

#include "temporal_crop.hpp"

#include <array>
#include <span>

namespace lens_contract {
using DetectionBounds = std::array<float, 4>;

struct CropPlannerState {
  float configured_scale = 0.8F;
  float previous_scale = 1.0F;
  bool expand_detection = true;
  std::int32_t frame_width = 0;
  std::int32_t frame_height = 0;
  DetectionBounds information{};
  CropRectangle output{};
  bool operator==(const CropPlannerState&) const = default;
};

struct CropPlannerRequest {
  std::int32_t frame_width;
  std::int32_t frame_height;
  DetectionBounds bounds;
  float requested_scale;
  bool has_detection;
};

class CropPlanner {
 public:
  bool initialize(float scale, bool expand_detection = true) noexcept;
  void reset() noexcept;
  bool process(const CropPlannerRequest& request) noexcept;
  const CropPlannerState& state() const noexcept { return state_; }

 private:
  CropPlannerState state_;
};

struct CenterFocusConfiguration {
  float anchor_x = 0.5F;
  float anchor_y = 0.5F;
  float scale = 0.8F;
  std::int32_t frame_width = 0;
  std::int32_t frame_height = 0;
  bool operator==(const CenterFocusConfiguration&) const = default;
};

struct CenterFocusState {
  CenterFocusConfiguration configuration;
  bool initialized_bounds = false;
  bool ready = false;
  DetectionBounds previous{};
  DetectionBounds incoming{};
  DetectionBounds adjusted{};
  DetectionBounds output{};
  bool operator==(const CenterFocusState&) const = default;
};

class CenterFocus {
 public:
  bool initialize(const CenterFocusConfiguration& configuration) noexcept;
  void reset() noexcept;
  // Empty means missing detection; nonempty input is one selected pixel bbox.
  bool process(std::span<const float> bounds) noexcept;
  const CenterFocusState& state() const noexcept { return state_; }
  const CropPlannerState& planner_state() const noexcept { return planner_.state(); }
  const TemporalCropState& smoother_state() const noexcept { return smoother_.state(); }

 private:
  CenterFocusState state_;
  CropPlanner planner_;
  TemporalCropSmoother smoother_;
};
}  // namespace lens_contract
