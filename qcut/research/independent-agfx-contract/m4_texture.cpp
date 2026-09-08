#include "m4_texture.hpp"
#include "m4_spatial.hpp"

#include <cfenv>
#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The M4 spatial profile requires IEEE floating-point semantics"
#endif

namespace agfx_contract {
namespace {

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
  std::vector<TextureView> levels;
  levels.reserve(request.levels.size());
  for (const auto& level : request.levels) levels.push_back(validate_texture_view(level));
  for (const auto& query : request.queries) validate_query(query);
  return levels;
}

std::array<float, 4> sample(std::span<const TextureView> levels, const M4SampleQuery& query,
                           const SampleSettings& settings, MipFilter mip) {
  const auto selection = select_m4_mip({query.lod, static_cast<std::uint32_t>(levels.size()), mip});
  const auto first = detail::weighted_m4_layer(levels[selection.first], query.point, settings, 64 - selection.weight_64);
  const auto second = detail::weighted_m4_layer(levels[selection.second], query.point, settings, selection.weight_64);
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < 4; ++channel) {
    const auto weighted = first[channel] + second[channel];
    result[channel] = static_cast<float>((weighted + 2048) / 4096) / 4080.0F;
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
