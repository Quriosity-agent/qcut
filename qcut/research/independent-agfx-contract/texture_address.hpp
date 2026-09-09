#pragma once

#include "texture_sample.hpp"

#include <algorithm>

namespace agfx_contract::detail {

inline std::int64_t address_texel(std::int64_t index, std::uint32_t size, TexelWrap wrap) {
  const auto extent = static_cast<std::int64_t>(size);
  if (wrap == TexelWrap::clamp) return std::clamp(index, std::int64_t{0}, extent - 1);
  if (wrap == TexelWrap::border) return index < 0 || index >= extent ? -1 : index;
  const auto period = wrap == TexelWrap::mirror ? 2 * extent : extent;
  auto reduced = index % period;
  if (reduced < 0) reduced += period;
  return reduced < extent ? reduced : period - 1 - reduced;
}

// The caller has validated strides and addressed every axis into the texture.
inline std::array<std::uint8_t, 4> rgba8_texel(const TextureView& texture,
    std::int64_t x, std::int64_t y, std::int64_t z) {
  const auto offset = static_cast<std::size_t>(z) * texture.slice_stride +
      static_cast<std::size_t>(y) * texture.row_stride + static_cast<std::size_t>(x) * 4;
  const auto* bytes = texture.bytes.data() + offset;
  return {bytes[texture.order == ChannelOrder::rgba ? 0 : 2], bytes[1],
          bytes[texture.order == ChannelOrder::rgba ? 2 : 0], bytes[3]};
}

} // namespace agfx_contract::detail
