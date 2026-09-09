#include "m4_spatial.hpp"
#include "texture_address.hpp"

#include <cmath>
#include <utility>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The M4 spatial profile requires IEEE floating-point semantics"
#endif

namespace agfx_contract::detail {
namespace {

struct AxisFootprint {
  std::array<std::int64_t, 2> texels;
  std::uint32_t weight;
};

AxisFootprint footprint(float coordinate, std::uint32_t extent, TexelFilter filter, TexelWrap wrap) {
  if (wrap == TexelWrap::repeat) coordinate -= std::floor(coordinate);
  if (wrap == TexelWrap::mirror) coordinate -= std::floor(coordinate / 2.0F) * 2.0F;
  const float scaled = coordinate * static_cast<float>(extent);
  const float position = scaled - (filter == TexelFilter::linear ? .5F : 0.0F);
  const float first = std::floor(position);
  const auto index = static_cast<std::int64_t>(first);
  const auto weight = filter == TexelFilter::nearest ? 0U :
      static_cast<std::uint32_t>(std::floor(static_cast<double>(position - first) * 256.0 + .5));
  AxisFootprint result{{address_texel(index, extent, wrap), address_texel(index + 1, extent, wrap)}, weight};
  // Equal addressed texels collapse before joint weight rounding, even though ordinary bilinear sums hide it.
  if (result.texels[0] == result.texels[1]) {
    result.weight = 0;
  }
  if (wrap == TexelWrap::mirror && result.texels[1] < result.texels[0]) {
    std::swap(result.texels[0], result.texels[1]);
    result.weight = 256 - result.weight;
  }
  return result;
}

} // namespace

std::array<std::uint32_t, 4> weighted_m4_layer(const TextureView& texture,
    const SamplePoint& point, const SampleSettings& settings, std::uint32_t mip_weight) {
  std::array<std::uint32_t, 4> result{};
  if (mip_weight == 0) return result;
  const auto column = footprint(point.u, texture.width, settings.filter, settings.wrap_s);
  const auto row = footprint(point.v, texture.height, settings.filter, settings.wrap_t);
  for (std::uint32_t y = 0; y < 2; ++y) {
    const auto row_weight = y == 0 ? 256 - row.weight : row.weight;
    for (std::uint32_t x = 0; x < 2; ++x) {
      const auto column_weight = x == 0 ? 256 - column.weight : column.weight;
      // Top-row ties round up and bottom-row ties down after clamp/mirror footprint normalization.
      const auto joint = column_weight * row_weight * mip_weight;
      const auto weight = (joint + (y == 0 ? 32U : 31U)) / 64;
      if (weight == 0 || column.texels[x] < 0 || row.texels[y] < 0) continue;
      const auto pixel = rgba8_texel(texture, column.texels[x], row.texels[y], 0);
      for (std::size_t channel = 0; channel < 4; ++channel) result[channel] += pixel[channel] * weight;
    }
  }
  return result;
}

} // namespace agfx_contract::detail
