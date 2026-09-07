#include "texture_sample.hpp"
#include "texture_address.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace agfx_contract {
namespace {

std::size_t product(std::size_t a, std::size_t b) {
  if (b != 0 && a > std::numeric_limits<std::size_t>::max() / b) {
    throw std::invalid_argument("Texture byte count overflow");
  }
  return a * b;
}

std::size_t sum(std::size_t a, std::size_t b) {
  if (a > std::numeric_limits<std::size_t>::max() - b) {
    throw std::invalid_argument("Texture byte offset overflow");
  }
  return a + b;
}

TextureView validate(TextureView texture) {
  if (texture.width == 0 || texture.height == 0 || texture.depth == 0) {
    throw std::invalid_argument("Texture dimensions must be positive");
  }
  if (texture.order != ChannelOrder::rgba && texture.order != ChannelOrder::bgra) {
    throw std::invalid_argument("Unknown texture channel order");
  }
  const auto row_bytes = product(texture.width, 4);
  if (texture.row_stride == 0) texture.row_stride = row_bytes;
  if (texture.row_stride < row_bytes) throw std::invalid_argument("Texture row stride is too small");
  const auto slice_bytes = sum(product(texture.height - 1, texture.row_stride), row_bytes);
  if (texture.slice_stride == 0) texture.slice_stride = product(texture.row_stride, texture.height);
  if (texture.slice_stride < slice_bytes) throw std::invalid_argument("Texture slice stride is too small");
  const auto required = sum(product(texture.depth - 1, texture.slice_stride), slice_bytes);
  if (required > texture.bytes.size()) throw std::invalid_argument("Texture input is truncated");
  return texture;
}

void validate_settings(const SampleSettings& settings) {
  if (settings.filter != TexelFilter::nearest && settings.filter != TexelFilter::linear) {
    throw std::invalid_argument("Unknown texel filter");
  }
  for (const auto wrap : {settings.wrap_s, settings.wrap_t, settings.wrap_r}) {
    if (wrap != TexelWrap::repeat && wrap != TexelWrap::clamp &&
        wrap != TexelWrap::border && wrap != TexelWrap::mirror) {
      throw std::invalid_argument("Unknown texel wrap");
    }
  }
  for (const auto channel : settings.border_color) {
    if (!std::isfinite(channel)) throw std::invalid_argument("Border color must be finite");
  }
}

std::array<float, 4> texel(const TextureView& texture, std::int64_t x,
                         std::int64_t y, std::int64_t z,
                         const SampleSettings& settings) {
  x = detail::address_texel(x, texture.width, settings.wrap_s);
  y = detail::address_texel(y, texture.height, settings.wrap_t);
  z = detail::address_texel(z, texture.depth, settings.wrap_r);
  if (x < 0 || y < 0 || z < 0) return settings.border_color;
  const auto bytes = detail::rgba8_texel(texture, x, y, z);
  return {bytes[0] / 255.0F, bytes[1] / 255.0F, bytes[2] / 255.0F, bytes[3] / 255.0F};
}

struct Axis {
  std::int64_t low;
  float fraction;
};

Axis axis(float coordinate, std::uint32_t extent, TexelFilter filter) {
  const double scaled = static_cast<double>(coordinate) * extent -
      (filter == TexelFilter::linear ? 0.5 : 0.0);
  // Bound before converting to an integer; rejected coordinates are QCut policy.
  if (!std::isfinite(scaled) || std::abs(scaled) >= 0x1p62) {
    throw std::invalid_argument("Texture coordinate is non-finite or exceeds the reference domain");
  }
  const auto low = std::floor(scaled);
  return {static_cast<std::int64_t>(low), static_cast<float>(scaled - low)};
}

std::array<float, 4> mix(const std::array<float, 4>& a,
                       const std::array<float, 4>& b, float amount) {
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < result.size(); ++channel) {
    result[channel] = a[channel] + (b[channel] - a[channel]) * amount;
  }
  return result;
}

std::array<float, 4> sample_validated(const TextureView& texture,
                                    const SamplePoint& point,
                                    const SampleSettings& settings) {
  const auto x = axis(point.u, texture.width, settings.filter);
  const auto y = axis(point.v, texture.height, settings.filter);
  const auto z = axis(point.w, texture.depth, settings.filter);
  if (settings.filter == TexelFilter::nearest) return texel(texture, x.low, y.low, z.low, settings);
  const auto plane = [&](std::int64_t slice) {
    return mix(mix(texel(texture, x.low, y.low, slice, settings),
                   texel(texture, x.low + 1, y.low, slice, settings), x.fraction),
               mix(texel(texture, x.low, y.low + 1, slice, settings),
                   texel(texture, x.low + 1, y.low + 1, slice, settings), x.fraction), y.fraction);
  };
  return mix(plane(z.low), plane(z.low + 1), z.fraction);
}

} // namespace

void validate_sample_settings(const SampleSettings& settings) {
  validate_settings(settings);
}

TextureView validate_texture_view(const TextureView& texture) {
  return validate(texture);
}

std::vector<std::uint8_t> tight_rgba8(const TextureView& input) {
  const auto texture = validate(input);
  std::vector<std::uint8_t> output(product(product(product(texture.width, texture.height), texture.depth), 4));
  std::size_t destination = 0;
  for (std::uint32_t z = 0; z < texture.depth; ++z) {
    for (std::uint32_t y = 0; y < texture.height; ++y) {
      for (std::uint32_t x = 0; x < texture.width; ++x) {
        const auto offset = z * texture.slice_stride + y * texture.row_stride + x * std::size_t{4};
        const auto red = texture.order == ChannelOrder::rgba ? 0 : 2;
        const auto blue = texture.order == ChannelOrder::rgba ? 2 : 0;
        for (const auto channel : {red, 1, blue, 3}) {
          output[destination++] = texture.bytes[offset + static_cast<std::size_t>(channel)];
        }
      }
    }
  }
  return output;
}

std::array<float, 4> sample_texture(const TextureView& texture,
                                  const SamplePoint& point,
                                  const SampleSettings& settings) {
  validate_settings(settings);
  return sample_validated(validate(texture), point, settings);
}

std::vector<std::array<float, 4>> sample_texture_points(
    const TextureView& input, std::span<const SamplePoint> points,
    const SampleSettings& settings) {
  const auto texture = validate(input);
  validate_settings(settings);
  std::vector<std::array<float, 4>> output;
  output.reserve(points.size());
  for (const auto& point : points) output.push_back(sample_validated(texture, point, settings));
  return output;
}

} // namespace agfx_contract
