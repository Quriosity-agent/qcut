#include "image_warp.hpp"

#include <algorithm>
#include <bit>
#include <cfenv>
#include <cmath>
#include <limits>
#include <utility>

namespace lens_contract {
namespace {

bool valid_size(int width, int height) {
  return width > 0 && height > 0 && width <= max_image_dimension &&
         height <= max_image_dimension &&
         static_cast<std::size_t>(width) * static_cast<std::size_t>(height) <=
             max_image_pixels;
}

bool valid_source(const RgbaImageView& source) {
  if (!valid_size(source.width, source.height)) return false;
  const auto row_bytes = static_cast<std::size_t>(source.width) * 4;
  if (source.row_stride < row_bytes || source.bytes.size() < row_bytes) return false;
  const auto remaining_rows = static_cast<std::size_t>(source.height - 1);
  return remaining_rows <= (source.bytes.size() - row_bytes) / source.row_stride;
}

bool inverse_affine(const std::array<float, 6>& forward, AffineWarpBackend backend,
                    std::array<float, 6>& inverse) {
  for (float value : forward) if (!std::isfinite(value)) return false;
  const float cross = forward[1] * forward[3];
  const float determinant = backend == AffineWarpBackend::image_transform
      ? std::fma(forward[0], forward[4], -cross)
      : forward[0] * forward[4] - cross;
  if (!std::isfinite(determinant) || determinant == 0) return false;
  const float reciprocal = static_cast<float>(1.0 / static_cast<double>(determinant));
  inverse[0] = forward[4] * reciprocal;
  inverse[1] = forward[1] * -reciprocal;
  inverse[3] = forward[3] * -reciprocal;
  inverse[4] = forward[0] * reciprocal;
  inverse[2] = -inverse[0] * forward[2] - inverse[1] * forward[5];
  inverse[5] = -inverse[3] * forward[2] - inverse[4] * forward[5];
  for (float value : inverse) if (!std::isfinite(value)) return false;
  return true;
}

bool scaled_coordinate_term(float scaled, std::int16_t& output) {
  if (!std::isfinite(scaled)) return false;
  const double rounded = std::nearbyint(static_cast<double>(scaled));
  if (rounded < std::numeric_limits<std::int32_t>::min() ||
      rounded > static_cast<double>(std::numeric_limits<std::int32_t>::max()) - 512) {
    return false;
  }
  const auto biased = static_cast<std::int64_t>(rounded) + 512;
  const auto integral = biased >= 0 ? biased / 1024 : -((-biased + 1023) / 1024);
  // Native STRH narrows before signed LDRSH; preserve the resulting 16-bit wrap.
  output = std::bit_cast<std::int16_t>(static_cast<std::uint16_t>(integral));
  return true;
}

bool coordinate_term(float value, std::int16_t& output) {
  return scaled_coordinate_term(value * 1024.0F, output);
}

struct AxisTerm {
  std::int16_t x;
  std::int16_t y;
};

bool coordinate_axes(const std::array<float, 6>& inverse, const AffineWarpRequest& request,
                     std::vector<AxisTerm>& columns, std::vector<AxisTerm>& rows) {
  const int width = request.width;
  const int height = request.height;
  columns.resize(static_cast<std::size_t>(width));
  rows.resize(static_cast<std::size_t>(height));
  for (int x = 0; x < width; ++x) {
    auto& term = columns[static_cast<std::size_t>(x)];
    float column_x = inverse[0] * static_cast<float>(x) + inverse[2];
    float column_y = inverse[3] * static_cast<float>(x) + inverse[5];
    if (request.backend == AffineWarpBackend::image_transform) {
      const float shifted_x = static_cast<float>(x) - request.source_to_destination[2];
      const float translation_y = request.source_to_destination[5];
      // These explicit FMAs preserve the ImageTransform path at quantization boundaries.
      column_x = std::fma(inverse[0], shifted_x, -(inverse[1] * translation_y));
      column_y = std::fma(inverse[3], shifted_x, -(inverse[4] * translation_y));
    }
    if (!coordinate_term(column_x, term.x) || !coordinate_term(column_y, term.y)) {
      return false;
    }
  }
  for (int y = 0; y < height; ++y) {
    auto& term = rows[static_cast<std::size_t>(y)];
    if (request.backend == AffineWarpBackend::image_transform) {
      const float scaled_y = static_cast<float>(y) * 1024.0F;
      if (!scaled_coordinate_term(scaled_y * inverse[1], term.x) ||
          !scaled_coordinate_term(scaled_y * inverse[4], term.y)) return false;
      continue;
    }
    if (!coordinate_term(inverse[1] * static_cast<float>(y), term.x) ||
        !coordinate_term(inverse[4] * static_cast<float>(y), term.y)) return false;
  }
  return true;
}

}  // namespace

bool warp_affine_rgba(const RgbaImageView& source, const AffineWarpRequest& request,
                      AffineWarpResult& output) {
  if (std::fegetround() != FE_TONEAREST || !valid_source(source) ||
      !valid_size(request.width, request.height)) return false;
  if (request.backend != AffineWarpBackend::fsnew &&
      request.backend != AffineWarpBackend::image_transform) return false;
  std::array<float, 6> inverse{};
  if (!inverse_affine(request.source_to_destination, request.backend, inverse)) return false;
  std::vector<AxisTerm> columns, rows;
  if (!coordinate_axes(inverse, request, columns, rows)) return false;
  const auto count = static_cast<std::size_t>(request.width) *
                     static_cast<std::size_t>(request.height);
  AffineWarpResult result{std::vector<std::uint8_t>(count * 4),
                          std::vector<std::uint8_t>(count * 3)};
  for (int y = 0; y < request.height; ++y) {
    const auto row = rows[static_cast<std::size_t>(y)];
    for (int x = 0; x < request.width; ++x) {
      const auto column = columns[static_cast<std::size_t>(x)];
      const int source_x = static_cast<int>(column.x) + row.x;
      const int source_y = static_cast<int>(column.y) + row.y;
      if (source_x < 0 || source_x >= source.width ||
          source_y < 0 || source_y >= source.height) continue;
      const auto offset = static_cast<std::size_t>(source_y) * source.row_stride +
                          static_cast<std::size_t>(source_x) * 4;
      const auto destination = static_cast<std::size_t>(y) *
                                   static_cast<std::size_t>(request.width) +
                               static_cast<std::size_t>(x);
      std::copy_n(source.bytes.data() + offset, 4, result.rgba.data() + destination * 4);
      result.bgr[destination * 3] = source.bytes[offset + 2];
      result.bgr[destination * 3 + 1] = source.bytes[offset + 1];
      result.bgr[destination * 3 + 2] = source.bytes[offset];
    }
  }
  output = std::move(result);
  return true;
}

}  // namespace lens_contract
