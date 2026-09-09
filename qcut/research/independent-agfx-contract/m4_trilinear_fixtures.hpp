#pragma once

#include "m4_texture_fixtures.hpp"

namespace agfx_test {

inline constexpr std::uint32_t trilinear_pattern = 0x42543347U;

inline std::vector<agfx_contract::M4SampleQuery> trilinear_queries(
    std::uint32_t width, std::uint32_t height, std::uint32_t levels) {
  auto result = m4_queries(width, height);
  std::uint32_t seed = (width * 983U + height * 137U) ^ trilinear_pattern;
  for (std::uint32_t i = 0; i < 32768; ++i) {
    const auto coordinate = [&] {
      return static_cast<float>(next_value(seed) & 0xffffffU) / 1048576.0F - 8.0F;
    };
    const auto u = coordinate();
    const auto v = coordinate();
    const auto lod = static_cast<float>(next_value(seed) & 0xffffffU) / 16777216.0F *
        static_cast<float>(levels + 2) - 1.0F;
    result.push_back({{u, v}, lod});
  }
  for (std::uint32_t y = 0; y <= 256; ++y) {
    for (std::uint32_t x = 0; x <= 256; ++x) {
      const auto u = (static_cast<float>(width / 2) + .5F + static_cast<float>(x) / 256.0F) /
          static_cast<float>(width);
      const auto v = (static_cast<float>(height / 2) + .5F + static_cast<float>(y) / 256.0F) /
          static_cast<float>(height);
      const auto first = (x * 5 + y * 17) % std::max(1U, levels - 1);
      const auto amount = 1 + (x * 29 + y * 13) % 63;
      const auto lod = static_cast<float>(first) + static_cast<float>(amount) / 64.0F;
      result.push_back({{u, v}, lod});
    }
  }
  return result;
}

inline std::vector<agfx_contract::M4SampleQuery> trilinear_portable_queries() {
  const auto full = trilinear_queries(3, 5, 3);
  std::vector<agfx_contract::M4SampleQuery> result;
  for (std::size_t i = 0; i < full.size(); i += 61) result.push_back(full[i]);
  return result;
}

} // namespace agfx_test
