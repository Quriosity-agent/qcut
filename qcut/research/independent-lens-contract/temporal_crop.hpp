#pragma once

#include <cstdint>

namespace lens_contract {

struct CropRectangle {
  std::int32_t x = 0;
  std::int32_t y = 0;
  std::int32_t width = 0;
  std::int32_t height = 0;
  bool operator==(const CropRectangle&) const = default;
};

struct CropBounds {
  float left;
  float right;
  float top;
  float bottom;
  bool operator==(const CropBounds&) const = default;
};

struct TemporalCropRequest {
  CropRectangle rectangle;
  std::int32_t frame_width;
  std::int32_t frame_height;
  float history_limit = -1.0F;
  float motion_fraction = -1.0F;
};

struct TemporalCropState {
  std::int32_t frame_width = 0;
  std::int32_t frame_height = 0;
  float history_limit = 0.7F;
  float motion_fraction = 0.05F;
  float center_x = 0.0F;
  float center_y = 0.0F;
  float horizontal_extent = 0.0F;
  bool first_frame = true;
  std::uint32_t processed_frames = 0;
  CropRectangle output;
  bool operator==(const TemporalCropState&) const = default;
};

struct CropInterpolationRequest {
  float history_weight;
  std::int32_t current_x;
  std::int32_t current_y;
  std::int32_t current_extent;
  std::int32_t previous_x;
  std::int32_t previous_y;
  std::int32_t previous_extent;
  float aspect_ratio;
};

// This reproduces the comparison-of-comparison in the observed binary.
bool observed_crop_constraint(std::int32_t width, std::int32_t height,
                              const CropBounds& bounds) noexcept;
bool interpolate_temporal_crop(const CropInterpolationRequest& request,
                               CropBounds& output) noexcept;

class TemporalCropSmoother {
 public:
  bool process(const TemporalCropRequest& request) noexcept;
  void reset() noexcept { state_ = {}; }
  const TemporalCropState& state() const noexcept { return state_; }

 private:
  TemporalCropState state_;
};

}  // namespace lens_contract
