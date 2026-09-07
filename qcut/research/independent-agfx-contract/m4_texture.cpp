#include "m4_texture.hpp"
#include "texture_address.hpp"

#include <cfenv>
#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The M4 spatial profile requires IEEE floating-point semantics"
#endif

namespace agfx_contract {
namespace {

struct AxisSample {
  std::int64_t first;
  std::uint32_t weight;
};

AxisSample axis(float coordinate, std::uint32_t extent, TexelFilter filter, TexelWrap wrap) {
  if (wrap == TexelWrap::repeat) {
    coordinate -= std::floor(coordinate);
  }
  if (wrap == TexelWrap::mirror) coordinate -= std::floor(coordinate / 2.0F) * 2.0F;
  const float scaled = coordinate * static_cast<float>(extent);
  const float position = scaled - (filter == TexelFilter::linear ? .5F : 0.0F);
  const float first = std::floor(position);
  const auto weight = filter == TexelFilter::nearest ? 0U :
      static_cast<std::uint32_t>(std::floor(static_cast<double>(position - first) * 256.0 + .5));
  return {static_cast<std::int64_t>(first), weight};
}

bool verified_coordinate(float value) {
  const auto magnitude = std::abs(value);
  return std::isfinite(value) && magnitude <= 8.0F && (magnitude == 0 || magnitude >= 0x1p-24F);
}

void validate_query(const M4SampleQuery& query) {
  if (!verified_coordinate(query.point.u) || !verified_coordinate(query.point.v) ||
      query.point.w != .5F || !std::isfinite(query.lod)) {
    throw std::invalid_argument("M4 sampling requires 2D coordinates with magnitude zero or [2^-24,8] and finite LOD");
  }
}

std::vector<TextureView> prepare(const M4TextureBatch& request) {
  if (std::fegetround() != FE_TONEAREST) throw std::invalid_argument("M4 sampling requires nearest floating-point rounding");
  validate_sample_settings(request.settings);
  validate_mip_chain(request.levels);
  select_m4_mip({0, static_cast<std::uint32_t>(request.levels.size()), request.mip});
  if (request.settings.border_color != std::array<float, 4>{}) {
    throw std::invalid_argument("Only transparent black border is verified for M4 sampling");
  }
  if (request.levels.size() > 1 && request.mip == MipFilter::linear && request.settings.filter == TexelFilter::linear) {
    throw std::invalid_argument("Combined spatial-linear and mip-linear precision is not yet verified");
  }
  std::vector<TextureView> levels;
  levels.reserve(request.levels.size());
  for (const auto& level : request.levels) levels.push_back(validate_texture_view(level));
  for (const auto& query : request.queries) validate_query(query);
  return levels;
}

std::array<std::uint32_t, 4> weighted_texels(const TextureView& texture, const SamplePoint& point,
                                           const SampleSettings& settings) {
  const auto column = axis(point.u, texture.width, settings.filter, settings.wrap_s);
  const auto row = axis(point.v, texture.height, settings.filter, settings.wrap_t);
  std::array<std::uint32_t, 4> result{};
  for (std::uint32_t y = 0; y < 2; ++y) {
    const auto row_weight = y == 0 ? 256 - row.weight : row.weight;
    if (row_weight == 0) continue;
    for (std::uint32_t x = 0; x < 2; ++x) {
      const auto column_weight = x == 0 ? 256 - column.weight : column.weight;
      if (column_weight == 0) continue;
      const auto tx = detail::address_texel(column.first + x, texture.width, settings.wrap_s);
      const auto ty = detail::address_texel(row.first + y, texture.height, settings.wrap_t);
      if (tx < 0 || ty < 0) continue;
      const auto pixel = detail::rgba8_texel(texture, tx, ty, 0);
      for (std::size_t channel = 0; channel < 4; ++channel) {
        result[channel] += pixel[channel] * column_weight * row_weight;
      }
    }
  }
  return result;
}

std::array<float, 4> sample(std::span<const TextureView> levels, const M4SampleQuery& query,
                           const SampleSettings& settings, MipFilter mip) {
  const auto selection = select_m4_mip({query.lod, static_cast<std::uint32_t>(levels.size()), mip});
  const auto first = weighted_texels(levels[selection.first], query.point, settings);
  const auto second = selection.second == selection.first || selection.weight_64 == 0 ? first :
      weighted_texels(levels[selection.second], query.point, settings);
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < 4; ++channel) {
    const auto weighted = first[channel] * (64 - selection.weight_64) + second[channel] * selection.weight_64;
    // Preserve all four spatial taps until the final byte/16 rounding; the maximum sum fits uint32.
    result[channel] = static_cast<float>((weighted + 131072) / 262144) / 4080.0F;
  }
  return result;
}

} // namespace

std::array<float, 4> sample_m4_texture(const MipTextureRequest& request) {
  const std::array query{M4SampleQuery{request.point, request.lod}};
  const auto levels = prepare({request.levels, query, request.settings, request.filter});
  return sample(levels, query.front(), request.settings, request.filter);
}

std::vector<std::array<float, 4>> sample_m4_texture_points(const M4TextureBatch& request) {
  const auto levels = prepare(request);
  std::vector<std::array<float, 4>> result;
  result.reserve(request.queries.size());
  for (const auto& query : request.queries) result.push_back(sample(levels, query, request.settings, request.mip));
  return result;
}

} // namespace agfx_contract
