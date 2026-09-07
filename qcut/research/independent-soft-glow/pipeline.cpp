#include "pipeline.hpp"

#include "gaussian.hpp"
#include "glow.hpp"
#include "layer.hpp"
#include "lut.hpp"
#include "output_mix.hpp"

#include <cmath>
#include <stdexcept>

namespace softglow {

IntensityMode parse_intensity_mode(std::string_view value) {
    if (value == "output-mix") return IntensityMode::output_mix;
    if (value == "ui-snapshot") return IntensityMode::ui_snapshot;
    throw std::invalid_argument("intensity mode must be output-mix or ui-snapshot");
}

std::string_view intensity_mode_name(IntensityMode mode) {
    switch (mode) {
        case IntensityMode::output_mix: return "output-mix";
        case IntensityMode::ui_snapshot: return "ui-snapshot";
    }
    throw std::invalid_argument("unsupported intensity mode");
}

PipelineParameters pipeline_parameters(const PipelineParameterRequest& request) {
    const float intensity = request.intensity;
    intensity_mode_name(request.mode);
    const bool ui_snapshot = request.mode == IntensityMode::ui_snapshot;
    if (!std::isfinite(intensity) || intensity < 0 || intensity > 1) {
        throw std::invalid_argument("pipeline intensity must be in [0, 1]");
    }
    LayerParams soft_light;
    soft_light.mode = LayerBlend::soft_light;
    soft_light.type = LayerType::precomp;
    soft_light.opacity = 0.7F;
    soft_light.scale_x = 1.03F;
    soft_light.scale_y = 1.03F;
    GlowParameters glow_parameters;
    glow_parameters.threshold = 0.84F;
    glow_parameters.brightness = 2.4F;
    glow_parameters.glow_width = 0.13F;
    glow_parameters.width_x = 0.41F;
    glow_parameters.width_y = 0.65F;
    glow_parameters.width_red = 1;
    glow_parameters.width_green = 1;
    glow_parameters.width_blue = 1;
    glow_parameters.dither = 1;
    // Above 0.8 the observed fresh export keeps the instantiated scene values.
    if (ui_snapshot && intensity <= 0.8F) {
        glow_parameters.threshold = 1 - 0.175F * intensity;
        glow_parameters.brightness = 3 * intensity;
    }
    LayerParams normal;
    normal.opacity = 0.64F;
    return {soft_light, glow_parameters, ui_snapshot ? 0.8F * intensity : 0.8F, normal};
}

Image cinematic_soft_glow(const PipelineRequest& request) {
    const auto& [source, lut, intensity, sink, intensity_mode] = request;
    if (!std::isfinite(intensity) || intensity < 0 || intensity > 1) {
        throw std::invalid_argument("pipeline intensity must be in [0, 1]");
    }
    const auto parameters = pipeline_parameters({static_cast<float>(intensity), intensity_mode});
    const bool ui_snapshot = intensity_mode == IntensityMode::ui_snapshot;
    validate_image(source);
    validate_image(lut);
    if (lut.width != 512 || lut.height != 512) {
        throw std::invalid_argument("pipeline LUT must be 512 by 512");
    }
    for (const auto& pixel : source.pixels) {
        if (pixel[3] != 1) throw std::invalid_argument("pipeline currently requires opaque source pixels");
    }
    const auto record = [&](std::string_view name, const Image& stage) {
        if (sink) sink(name, stage);
    };
    record("00-input", source);
    if (!ui_snapshot && intensity == 0) {
        record("06-output", source);
        return source;
    }
    const auto blurred = gaussian_blur({source, GaussianParams{}, sink});
    record("01-gaussian", blurred);
    const auto base = composite_layer({source, blurred, parameters.soft_light});
    record("02-soft-light", base);
    const auto glowing = glow(base, parameters.glow, sink);
    record("03-glow", glowing);
    const auto graded = apply_lut(glowing, lut, parameters.lut_opacity);
    record("04-lut", graded);
    const auto composed = composite_layer({base, graded, parameters.normal});
    record("05-normal", composed);
    if (ui_snapshot) {
        record("06-output", composed);
        return composed;
    }
    const Image output = mix_output({source, composed, intensity});
    record("06-output", output);
    return output;
}

} // namespace softglow
