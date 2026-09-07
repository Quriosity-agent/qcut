#pragma once

#include "m4_texture.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>

namespace agfx_test {

struct M4TextureFixture {
  std::vector<std::vector<std::uint8_t>> storage;
  std::vector<agfx_contract::TextureView> levels;
};

inline std::uint32_t next_value(std::uint32_t& state) {
  state = state * 1664525U + 1013904223U;
  return state;
}

inline M4TextureFixture m4_fixture(std::uint32_t width, std::uint32_t height, bool bgra) {
  M4TextureFixture result;
  const auto count = static_cast<std::uint32_t>(std::bit_width(std::max(width, height)));
  result.storage.reserve(count);
  result.levels.reserve(count);
  std::uint32_t seed = width * 1741U + height * 4729U;
  for (std::uint32_t level = 0; level < count; ++level) {
    const auto stride = static_cast<std::size_t>(width) * 4 + 12;
    auto& pixels = result.storage.emplace_back(stride * height, 0xbd);
    for (std::uint32_t y = 0; y < height; ++y) {
      for (std::uint32_t x = 0; x < width; ++x) {
        const auto bits = next_value(seed);
        const auto offset = y * stride + static_cast<std::size_t>(x) * 4;
        for (std::size_t c = 0; c < 4; ++c) pixels[offset + c] = static_cast<std::uint8_t>(bits >> (c * 8));
        if (bgra) std::swap(pixels[offset], pixels[offset + 2]);
      }
    }
    result.levels.push_back({pixels, width, height, 1, stride, 0,
        bgra ? agfx_contract::ChannelOrder::bgra : agfx_contract::ChannelOrder::rgba});
    width = std::max(1U, width / 2);
    height = std::max(1U, height / 2);
  }
  return result;
}

inline std::vector<agfx_contract::M4SampleQuery> m4_queries(std::uint32_t width, std::uint32_t height) {
  std::vector<agfx_contract::M4SampleQuery> result;
  const float count = static_cast<float>(std::bit_width(std::max(width, height)));
  std::uint32_t seed = width * 719U + height * 4111U;
  for (std::uint32_t i = 0; i < 8192; ++i) {
    const auto coordinate = [&] {
      return static_cast<float>(next_value(seed) & 0xffffffU) / 16777216.0F * 16.0F - 8.0F;
    };
    const auto u = coordinate();
    const auto v = coordinate();
    const auto lod = static_cast<float>(next_value(seed) & 0xffffffU) / 16777216.0F * (count + 2) - 1.0F;
    result.push_back({{u, v}, lod});
  }
  const std::array edges{-8.0F, -2.0F, -1.0F, -.5F, -.0F, .0F,
      -0x1p-24F, 0x1p-24F, std::nextafter(-0x1p-24F, -1.0F), std::nextafter(0x1p-24F, 1.0F),
      .5F, 1.0F, 2.0F, 8.0F};
  for (const auto u : edges) {
    for (const auto v : edges) {
      for (const auto lod : {-1.0F, .0F, .51F, 1.51F, count}) result.push_back({{u, v}, lod});
    }
  }
  for (std::uint32_t axis = 0; axis < 2; ++axis) {
    const auto extent = axis == 0 ? width : height;
    for (const auto cell : {0U, extent / 2, extent - 1}) {
      for (std::uint32_t step = 0; step <= 256; ++step) {
        const float boundary = (static_cast<float>(cell) + .5F + (static_cast<float>(step) + .5F) / 256.0F) /
            static_cast<float>(extent);
        for (const auto value : {std::nextafter(boundary, -1.0F), boundary, std::nextafter(boundary, 2.0F)}) {
          result.push_back({axis == 0 ? agfx_contract::SamplePoint{value, .3713F} : agfx_contract::SamplePoint{.3713F, value}, 0});
        }
      }
      const float boundary = static_cast<float>(cell) / static_cast<float>(extent);
      for (const auto value : {std::nextafter(boundary, -1.0F), boundary, std::nextafter(boundary, 2.0F)}) {
        if (value != 0 && std::abs(value) < 0x1p-24F) continue;
        result.push_back({axis == 0 ? agfx_contract::SamplePoint{value, .3713F} : agfx_contract::SamplePoint{.3713F, value}, 0});
      }
    }
  }
  return result;
}

inline void hash_color(std::uint64_t& hash, const std::array<float, 4>& value) {
  for (const auto channel : value) {
    const auto bits = std::bit_cast<std::uint32_t>(channel);
    for (unsigned shift = 0; shift < 32; shift += 8) {
      hash ^= (bits >> shift) & 255U;
      hash *= 1099511628211ULL;
    }
  }
}

} // namespace agfx_test
