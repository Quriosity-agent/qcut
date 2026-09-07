#pragma once

#import <Metal/Metal.h>
#include "agfx-library.hpp"
#include "graphics-runtime.h"
#include "../independent-agfx-contract/sampler.hpp"

#include <vector>

namespace agfx_probe {

struct TextureUpload {
  int width;
  int height;
  int depth;
  int format;
  std::vector<std::vector<std::uint8_t>> levels;
  std::vector<int> row_strides;
};

struct NativeTexture {
  jianying_probe::DeviceTextureProbe handle;
  id<MTLTexture> metal;
  int format;
};

class TextureRuntime {
public:
  explicit TextureRuntime(const LibraryIdentity& library);
  ~TextureRuntime();
  TextureRuntime(const TextureRuntime&) = delete;
  TextureRuntime& operator=(const TextureRuntime&) = delete;

  NativeTexture upload(const TextureUpload& request);
  id<MTLSamplerState> set_sampler(const NativeTexture& texture,
                                const agfx_contract::SourceSampler& source);
  std::vector<std::uint8_t> readback(const NativeTexture& texture, int width, int height,
                                   int output_format, int filter = 1);
  void finish();

private:
  LibraryIdentity library_;
  jianying_probe::GraphicsSymbols symbols_{};
  void* device_ = nullptr;
  void* renderer_ = nullptr;
  std::vector<jianying_probe::DeviceTextureProbe> textures_;
};

} // namespace agfx_probe
