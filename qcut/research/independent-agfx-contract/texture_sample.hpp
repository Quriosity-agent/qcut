#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace agfx_contract {

enum class ChannelOrder { rgba, bgra };
enum class TexelFilter { nearest, linear };
enum class TexelWrap { repeat, clamp, border, mirror };

struct TextureView {
  std::span<const std::uint8_t> bytes;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t depth = 1;
  std::size_t row_stride = 0;
  std::size_t slice_stride = 0;
  ChannelOrder order = ChannelOrder::rgba;
};

struct SamplePoint {
  float u;
  float v;
  float w = 0.5F;
};

struct SampleSettings {
  TexelFilter filter = TexelFilter::linear;
  TexelWrap wrap_s = TexelWrap::clamp;
  TexelWrap wrap_t = TexelWrap::clamp;
  TexelWrap wrap_r = TexelWrap::clamp;
  std::array<float, 4> border_color{};
};

TextureView validate_texture_view(const TextureView& texture);

std::vector<std::uint8_t> tight_rgba8(const TextureView& texture);
std::array<float, 4> sample_texture(const TextureView& texture,
                                  const SamplePoint& point,
                                  const SampleSettings& settings);
std::vector<std::array<float, 4>> sample_texture_points(
    const TextureView& texture, std::span<const SamplePoint> points,
    const SampleSettings& settings);

} // namespace agfx_contract
