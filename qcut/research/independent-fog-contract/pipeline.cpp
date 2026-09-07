#include "pipeline.hpp"

#include "blur.hpp"
#include "composite.hpp"
#include "lut.hpp"

#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The Fog contract requires IEEE floating-point semantics"
#endif

namespace fog_contract {

Parameters parameters(double intensity) {
    if (!std::isfinite(intensity) || intensity < 0 || intensity > 1) {
        throw std::invalid_argument("Fog intensity must be finite and in [0, 1]");
    }
    // Package event numbers are binary64; material uniforms narrow after each expression.
    return {static_cast<float>((intensity * 0.90) * 4),
            static_cast<float>(1 - intensity * 0.50), static_cast<float>(intensity)};
}

softglow::Image render(const PipelineRequest& request) {
    const auto params = parameters(request.intensity);
    softglow::validate_image(request.source);
    softglow::validate_image(request.lut);
    if (request.lut.width != 512 || request.lut.height != 512) {
        throw std::invalid_argument("Fog requires a 512 by 512 LUT atlas");
    }
    for (const auto& pixel : request.source.pixels) {
        if (pixel[3] != 1) throw std::invalid_argument("Fog pipeline currently requires opaque input");
    }
    const auto source = softglow::from_rgba8(softglow::to_rgba8(request.source), request.source.width, request.source.height);
    const auto atlas = softglow::from_rgba8(softglow::to_rgba8(request.lut), 512, 512);
    const auto record = [&](std::string_view name, const softglow::Image& image) {
        if (request.sink) request.sink(name, image);
    };
    record("00-input", source);
    auto working = weighted_blur({source, params.blur_size, BlurAxis::horizontal});
    record("01-blur-x", working);
    working = weighted_blur({working, params.blur_size, BlurAxis::vertical});
    record("02-blur-y", working);
    working = composite({source, working, params.original_weight});
    record("03-fog", working);
    working = softglow::apply_lut(working, atlas, params.lut_opacity);
    record("04-lut", working);
    return working;
}

} // namespace fog_contract
