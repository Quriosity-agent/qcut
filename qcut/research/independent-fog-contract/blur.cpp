#include "blur.hpp"

#include <array>
#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The Fog contract requires IEEE floating-point semantics"
#endif

namespace fog_contract {
namespace {

softglow::Pixel threshold(softglow::Pixel pixel) {
    const float red = pixel[0] * 0.299F;
    const float green = pixel[1] * 0.587F;
    const float blue = pixel[2] * 0.114F;
    pixel[3] = (red + green) + blue > 0.5F ? 0 : 1;
    return pixel;
}

} // namespace

softglow::Image weighted_blur(const BlurRequest& request) {
    softglow::validate_image(request.source);
    if (!std::isfinite(request.size) || request.size < 0 || request.size > 4) {
        throw std::invalid_argument("Fog blur size must be finite and in [0, 4]");
    }
    if (request.axis != BlurAxis::horizontal && request.axis != BlurAxis::vertical) {
        throw std::invalid_argument("Unknown fog blur axis");
    }
    const bool horizontal = request.axis == BlurAxis::horizontal;
    constexpr std::array<float, 9> weights{0.20F, 0.19F, 0.17F, 0.15F, 0.13F, 0.11F, 0.08F, 0.05F, 0.02F};
    const auto& source = request.source;
    const float step_x = (request.size / static_cast<float>(source.width)) * 1.25F;
    const float step_y = (request.size / static_cast<float>(source.height)) * 1.25F;
    softglow::Image result(source.width, source.height);
    for (int y = 0; y < source.height; ++y) {
        const float v = (static_cast<float>(y) + 0.5F) / static_cast<float>(source.height);
        for (int x = 0; x < source.width; ++x) {
            const float u = (static_cast<float>(x) + 0.5F) / static_cast<float>(source.width);
            auto center = softglow::sample({source, u, v});
            if (horizontal) center = threshold(center);
            softglow::Pixel accumulated{};
            float denominator = weights[0];
            for (std::size_t distance = 1; distance < weights.size(); ++distance) {
                const float dx = horizontal ? static_cast<float>(distance) * step_x : 0;
                const float dy = horizontal ? 0 : static_cast<float>(distance) * step_y;
                auto positive = softglow::sample({source, u + dx, v + dy});
                auto negative = softglow::sample({source, u - dx, v - dy});
                if (horizontal) {
                    positive = threshold(positive);
                    negative = threshold(negative);
                }
                for (std::size_t channel = 0; channel < 4; ++channel) {
                    accumulated[channel] += positive[channel] * weights[distance];
                    accumulated[channel] += negative[channel] * weights[distance];
                }
                denominator += weights[distance] * 2;
            }
            for (std::size_t channel = 0; channel < 4; ++channel) {
                accumulated[channel] = (accumulated[channel] + center[channel] * weights[0]) / denominator;
            }
            result.at(x, y) = softglow::rgba8(accumulated);
        }
    }
    return result;
}

} // namespace fog_contract
