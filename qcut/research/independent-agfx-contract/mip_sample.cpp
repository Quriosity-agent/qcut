#include "mip_sample.hpp"

#include <algorithm>
#include <bit>
#include <cfenv>
#include <cmath>
#include <limits>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The M4 LOD profile requires IEEE floating-point semantics"
#endif

namespace agfx_contract {
namespace {

static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559 &&
              std::numeric_limits<float>::digits == 24);

std::uint32_t quantized_lod(float lod) {
  if (lod < 1.0F / 128.0F) return 0;
  const auto bits = std::bit_cast<std::uint32_t>(lod);
  // The remaining domain is normal binary16: discard 13 fraction bits with ties to even.
  const auto rounded = (bits + 0xfffU + ((bits >> 13) & 1U)) & ~0x1fffU;
  return static_cast<std::uint32_t>(std::bit_cast<float>(rounded) * 64.0F);
}

void validate_levels(std::span<const TextureView> levels) {
  if (levels.empty() || levels.size() > 15) throw std::invalid_argument("Mip chain requires 1..15 levels");
  const auto& first = levels.front();
  if (first.width == 0 || first.height == 0 || first.width > 16384 || first.height > 16384 ||
      levels.size() > static_cast<std::size_t>(std::bit_width(std::max(first.width, first.height)))) {
    throw std::invalid_argument("Mip dimensions or level count exceed the verified 2D domain");
  }
  auto width = first.width;
  auto height = first.height;
  for (const auto& texture : levels) {
    if (texture.width != width || texture.height != height || texture.depth != 1 || texture.order != first.order) {
      throw std::invalid_argument("Mip levels require matching channel order and halved 2D dimensions");
    }
    // Reuse byte/stride/overflow validation even when this level is not selected.
    validate_texture_view(texture);
    width = std::max(1U, width / 2);
    height = std::max(1U, height / 2);
  }
}

} // namespace

void validate_mip_chain(std::span<const TextureView> levels) {
  validate_levels(levels);
}

MipSelection select_m4_mip(const MipRequest& request) {
  if (!std::isfinite(request.lod) || request.level_count == 0 || request.level_count > 15) {
    throw std::invalid_argument("Explicit LOD must be finite with 1..15 levels");
  }
  if (request.filter != MipFilter::none && request.filter != MipFilter::nearest && request.filter != MipFilter::linear) {
    throw std::invalid_argument("Unknown mip filter");
  }
  if (request.filter == MipFilter::none) return {0, 0, 0};
  const auto fixed = quantized_lod(std::clamp(request.lod, 0.0F, static_cast<float>(request.level_count - 1)));
  const auto first = fixed / 64;
  const auto fraction = fixed % 64;
  if (request.filter == MipFilter::nearest) {
    const auto selected = first + (fraction > 32 ? 1U : 0U);
    return {selected, selected, 0};
  }
  return {first, std::min(first + 1, request.level_count - 1), fraction};
}

std::array<float, 4> blend_m4_mip_texels(const MipTexelBlend& request) {
  if (request.weight_64 > 64) throw std::invalid_argument("Mip blend weight exceeds 64");
  if (std::fegetround() != FE_TONEAREST) throw std::invalid_argument("M4 texel blend requires nearest floating-point rounding");
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < result.size(); ++channel) {
    const auto weighted = static_cast<std::uint32_t>(request.first[channel]) * (64 - request.weight_64) +
                          static_cast<std::uint32_t>(request.second[channel]) * request.weight_64;
    // Half steps round upward in byte/16 space, including descending color pairs.
    result[channel] = static_cast<float>((weighted + 2) / 4) / 4080.0F;
  }
  return result;
}

std::array<float, 4> sample_m4_mip_texture(const MipTextureRequest& request) {
  validate_levels(request.levels);
  if (request.point.w != 0.5F) throw std::invalid_argument("Explicit mip reference currently supports 2D coordinates");
  const auto selected = select_m4_mip({request.lod, static_cast<std::uint32_t>(request.levels.size()), request.filter});
  auto first = sample_texture(request.levels[selected.first], request.point, request.settings);
  if (selected.first == selected.second || selected.weight_64 == 0) return first;
  const auto second = sample_texture(request.levels[selected.second], request.point, request.settings);
  const float amount = static_cast<float>(selected.weight_64) / 64.0F;
  for (std::size_t channel = 0; channel < first.size(); ++channel) first[channel] += (second[channel] - first[channel]) * amount;
  return first;
}

} // namespace agfx_contract
