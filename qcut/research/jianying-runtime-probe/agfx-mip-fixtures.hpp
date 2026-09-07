#pragma once

#include "agfx-texture-runtime.hpp"

#include <bit>
#include <cmath>
#include <limits>
#include <set>

namespace agfx_mip_probe {
using Pixel = std::array<std::uint8_t, 4>;
using Query = std::array<float, 4>;

inline Pixel constant_color(std::uint32_t level) {
  return {static_cast<std::uint8_t>((level * 37 + 13) % 256),
          static_cast<std::uint8_t>((level * 71 + 41) % 256),
          static_cast<std::uint8_t>((level * 109 + 213) % 256),
          static_cast<std::uint8_t>((level * 53 + 197) % 256)};
}

inline Pixel pair_color(std::uint32_t value, bool second) {
  return {static_cast<std::uint8_t>(value), static_cast<std::uint8_t>(255 - value),
          static_cast<std::uint8_t>(value ^ (second ? 0xaaU : 0x55U)),
          static_cast<std::uint8_t>(value ^ (second ? 0x55U : 0xaaU))};
}

inline void store_pixel(std::vector<std::uint8_t>& bytes, std::size_t offset, Pixel pixel, int format) {
  if (format == 50) std::swap(pixel[0], pixel[2]);
  for (std::size_t channel = 0; channel < 4; ++channel) bytes[offset + channel] = pixel[channel];
}

inline agfx_probe::TextureUpload constant_upload(std::uint32_t count, int format) {
  const auto width = 1U << (count - 1);
  agfx_probe::TextureUpload result{static_cast<int>(width), 1, 1, format, {}, {}};
  for (std::uint32_t level = 0; level < count; ++level) {
    const auto size = width >> level;
    auto& bytes = result.levels.emplace_back(static_cast<std::size_t>(size) * 4);
    result.row_strides.push_back(static_cast<int>(size * 4));
    for (std::uint32_t x = 0; x < size; ++x) store_pixel(bytes, x * 4, constant_color(level), format);
  }
  return result;
}

inline agfx_probe::TextureUpload pair_upload(int format) {
  agfx_probe::TextureUpload result{512, 512, 1, format,
      {std::vector<std::uint8_t>(512 * 512 * 4), std::vector<std::uint8_t>(256 * 256 * 4)}, {512 * 4, 256 * 4}};
  for (std::uint32_t b = 0; b < 256; ++b) {
    for (std::uint32_t a = 0; a < 256; ++a) {
      for (std::uint32_t dy = 0; dy < 2; ++dy) {
        for (std::uint32_t dx = 0; dx < 2; ++dx) {
          store_pixel(result.levels[0], ((b * 2 + dy) * 512 + a * 2 + dx) * 4, pair_color(a, false), format);
        }
      }
      store_pixel(result.levels[1], (b * 256 + a) * 4, pair_color(b, true), format);
    }
  }
  return result;
}

// Exact binary16 decoding for fixture generation, independent of the implementation's rounding formula.
inline float half_value(std::uint32_t bits) {
  const auto exponent = (bits >> 10) & 31U;
  const auto fraction = bits & 1023U;
  if (exponent == 0) return std::ldexp(static_cast<float>(fraction), -24);
  return std::ldexp(static_cast<float>(1024 + fraction), static_cast<int>(exponent) - 25);
}

inline std::vector<Query> lod_queries(std::uint32_t levels) {
  std::set<std::uint32_t> bits;
  auto add = [&](float value) {
    if (std::isfinite(value)) bits.insert(std::bit_cast<std::uint32_t>(value));
  };
  const float infinity = std::numeric_limits<float>::infinity();
  auto neighbors = [&](float value) {
    add(std::nextafter(value, -infinity)); add(value); add(std::nextafter(value, infinity));
  };
  for (std::int32_t step = -2048; step <= static_cast<std::int32_t>(levels + 1) * 2048; ++step) {
    add(static_cast<float>(step) / 2048.0F);
  }
  // Every positive binary16 rounding boundary through the last selected level, including subnormals.
  for (std::uint32_t half = 0; half < 0x4c00U; ++half) {
    const float lower = half_value(half);
    const float upper = half_value(half + 1);
    if (lower > static_cast<float>(levels)) break;
    neighbors((lower + upper) * .5F);
  }
  for (std::uint32_t bin = 0; bin <= levels * 64; ++bin) neighbors(static_cast<float>(bin) / 64.0F);
  for (const auto value : {0.0F, -0.0F, std::numeric_limits<float>::max(), -std::numeric_limits<float>::max(),
                           std::numeric_limits<float>::min(), -std::numeric_limits<float>::min()}) add(value);
  std::uint32_t state = 0x81a739c5U ^ levels;
  for (std::uint32_t index = 0; index < 8192; ++index) {
    state ^= state << 13; state ^= state >> 17; state ^= state << 5;
    add(std::bit_cast<float>(state));
    add(static_cast<float>(state & 0xffffffU) / 16777216.0F * static_cast<float>(levels + 2) - 1.0F);
  }
  std::vector<Query> result;
  result.reserve(bits.size());
  for (const auto value : bits) result.push_back({.5F, .5F, .5F, std::bit_cast<float>(value)});
  return result;
}

inline std::vector<Query> pair_queries(std::uint32_t weight) {
  std::vector<Query> result;
  result.reserve(65536);
  for (std::uint32_t b = 0; b < 256; ++b) {
    for (std::uint32_t a = 0; a < 256; ++a) {
      result.push_back({(static_cast<float>(a) + .5F) / 256.0F,
                        (static_cast<float>(b) + .5F) / 256.0F, .5F,
                        static_cast<float>(weight) / 64.0F});
    }
  }
  return result;
}
}  // namespace agfx_mip_probe
