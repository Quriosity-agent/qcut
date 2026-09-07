#include "output_mix.hpp"

#include <cmath>
#include <stdexcept>

namespace softglow {

Image mix_output(const OutputMixRequest& request) {
    const auto& [source, rendered, intensity] = request;
    validate_image(source);
    validate_image(rendered);
    if (source.width != rendered.width || source.height != rendered.height) {
        throw std::invalid_argument("Output mix dimensions must match");
    }
    if (!std::isfinite(intensity) || intensity < 0 || intensity > 1) {
        throw std::invalid_argument("Output mix intensity must be in [0, 1]");
    }
    Image output(source.width, source.height);
    const bool partial = intensity > 0 && intensity < 1;
    for (std::size_t index = 0; index < output.pixels.size(); ++index) {
        Pixel pixel = rgba8(intensity == 1 ? rendered.pixels[index] : source.pixels[index]);
        for (std::size_t channel = 0; partial && channel < 3; ++channel) {
            const double base = quantize_unorm8(source.pixels[index][channel]);
            const double target = quantize_unorm8(rendered.pixels[index][channel]);
            const double delta = (target - base) * intensity;
            pixel[channel] = static_cast<float>(std::round(base + delta)) / 255.0F;
        }
        output.pixels[index] = pixel;
    }
    return output;
}

} // namespace softglow
