#pragma once

#import <Metal/Metal.h>
#include "../independent-agfx-contract/sampler.hpp"
#include <array>
#include <span>
#include <vector>

namespace agfx_probe {

class TextureKernel {
public:
  explicit TextureKernel(id<MTLDevice> device);
  std::vector<std::array<float, 4>> sample(id<MTLTexture> texture,
      id<MTLSamplerState> sampler, std::span<const std::array<float, 4>> queries);
  id<MTLSamplerState> independent_sampler(const agfx_contract::SourceSampler& source);
private:
  id<MTLDevice> device_;
  id<MTLCommandQueue> queue_;
  id<MTLComputePipelineState> pipeline_2d_;
  id<MTLComputePipelineState> pipeline_3d_;
};

} // namespace agfx_probe
