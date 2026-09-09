#pragma once

#include "texture_sample.hpp"

namespace agfx_contract {

enum class MipFilter { none, nearest, linear };

struct MipRequest {
  float lod;
  std::uint32_t level_count;
  MipFilter filter;
};

struct MipSelection {
  std::uint32_t first;
  std::uint32_t second;
  std::uint32_t weight_64;
  friend bool operator==(const MipSelection&, const MipSelection&) = default;
};

// Explicit-LOD profile measured on Apple M4; not a portable Metal hardware guarantee.
MipSelection select_m4_mip(const MipRequest& request);
void validate_mip_chain(std::span<const TextureView> levels);

struct MipTexelBlend {
  std::array<std::uint8_t, 4> first;
  std::array<std::uint8_t, 4> second;
  std::uint32_t weight_64;
};

// Exact RGBA8 cross-level amplitude profile; requires FE_TONEAREST.
std::array<float, 4> blend_m4_mip_texels(const MipTexelBlend& request);

struct MipTextureRequest {
  std::span<const TextureView> levels;
  SamplePoint point;
  SampleSettings settings;
  float lod;
  MipFilter filter;
};

// Approximate amplitude reference: measured mip selection, float spatial and cross-level blending.
// Use blend_m4_mip_texels for the exact RGBA8 cross-level amplitude primitive.
std::array<float, 4> sample_m4_mip_texture(const MipTextureRequest& request);

} // namespace agfx_contract
