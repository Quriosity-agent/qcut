#pragma once

#include "image.hpp"

namespace fog_contract {

enum class BlurAxis { horizontal, vertical };

struct BlurRequest {
    const softglow::Image& source;
    float size;
    BlurAxis axis;
};

// Horizontal taps replace alpha with the luminance threshold before accumulation.
softglow::Image weighted_blur(const BlurRequest& request);

} // namespace fog_contract
