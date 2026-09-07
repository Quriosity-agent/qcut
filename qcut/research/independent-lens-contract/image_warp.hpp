#pragma once

#include "lens_contract.hpp"

#include <cstdint>

namespace lens_contract {

constexpr int max_image_dimension = 8192;
constexpr std::size_t max_image_pixels = 1U << 24;

struct RgbaImageView {
  std::span<const std::uint8_t> bytes;
  int width;
  int height;
  std::size_t row_stride;
};

enum class AffineWarpBackend { fsnew, image_transform };

struct AffineWarpRequest {
  std::array<float, 6> source_to_destination;
  int width;
  int height;
  AffineWarpBackend backend = AffineWarpBackend::fsnew;
};

struct AffineWarpResult {
  std::vector<std::uint8_t> rgba;
  std::vector<std::uint8_t> bgr;
  bool operator==(const AffineWarpResult&) const = default;
};

// Both backends round row/column contributions separately; their float order differs.
// This contract requires FE_TONEAREST and copies straight RGBA, including alpha.
bool warp_affine_rgba(const RgbaImageView& source, const AffineWarpRequest& request,
                      AffineWarpResult& output);

}  // namespace lens_contract
