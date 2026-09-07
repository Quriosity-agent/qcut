#pragma once

#include "image.hpp"

namespace softglow {

enum class BlitTarget { rgba8, rgba32f };

struct BlitResizeRequest {
    const Image& source;
    int width;
    int height;
    BlitTarget target = BlitTarget::rgba8;
    bool reverse_source_y = false;
};

// Measured M4 CGL profile: 8-bit weights and one final 4-bit sub-byte rounding.
Image blit_resize(const BlitResizeRequest& request);

} // namespace softglow
