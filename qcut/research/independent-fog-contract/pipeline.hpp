#pragma once

#include "image.hpp"

namespace fog_contract {

struct Parameters {
    float blur_size;
    float original_weight;
    float lut_opacity;
};

struct PipelineRequest {
    const softglow::Image& source;
    const softglow::Image& lut;
    double intensity = 1;
    softglow::StageSink sink;
};

Parameters parameters(double intensity);
softglow::Image render(const PipelineRequest& request);

} // namespace fog_contract
