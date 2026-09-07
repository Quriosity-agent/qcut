#pragma once

#include "mip_sample.hpp"

namespace agfx_contract {

struct M4SampleQuery {
  SamplePoint point;
  float lod;
};

struct M4TextureBatch {
  std::span<const TextureView> levels;
  std::span<const M4SampleQuery> queries;
  SampleSettings settings;
  MipFilter mip;
};

// M4 Pro RGBA8/BGRA8 profile: normalized 2D coordinates, transparent border, equal mag/min.
// Each coordinate must be signed zero or have magnitude in [2^-24,8]; smaller nonzero values are unverified.
// Combined spatial-linear and mip-linear filtering of multiple levels remains outside this exact API.
std::array<float, 4> sample_m4_texture(const MipTextureRequest& request);
std::vector<std::array<float, 4>> sample_m4_texture_points(const M4TextureBatch& request);

} // namespace agfx_contract
