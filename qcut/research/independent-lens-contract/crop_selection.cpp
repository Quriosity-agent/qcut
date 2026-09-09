#include "crop_selection.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <limits>

namespace lens_contract {
namespace {
bool environment() noexcept {
  return std::numeric_limits<float>::is_iec559 && sizeof(float) == 4 &&
      std::fegetround() == FE_TONEAREST;
}
bool valid_scale(float scale) noexcept {
  return std::isfinite(scale) && scale >= 0.125F && scale <= 1.0F;
}
bool valid_dimension(std::int32_t dimension) noexcept {
  return dimension >= 16 && dimension <= 8192;
}
bool valid_bounds(std::span<const float> bounds) noexcept {
  return bounds.size() == 4 && std::all_of(bounds.begin(), bounds.end(), [](float value) {
    return std::isfinite(value) && value >= -8192.0F && value <= 8192.0F;
  });
}
template <typename T> T clip(T value, T lower, T upper) noexcept {
  // Native min(max()) also defines reversed bounds, unlike std::clamp.
  return std::min(std::max(value, lower), upper);
}
std::int32_t crop_origin(float center, float extent, std::int32_t dimension,
                         float information_origin) noexcept {
  const float leading_extent = extent * 0.5F;
  const auto low = static_cast<std::int32_t>(leading_extent);
  const auto high = static_cast<std::int32_t>(static_cast<float>(dimension) - extent * (1.0F - 0.5F));
  const auto clipped_center = clip(static_cast<std::int32_t>(center), low, high);
  const float origin = static_cast<float>(clipped_center) - leading_extent;
  return clip(static_cast<std::int32_t>(origin), 0, static_cast<std::int32_t>(information_origin));
}
float adjust_edge(float previous, float incoming, std::int32_t dimension) noexcept {
  const float delta = incoming - previous;
  const double threshold = static_cast<double>(dimension) * 0.025;
  const float adjustment = static_cast<double>(std::fabs(delta)) > threshold ? delta / 5.0F : delta;
  return adjustment + previous;
}
}  // namespace

bool CropPlanner::initialize(float scale, bool expand_detection) noexcept {
  if (!environment() || !valid_scale(scale)) return false;
  state_.configured_scale = scale;
  state_.previous_scale = 1.0F;
  state_.expand_detection = expand_detection;
  return true;
}
void CropPlanner::reset() noexcept {
  const float scale = state_.configured_scale;
  state_ = {};
  state_.configured_scale = scale;
  state_.previous_scale = scale;
}
bool CropPlanner::process(const CropPlannerRequest& request) noexcept {
  if (!environment() || !valid_dimension(request.frame_width) ||
      !valid_dimension(request.frame_height) || !valid_bounds(request.bounds) ||
      !valid_scale(request.requested_scale)) return false;
  auto next = state_;
  next.frame_width = request.frame_width;
  next.frame_height = request.frame_height;
  const auto& box = request.bounds;
  next.information = {box[0], box[1], box[2] - box[0], box[3] - box[1]};
  const float center_x = next.information[0] + next.information[2] / 2.0F;
  const float center_y = next.information[1] + next.information[3] / 2.0F;
  float scale = request.requested_scale;
  if (next.expand_detection && request.has_detection) {
    const float coverage = std::max(next.information[3] * 1.0F / static_cast<float>(next.frame_height),
                                    next.information[2] * 1.0F / static_cast<float>(next.frame_width));
    scale = std::max(coverage + 0.05F, scale);
  }
  scale = clip(scale, next.previous_scale - 0.05F, 1.0F);
  const float width = scale * static_cast<float>(next.frame_width);
  const float height = scale * static_cast<float>(next.frame_height);
  const auto left = crop_origin(center_x, width, next.frame_width, box[0]);
  const auto top = crop_origin(center_y, height, next.frame_height, box[1]);
  const auto right = static_cast<std::int32_t>(static_cast<float>(left) + width);
  const auto bottom = static_cast<std::int32_t>(static_cast<float>(top) + height);
  next.output = {left, top, right - left, bottom - top};
  next.previous_scale = scale;
  state_ = next;
  return true;
}

bool CenterFocus::initialize(const CenterFocusConfiguration& configuration) noexcept {
  if (!environment() || !valid_scale(configuration.scale) ||
      !valid_dimension(configuration.frame_width) || !valid_dimension(configuration.frame_height) ||
      !std::isfinite(configuration.anchor_x) || !std::isfinite(configuration.anchor_y) ||
      configuration.anchor_x < 0.0F || configuration.anchor_x > 1.0F ||
      configuration.anchor_y < 0.0F || configuration.anchor_y > 1.0F) return false;
  auto next = state_;
  next.configuration = configuration;
  if (!next.initialized_bounds) {
    const float center_x = static_cast<float>(configuration.frame_width / 2);
    const float center_y = static_cast<float>(configuration.frame_height / 2);
    const float half_width = (static_cast<float>(configuration.frame_width) * configuration.scale) / 2.0F;
    const float half_height = (static_cast<float>(configuration.frame_height) * configuration.scale) / 2.0F;
    next.previous = {center_x - half_width, center_y - half_height,
                     center_x + half_width, center_y + half_height};
    next.initialized_bounds = true;
  }
  next.ready = true;
  CropPlanner planner;
  if (!planner.initialize(configuration.scale, true)) return false;
  planner_ = planner;
  smoother_.reset();
  state_ = next;
  return true;
}
void CenterFocus::reset() noexcept {
  state_.configuration = {};
  state_.initialized_bounds = false;
  state_.ready = false;
}
bool CenterFocus::process(std::span<const float> bounds) noexcept {
  if (!environment() || !state_.ready || (!bounds.empty() && (!valid_bounds(bounds) || bounds[0] > bounds[2] || bounds[1] > bounds[3]))) return false;
  auto next = state_;
  const auto& config = next.configuration;
  const bool detected = !bounds.empty();
  if (detected) {
    std::copy(bounds.begin(), bounds.end(), next.incoming.begin());
    for (std::size_t edge = 0; edge < next.adjusted.size(); ++edge) {
      const auto dimension = edge % 2 == 0 ? config.frame_width : config.frame_height;
      next.adjusted[edge] = adjust_edge(next.previous[edge], next.incoming[edge], dimension);
    }
  } else {
    next.adjusted = next.previous;
  }
  auto planner = planner_;
  if (!planner.process({config.frame_width, config.frame_height, next.adjusted, config.scale, detected})) return false;
  auto smoother = smoother_;
  if (!smoother.process({planner.state().output, config.frame_width, config.frame_height})) return false;
  if (detected) next.previous = next.adjusted;
  const auto& output = smoother.state().output;
  next.output = {static_cast<float>(output.x), static_cast<float>(output.y),
                 static_cast<float>(output.x + output.width), static_cast<float>(output.y + output.height)};
  planner_ = planner;
  smoother_ = smoother;
  state_ = next;
  return true;
}
}  // namespace lens_contract
