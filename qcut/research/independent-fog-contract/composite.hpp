#pragma once

#include "image.hpp"

namespace fog_contract {

struct CompositeRequest {
    const softglow::Image& source;
    const softglow::Image& blurred;
    float original_weight;
};

softglow::Image composite(const CompositeRequest& request);

} // namespace fog_contract
