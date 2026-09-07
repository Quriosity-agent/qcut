#pragma once

#include "temporal_crop.hpp"

#include <array>
#include <bit>
#include <cstddef>
#include <vector>

namespace lens_contract::temporal_fixtures {
struct Random {
  std::uint32_t value;
  std::uint32_t next() noexcept {
    value ^= value << 13U;
    value ^= value >> 17U;
    value ^= value << 5U;
    return value;
  }
  std::int32_t integer(std::uint32_t count) noexcept {
    return static_cast<std::int32_t>(next() % count);
  }
};

inline std::vector<TemporalCropRequest> sequence(std::uint32_t seed, std::size_t count) {
  Random random{seed + 0x9e3779b9U};
  std::vector<TemporalCropRequest> result;
  constexpr std::array<std::int32_t, 8> dimensions{1, 2, 17, 64, 180, 640, 8192, 32768};
  constexpr std::array<float, 8> limits{0.0F, 0.01F, 0.2F, 0.7F, 0.95F, 0.999F, 1.0F, -0.0F};
  constexpr std::array<float, 8> fractions{0.0F, 0.00001F, 0.001F, 0.05F, 0.2F, 0.7F, 1.0F, -0.0F};
  for (std::size_t frame = 0; frame < count; ++frame) {
    TemporalCropRequest request{{}, dimensions[random.next() % dimensions.size()],
                                      dimensions[random.next() % dimensions.size()]};
    request.rectangle = {random.integer(65537) - 32768, random.integer(65537) - 32768,
                         2 + random.integer(32767), 1 + random.integer(32768)};
    if (seed % 3U == 0U) {
      request.frame_width = 640;
      request.frame_height = 360;
      request.rectangle = {random.integer(400), random.integer(200),
                           2 + random.integer(200), 1 + random.integer(120)};
    }
    if (frame % 13U == 0U) {
      request.history_limit = limits[random.next() % limits.size()];
      request.motion_fraction = fractions[random.next() % fractions.size()];
    } else if (frame % 7U == 0U) {
      request.history_limit = -1.0F;
      request.motion_fraction = 0.99F;
    } else if (frame % 11U == 0U) {
      request.history_limit = 0.11F;
      request.motion_fraction = -0.1F;
    }
    result.push_back(request);
  }
  return result;
}

inline std::vector<CropInterpolationRequest> interpolations(std::size_t count) {
  Random random{0x87654321U};
  std::vector<CropInterpolationRequest> result;
  constexpr std::array<float, 8> ratios{0.0F, 0.01F, 0.5F, 1.0F, 1.7777778F, 3.7F, 16000.0F, 32768.0F};
  for (std::size_t index = 0; index < count; ++index) {
    result.push_back({static_cast<float>(random.next() % 65537U) / 65536.0F,
        random.integer(131073) - 65536, random.integer(131073) - 65536,
        random.integer(32769), random.integer(131073) - 65536,
        random.integer(131073) - 65536, random.integer(32769), ratios[index % ratios.size()]});
  }
  return result;
}

inline std::array<std::uint32_t, 13> words(const TemporalCropState& state) noexcept {
  return {static_cast<std::uint32_t>(state.frame_width), static_cast<std::uint32_t>(state.frame_height),
      std::bit_cast<std::uint32_t>(state.history_limit), std::bit_cast<std::uint32_t>(state.motion_fraction),
      std::bit_cast<std::uint32_t>(state.center_x), std::bit_cast<std::uint32_t>(state.center_y),
      std::bit_cast<std::uint32_t>(state.horizontal_extent), state.first_frame ? 1U : 0U,
      state.processed_frames, static_cast<std::uint32_t>(state.output.x),
      static_cast<std::uint32_t>(state.output.y), static_cast<std::uint32_t>(state.output.width),
      static_cast<std::uint32_t>(state.output.height)};
}

inline void hash_word(std::uint64_t& hash, std::uint32_t word) noexcept {
  for (unsigned byte = 0; byte < 4; ++byte) {
    hash ^= (word >> (byte * 8U)) & 0xffU;
    hash *= 1099511628211ULL;
  }
}
inline void hash_state(std::uint64_t& hash, const TemporalCropState& state) noexcept {
  for (auto word : words(state)) hash_word(hash, word);
}
inline void hash_bounds(std::uint64_t& hash, const CropBounds& bounds) noexcept {
  for (float value : {bounds.left, bounds.right, bounds.top, bounds.bottom}) {
    hash_word(hash, std::bit_cast<std::uint32_t>(value));
  }
}
}  // namespace lens_contract::temporal_fixtures
