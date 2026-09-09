#include "temporal_crop.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <limits>

namespace lens_contract {
namespace {
constexpr std::int32_t coordinate_limit = 32768;

bool supported_float_environment() noexcept {
  return std::numeric_limits<float>::is_iec559 && sizeof(float) == 4 &&
         std::fegetround() == FE_TONEAREST;
}

bool bounded_coordinate(std::int32_t value) noexcept {
  return value >= -2 * coordinate_limit && value <= 2 * coordinate_limit;
}

float mix_history(float previous, float current, float weight) noexcept {
  const float history = previous * weight;
  const float update = (1.0F - weight) * current;
  return history + update;
}

CropBounds interpolate(const CropInterpolationRequest& r) noexcept {
  const auto x = static_cast<std::int32_t>(mix_history(
      static_cast<float>(r.previous_x), static_cast<float>(r.current_x), r.history_weight));
  const auto y = static_cast<std::int32_t>(mix_history(
      static_cast<float>(r.previous_y), static_cast<float>(r.current_y), r.history_weight));
  const auto extent = static_cast<std::int32_t>(mix_history(
      static_cast<float>(r.previous_extent), static_cast<float>(r.current_extent), r.history_weight));
  const float vertical_extent = r.aspect_ratio * static_cast<float>(extent);
  const float left = static_cast<float>(x - extent / 2);
  const float right = left + static_cast<float>(extent);
  const float top = static_cast<float>(static_cast<std::int32_t>(
      static_cast<float>(y) - vertical_extent / 2.0F));
  return {left, right, top, top + vertical_extent};
}

bool valid_request(const TemporalCropRequest& r) noexcept {
  const auto& box = r.rectangle;
  const bool parameters_finite = std::isfinite(r.history_limit) && std::isfinite(r.motion_fraction);
  const bool parameters_update = r.history_limit >= 0.0F && r.motion_fraction >= 0.0F;
  return supported_float_environment() && parameters_finite &&
      (!parameters_update || (r.history_limit <= 1.0F && r.motion_fraction <= 1.0F)) &&
      r.frame_width >= 1 && r.frame_width <= coordinate_limit &&
      r.frame_height >= 1 && r.frame_height <= coordinate_limit &&
      box.x >= -coordinate_limit && box.x <= coordinate_limit &&
      box.y >= -coordinate_limit && box.y <= coordinate_limit &&
      box.width >= 2 && box.width <= coordinate_limit &&
      box.height >= 1 && box.height <= coordinate_limit;
}
}  // namespace

bool observed_crop_constraint(std::int32_t width, std::int32_t height,
                              const CropBounds& bounds) noexcept {
  return static_cast<std::int32_t>(-1.0F <= bounds.left) < width &&
      static_cast<std::int32_t>(-1.0F <= bounds.right) < width &&
      static_cast<std::int32_t>(-1.0F <= bounds.top) < height &&
      static_cast<std::int32_t>(-1.0F <= bounds.bottom) < height;
}

bool interpolate_temporal_crop(const CropInterpolationRequest& r, CropBounds& output) noexcept {
  if (!supported_float_environment() || !std::isfinite(r.history_weight) ||
      r.history_weight < 0.0F || r.history_weight > 1.0F ||
      !std::isfinite(r.aspect_ratio) || r.aspect_ratio < 0.0F ||
      r.aspect_ratio > static_cast<float>(coordinate_limit) ||
      !bounded_coordinate(r.current_x) || !bounded_coordinate(r.current_y) ||
      !bounded_coordinate(r.previous_x) || !bounded_coordinate(r.previous_y) ||
      r.current_extent < 0 || r.current_extent > coordinate_limit ||
      r.previous_extent < 0 || r.previous_extent > coordinate_limit) return false;
  output = interpolate(r);
  return true;
}

bool TemporalCropSmoother::process(const TemporalCropRequest& request) noexcept {
  if (!valid_request(request)) return false;
  auto next = state_;
  if (request.history_limit >= 0.0F && request.motion_fraction >= 0.0F) {
    next.history_limit = request.history_limit;
    next.motion_fraction = request.motion_fraction;
  }
  next.frame_width = request.frame_width;
  next.frame_height = request.frame_height;
  const auto& box = request.rectangle;
  const float right = static_cast<float>(box.x + box.width - 1);
  const float bottom = static_cast<float>(box.y + box.height - 1);
  const float center_x = (static_cast<float>(box.x) + right) / 2.0F;
  const float center_y = (static_cast<float>(box.y) + bottom) / 2.0F;
  const float extent = right - static_cast<float>(box.x);
  const float aspect_ratio = (bottom - static_cast<float>(box.y)) / extent;
  if (next.first_frame) {
    next.first_frame = false;
    next.center_x = center_x;
    next.center_y = center_y;
    next.horizontal_extent = extent;
    ++next.processed_frames;
    next.output = box;
    state_ = next;
    return true;
  }

  CropInterpolationRequest interpolation{0.0F,
      static_cast<std::int32_t>(center_x), static_cast<std::int32_t>(center_y),
      static_cast<std::int32_t>(extent), static_cast<std::int32_t>(next.center_x),
      static_cast<std::int32_t>(next.center_y), static_cast<std::int32_t>(next.horizontal_extent),
      aspect_ratio};
  float lower = 0.0F;
  float upper = 1.0F;
  for (int iteration = 0; lower < upper && iteration < 20; ++iteration) {
    interpolation.history_weight = static_cast<float>(static_cast<double>(lower + upper) / 2.0);
    const auto bounds = interpolate(interpolation);
    if (observed_crop_constraint(next.frame_width, next.frame_height, bounds)) {
      lower = interpolation.history_weight;
    } else {
      upper = interpolation.history_weight;
    }
  }
  const float motion_budget = next.motion_fraction *
      static_cast<float>(std::min(next.frame_height, next.frame_width));
  const float center_distance = std::fabs(center_x - next.center_x) + 1.0F;
  const float update_weight = std::min(motion_budget / center_distance, 1.0F);
  const float history_weight = std::max(std::min(lower, next.history_limit), 1.0F - update_weight);
  interpolation.history_weight = history_weight;
  auto bounds = interpolate(interpolation);
  bounds.left = std::max(bounds.left, 0.0F);
  bounds.top = std::max(bounds.top, 0.0F);
  bounds.right = std::min(bounds.right, static_cast<float>(next.frame_width));
  bounds.bottom = std::min(bounds.bottom, static_cast<float>(next.frame_height));
  next.center_x = mix_history(next.center_x, center_x, history_weight);
  next.center_y = mix_history(next.center_y, center_y, history_weight);
  next.horizontal_extent = mix_history(next.horizontal_extent, extent, history_weight);
  ++next.processed_frames;
  next.output = {static_cast<std::int32_t>(bounds.left), static_cast<std::int32_t>(bounds.top),
      static_cast<std::int32_t>(bounds.right - bounds.left),
      static_cast<std::int32_t>(bounds.bottom - bounds.top)};
  state_ = next;
  return true;
}
}  // namespace lens_contract
