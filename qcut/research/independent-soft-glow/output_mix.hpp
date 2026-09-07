#pragma once

#include "image.hpp"

namespace softglow {

struct OutputMixRequest {
    const Image& source;
    const Image& rendered;
    double intensity;
};

Image mix_output(const OutputMixRequest& request);

} // namespace softglow
