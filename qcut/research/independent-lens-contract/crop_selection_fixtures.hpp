#pragma once

#include "crop_selection.hpp"
#include "temporal_crop_fixtures.hpp"

#include <bit>
#include <vector>

namespace lens_contract::selection_fixtures {
using temporal_fixtures::Random;
inline CenterFocusConfiguration configuration(std::uint32_t seed) {
  constexpr std::array widths{16, 17, 64, 80, 257, 640, 1920, 8192};
  constexpr std::array heights{16, 31, 48, 40, 145, 480, 1080, 4097};
  constexpr std::array scales{0.125F, 0.37F, 0.8F, 1.0F};
  const auto index = seed % widths.size();
  return {static_cast<float>(seed % 5U) / 4.0F, static_cast<float>((seed / 5U) % 5U) / 4.0F,
          scales[(seed / widths.size()) % scales.size()], widths[index], heights[index]};
}
inline DetectionBounds bounds(Random& random, const CenterFocusConfiguration& config) {
  const float left = static_cast<float>(random.next() % 16385U) / 4.0F - 2048.0F;
  const float top = static_cast<float>(random.next() % 8193U) / 4.0F - 1024.0F;
  const float width = static_cast<float>(random.next() % static_cast<std::uint32_t>(config.frame_width * 2)) / 4.0F;
  const float height = static_cast<float>(random.next() % static_cast<std::uint32_t>(config.frame_height * 2)) / 4.0F;
  return {left, top, left + width, top + height};
}
inline std::vector<std::uint32_t> words(const CenterFocusState& state, const CropPlannerState& crop,
                                        const TemporalCropState& smoother_state) {
  std::vector<std::uint32_t> result;
  const auto add = [&](float value) { result.push_back(std::bit_cast<std::uint32_t>(value)); };
  const auto integer = [&](std::int32_t value) { result.push_back(std::bit_cast<std::uint32_t>(value)); };
  add(state.configuration.anchor_x); add(state.configuration.anchor_y); add(state.configuration.scale);
  integer(state.configuration.frame_width); integer(state.configuration.frame_height);
  result.push_back(state.initialized_bounds); result.push_back(state.ready);
  for (const auto& values : {state.previous, state.incoming, state.adjusted, state.output})
    for (float value : values) add(value);
  add(crop.configured_scale); add(crop.previous_scale); result.push_back(crop.expand_detection);
  integer(crop.frame_width); integer(crop.frame_height);
  for (float value : crop.information) add(value);
  integer(crop.output.x); integer(crop.output.y); integer(crop.output.width); integer(crop.output.height);
  const auto smoother = temporal_fixtures::words(smoother_state);
  result.insert(result.end(), smoother.begin(), smoother.end());
  return result;
}
inline std::vector<std::uint32_t> words(const CenterFocus& focus) {
  return words(focus.state(), focus.planner_state(), focus.smoother_state());
}
inline void hash_words(std::uint64_t& hash, std::span<const std::uint32_t> words) {
  for (auto word : words) {
    for (int index = 0; index < 4; ++index) {
      hash ^= (word >> (index * 8)) & 255U;
      hash *= 1099511628211ULL;
    }
  }
}
}  // namespace lens_contract::selection_fixtures
