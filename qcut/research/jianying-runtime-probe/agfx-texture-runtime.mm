#include "agfx-texture-runtime.hpp"

#include <algorithm>
#include <bit>
#include <cstring>
#include <limits>
#include <stdexcept>

namespace agfx_probe {
namespace {

using CreateMipTexture = jianying_probe::DeviceTextureProbe (*)(
    void*, int, int, int, int, const void* const*, int, int, int, int, int, int*, const char*, bool, bool);
using CreateVolumeTexture = jianying_probe::DeviceTextureProbe (*)(
    void*, int, int, int, const void* const*, int, int, int, int, int, int*, const char*, bool, bool);
using SetSamplerFields = void (*)(void*, jianying_probe::DeviceTextureProbe, int, int, int);

} // namespace

TextureRuntime::TextureRuntime(const LibraryIdentity& library) : library_(library) {
  using namespace jianying_probe;
  symbols_.createDevice = resolve<CreateGraphicsDeviceMethod>(library_, "_ZN13AmazingEngine8GPDevice12createDeviceENS_12RendererTypeEj");
  symbols_.init = resolve<ObjectMethod>(library_, "_ZN13AmazingEngine8GPDevice4initEv");
  symbols_.deinit = resolve<ObjectMethod>(library_, "_ZN13AmazingEngine8GPDevice6deinitEv");
  symbols_.getRendererDevice = resolve<GetObjectMethod>(library_, "_ZN13AmazingEngine8GPDevice17getRendererDeviceEv");
  symbols_.destructor = resolve<ObjectMethod>(library_, "_ZN13AmazingEngine8GPDeviceD1Ev");
  symbols_.releaseMemory = resolve<ObjectMethod>(library_, "_ZN13AmazingEngine8GPDevicedlEPv");
  symbols_.createTexture2D = resolve<CreateTexture2DMethod>(library_, "_ZN13AmazingEngine14RendererDevice15createTexture2DEiiPKPKvNS_14AMGPixelFormatENS_13AMGFilterModeES6_NS_11AMGWrapModeES7_PiPKcbb");
  symbols_.destroyTexture = resolve<DestroyTextureMethod>(library_, "_ZN13AmazingEngine14RendererDevice14destroyTextureE13DeviceTexture");
  symbols_.textureGetId = resolve<TextureIdProperty>(library_, "_ZN13DeviceWrapperI11TextureBaseE5getIdEv");
  symbols_.readImage = resolve<ReadImageMethod>(library_, "_ZN13AmazingEngine14RendererDevice9readImageE13DeviceTextureiiPvNS_8FlipModeENS_10RotateModeENS_13AMGFilterModeENS_14AMGPixelFormatE");
  device_ = symbols_.createDevice(6, 0);
  if (!device_) throw std::runtime_error("AGFX device creation failed");
  symbols_.init(device_);
  renderer_ = symbols_.getRendererDevice(device_);
  if (!renderer_) {
    symbols_.deinit(device_);
    symbols_.destructor(device_);
    symbols_.releaseMemory(device_);
    throw std::runtime_error("AGFX renderer unavailable");
  }
}

TextureRuntime::~TextureRuntime() {
  for (auto texture = textures_.rbegin(); texture != textures_.rend(); ++texture) {
    symbols_.destroyTexture(renderer_, *texture);
  }
  if (device_) {
    symbols_.deinit(device_);
    symbols_.destructor(device_);
    symbols_.releaseMemory(device_);
  }
}

NativeTexture TextureRuntime::upload(const TextureUpload& request) {
  if (request.width <= 0 || request.height <= 0 || request.depth <= 0 ||
      request.width > 16384 || request.height > 16384 || request.depth > 16384 ||
      (request.format != 43 && request.format != 50) || request.levels.empty() ||
      request.levels.size() != request.row_strides.size() || request.levels.size() > 15) {
    throw std::invalid_argument("Unsupported diagnostic texture upload");
  }
  const auto max_levels = std::bit_width(static_cast<unsigned>(std::max(request.width, request.height)));
  if (request.levels.size() > static_cast<std::size_t>(max_levels)) {
    throw std::invalid_argument("Too many diagnostic mip levels");
  }
  if (request.depth > 1 && request.levels.size() != 1) {
    throw std::invalid_argument("Volume mip uploads are not part of this probe");
  }
  std::vector<const void*> data;
  std::vector<std::vector<std::uint8_t>> packed;
  int width = request.width;
  int height = request.height;
  for (std::size_t level = 0; level < request.levels.size(); ++level) {
    const auto stride = request.row_strides[level];
    const auto required = static_cast<std::size_t>(stride > 0 ? stride : 0) * height * request.depth;
    if (stride < width * 4 || request.levels[level].size() < required) {
      throw std::invalid_argument("Diagnostic upload is truncated or has invalid stride");
    }
    // The convenience API's int* is compressed-level sizing, not RGBA row stride.
    auto& bytes = packed.emplace_back(static_cast<std::size_t>(width) * height * request.depth * 4);
    for (int row = 0; row < height * request.depth; ++row) {
      std::memcpy(bytes.data() + static_cast<std::size_t>(row) * width * 4,
                  request.levels[level].data() + static_cast<std::size_t>(row) * stride,
                  static_cast<std::size_t>(width) * 4);
    }
    width = std::max(1, width / 2);
    height = std::max(1, height / 2);
  }
  for (const auto& bytes : packed) data.push_back(bytes.data());
  jianying_probe::DeviceTextureProbe handle;
  if (request.depth > 1) {
    const auto create = resolve<CreateVolumeTexture>(library_, "_ZN13AmazingEngine14RendererDevice15createTexture3DEiiiPKPKvNS_14AMGPixelFormatENS_13AMGFilterModeES6_NS_11AMGWrapModeES7_PiPKcbb");
    handle = create(renderer_, request.width, request.height, request.depth, data.data(), request.format,
                    1, 1, 1, 1, nullptr, "QCut original volume", false, false);
  } else if (request.levels.size() > 1) {
    const auto create = resolve<CreateMipTexture>(library_, "_ZN13AmazingEngine14RendererDevice15createTexture2DEiiNS_19AMGFilterMipmapModeEiPKPKvNS_14AMGPixelFormatENS_13AMGFilterModeES7_NS_11AMGWrapModeES8_PiPKcbb");
    // Nonzero creation mip mode generates levels from level zero, ignoring supplied later levels.
    handle = create(renderer_, request.width, request.height, 0, static_cast<int>(request.levels.size()),
                    data.data(), request.format, 1, 1, 1, 1, nullptr, "QCut original mip texture", false, false);
  } else {
    handle = symbols_.createTexture2D(renderer_, request.width, request.height, data.data(), request.format,
                                      1, 1, 1, 1, nullptr, "QCut original packed texture", false, false);
  }
  if (!handle.texture) throw std::runtime_error("AGFX texture creation failed");
  textures_.push_back(handle);
  auto metal = (__bridge id<MTLTexture>)(reinterpret_cast<void*>(symbols_.textureGetId(handle.texture)));
  if (!metal || metal.width != static_cast<NSUInteger>(request.width) ||
      metal.height != static_cast<NSUInteger>(request.height) || metal.depth != static_cast<NSUInteger>(request.depth)) {
    throw std::runtime_error("AGFX texture dimensions differ from request");
  }
  finish();
  return {handle, metal, request.format};
}

id<MTLSamplerState> TextureRuntime::set_sampler(
    const NativeTexture& texture, const agfx_contract::SourceSampler& source) {
  agfx_contract::MetalSampler validated{};
  if (!agfx_contract::convert_sampler(source, validated)) throw std::invalid_argument("Unsafe native sampler enum");
  const auto set_filter = resolve<SetSamplerFields>(library_, "_ZN13AmazingEngine14RendererDevice20setTextureFilterModeE13DeviceTextureNS_13AMGFilterModeES2_NS_19AMGFilterMipmapModeE");
  const auto set_wrap = resolve<SetSamplerFields>(library_, "_ZN13AmazingEngine14RendererDevice18setTextureWrapModeE13DeviceTextureNS_11AMGWrapModeES2_S2_");
  set_filter(renderer_, texture.handle, source.mag, source.min, source.mip);
  set_wrap(renderer_, texture.handle, source.wrap_s, source.wrap_t, source.wrap_r);
  const auto* bytes = static_cast<const std::uint8_t*>(texture.handle.texture);
  const auto vtable = *static_cast<const std::uintptr_t* const*>(texture.handle.texture);
  if (vtable[2] != reinterpret_cast<std::uintptr_t>(library_.base) + 0xa2558) {
    throw std::runtime_error("Unknown native texture getter; refusing sampler layout");
  }
  std::array<std::int32_t, 7> fields{};
  std::memcpy(fields.data(), bytes + 0x88, sizeof(fields));
  const std::array<std::int32_t, 7> expected{{source.mag, source.min, source.mip,
                                            source.wrap_s, source.wrap_t, source.wrap_r, 1}};
  if (fields != expected) throw std::runtime_error("Native sampler fields or anisotropy differ");
  void* sampler = nullptr;
  std::memcpy(&sampler, bytes + 0x18, sizeof(sampler));
  if (!sampler) throw std::runtime_error("AGFX sampler creation failed");
  return (__bridge id<MTLSamplerState>)(sampler);
}

std::vector<std::uint8_t> TextureRuntime::readback(
    const NativeTexture& texture, int width, int height, int output_format, int filter) {
  if (width < 1 || height < 1 || width > 16384 || height > 16384 ||
      (output_format != 43 && output_format != 50) || (filter != 0 && filter != 1) || texture.metal.depth != 1) {
    throw std::invalid_argument("Unsupported diagnostic readback");
  }
  const auto count = static_cast<std::size_t>(width) * height * 4;
  std::vector<std::uint8_t> guarded(count + 64, 0xa5);
  finish();
  symbols_.readImage(renderer_, texture.handle, width, height, guarded.data() + 32, 0, 0, filter, output_format);
  if (!std::all_of(guarded.begin(), guarded.begin() + 32, [](auto value) { return value == 0xa5; }) ||
      !std::all_of(guarded.end() - 32, guarded.end(), [](auto value) { return value == 0xa5; })) {
    throw std::runtime_error("AGFX readback overran output guard");
  }
  return {guarded.begin() + 32, guarded.end() - 32};
}

void TextureRuntime::finish() {
  resolve<jianying_probe::ObjectMethod>(library_, "_ZN13AmazingEngine14RendererDevice6finishEv")(renderer_);
}

} // namespace agfx_probe
