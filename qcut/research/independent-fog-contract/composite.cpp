#include "composite.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The Fog contract requires IEEE floating-point semantics"
#endif

namespace fog_contract {

softglow::Image composite(const CompositeRequest& request) {
    softglow::validate_image(request.source);
    softglow::validate_image(request.blurred);
    if (request.source.width != request.blurred.width || request.source.height != request.blurred.height) {
        throw std::invalid_argument("Fog composite dimensions must match");
    }
    if (!std::isfinite(request.original_weight) || request.original_weight < 0 || request.original_weight > 1) {
        throw std::invalid_argument("Fog original weight must be finite and in [0, 1]");
    }
    softglow::Image result(request.source.width, request.source.height);
    for (std::size_t i = 0; i < result.pixels.size(); ++i) {
        const auto& original = request.source.pixels[i];
        const auto& blurred = request.blurred.pixels[i];
        const float shadow_weight = blurred[3] * 0.457F;
        softglow::Pixel pixel = original;
        for (std::size_t channel = 0; channel < 3; ++channel) {
            const float softened = std::lerp(original[channel], blurred[channel], 1 - shadow_weight);
            const float screened = 1 - (1 - original[channel]) * (1 - softened);
            const float mixed = std::lerp(screened, softened, 0.25F);
            pixel[channel] = std::clamp(std::lerp(mixed, original[channel], request.original_weight), 0.0F, original[3]);
        }
        result.pixels[i] = softglow::rgba8(pixel);
    }
    return result;
}

} // namespace fog_contract
