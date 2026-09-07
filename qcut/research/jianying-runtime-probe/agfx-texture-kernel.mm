#include "agfx-texture-kernel.hpp"

#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>

namespace agfx_probe {
namespace {

constexpr char kShader[] = R"(
#include <metal_stdlib>
using namespace metal;
kernel void sample2d(texture2d<float, access::sample> input [[texture(0)]],
                     sampler state [[sampler(0)]],
                     device const float4* queries [[buffer(0)]],
                     device float4* output [[buffer(1)]],
                     constant uint& count [[buffer(2)]],
                     uint index [[thread_position_in_grid]]) {
  if (index < count) output[index] = input.sample(state, queries[index].xy, level(queries[index].w));
}
kernel void sample3d(texture3d<float, access::sample> input [[texture(0)]],
                     sampler state [[sampler(0)]],
                     device const float4* queries [[buffer(0)]],
                     device float4* output [[buffer(1)]],
                     constant uint& count [[buffer(2)]],
                     uint index [[thread_position_in_grid]]) {
  if (index < count) output[index] = input.sample(state, queries[index].xyz, level(queries[index].w));
}
)";

std::runtime_error metal_error(const char* context, NSError* error) {
  return std::runtime_error(std::string(context) + ": " +
      (error ? error.localizedDescription.UTF8String : "no Metal object returned"));
}

} // namespace

TextureKernel::TextureKernel(id<MTLDevice> device) : device_(device) {
  auto options = [[MTLCompileOptions alloc] init];
  options.fastMathEnabled = NO;
  NSError* error = nil;
  id<MTLLibrary> library = [device_ newLibraryWithSource:@(kShader) options:options error:&error];
  if (!library) throw metal_error("Compile original sampling shader", error);
  pipeline_2d_ = [device_ newComputePipelineStateWithFunction:[library newFunctionWithName:@"sample2d"] error:&error];
  if (!pipeline_2d_) throw metal_error("Create 2D pipeline", error);
  pipeline_3d_ = [device_ newComputePipelineStateWithFunction:[library newFunctionWithName:@"sample3d"] error:&error];
  if (!pipeline_3d_) throw metal_error("Create 3D pipeline", error);
  queue_ = [device_ newCommandQueue];
  if (!queue_) throw metal_error("Create compute queue", nil);
}

std::vector<std::array<float, 4>> TextureKernel::sample(
    id<MTLTexture> texture, id<MTLSamplerState> sampler,
    std::span<const std::array<float, 4>> queries) {
  if (queries.empty() || queries.size() > std::numeric_limits<std::uint32_t>::max() ||
      !texture || !sampler || texture.device.registryID != device_.registryID) {
    throw std::invalid_argument("Invalid original shader sample request");
  }
  if (texture.textureType != MTLTextureType2D && texture.textureType != MTLTextureType3D) {
    throw std::invalid_argument("Only 2D and 3D fixture textures are supported");
  }
  static_assert(sizeof(std::array<float, 4>) == 16);
  const auto byte_count = queries.size_bytes();
  auto input = [device_ newBufferWithBytes:queries.data() length:byte_count options:MTLResourceStorageModeShared];
  auto output = [device_ newBufferWithLength:byte_count options:MTLResourceStorageModeShared];
  if (!input || !output) throw metal_error("Allocate sample buffers", nil);
  const auto count = static_cast<std::uint32_t>(queries.size());
  auto command = [queue_ commandBuffer];
  auto encoder = [command computeCommandEncoder];
  if (!command || !encoder) throw metal_error("Create compute command", nil);
  auto pipeline = texture.textureType == MTLTextureType3D ? pipeline_3d_ : pipeline_2d_;
  [encoder setComputePipelineState:pipeline];
  [encoder setTexture:texture atIndex:0];
  [encoder setSamplerState:sampler atIndex:0];
  [encoder setBuffer:input offset:0 atIndex:0];
  [encoder setBuffer:output offset:0 atIndex:1];
  [encoder setBytes:&count length:sizeof(count) atIndex:2];
  [encoder dispatchThreads:MTLSizeMake(count, 1, 1)
      threadsPerThreadgroup:MTLSizeMake(pipeline.threadExecutionWidth, 1, 1)];
  [encoder endEncoding];
  [command commit];
  [command waitUntilCompleted];
  if (command.status != MTLCommandBufferStatusCompleted || command.error) {
    throw metal_error("Complete sample dispatch before readback", command.error);
  }
  std::vector<std::array<float, 4>> result(queries.size());
  std::memcpy(result.data(), output.contents, byte_count);
  return result;
}

id<MTLSamplerState> TextureKernel::independent_sampler(const agfx_contract::SourceSampler& source) {
  agfx_contract::MetalSampler fields{};
  if (!agfx_contract::convert_sampler(source, fields)) throw std::invalid_argument("Invalid independent sampler");
  auto descriptor = [[MTLSamplerDescriptor alloc] init];
  descriptor.magFilter = static_cast<MTLSamplerMinMagFilter>(fields.mag);
  descriptor.minFilter = static_cast<MTLSamplerMinMagFilter>(fields.min);
  descriptor.mipFilter = static_cast<MTLSamplerMipFilter>(fields.mip);
  descriptor.sAddressMode = static_cast<MTLSamplerAddressMode>(fields.wrap_s);
  descriptor.tAddressMode = static_cast<MTLSamplerAddressMode>(fields.wrap_t);
  descriptor.rAddressMode = static_cast<MTLSamplerAddressMode>(fields.wrap_r);
  descriptor.maxAnisotropy = 1;
  descriptor.borderColor = MTLSamplerBorderColorTransparentBlack;
  auto sampler = [device_ newSamplerStateWithDescriptor:descriptor];
  if (!sampler) throw metal_error("Create independent sampler", nil);
  return sampler;
}

} // namespace agfx_probe
