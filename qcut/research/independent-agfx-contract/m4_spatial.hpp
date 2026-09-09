#pragma once

#include "texture_sample.hpp"

namespace agfx_contract::detail {

// Receives validated texture/coordinates/settings and a mip weight in [0,64].
std::array<std::uint32_t, 4> weighted_m4_layer(const TextureView& texture,
    const SamplePoint& point, const SampleSettings& settings, std::uint32_t mip_weight);

} // namespace agfx_contract::detail
