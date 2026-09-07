#include "image_warp.hpp"
#include "image_warp_backend_fixtures.hpp"

#include <algorithm>
#include <cfenv>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
using namespace lens_contract;
std::size_t checks = 0;

void require(bool condition, const char* reason) {
  ++checks;
  if (!condition) throw std::runtime_error(reason);
}

void boundary_pixels() {
  std::vector<std::uint8_t> input(65 * 37 * 4), aggregate;
  for (std::size_t index = 0; index < input.size(); ++index) input[index] = fixtures::pixel_byte(index);
  constexpr std::array<std::size_t, 4> first_difference{6004, 3148, 144, 4968};
  constexpr std::array<std::size_t, 4> different_bytes{4, 20, 48, 68};
  for (std::size_t index = 0; index < fixtures::boundary_matrices.size(); ++index) {
    AffineWarpRequest request{fixtures::boundary_matrices[index], 65, 37};
    AffineWarpResult base, transformed;
    require(warp_affine_rgba({input, 65, 37, 260}, request, base), "Base boundary rejected");
    request.backend = AffineWarpBackend::image_transform;
    require(warp_affine_rgba({input, 65, 37, 260}, request, transformed), "ImageTransform boundary rejected");
    std::size_t first = input.size(), differences = 0;
    for (std::size_t byte = 0; byte < input.size(); ++byte) {
      if (base.rgba[byte] == transformed.rgba[byte]) continue;
      if (differences == 0) first = byte;
      ++differences;
    }
    require(first == first_difference[index] && differences == different_bytes[index],
            "Backend distinction changed at the native quantization boundary");
    aggregate.insert(aggregate.end(), transformed.rgba.begin(), transformed.rgba.end());
  }
  require(fixtures::fingerprint(aggregate) == 0x2dc540dc66fd345eULL,
          "ImageTransform differs from complete native RGBA boundary golden");
}

void geometry_and_layout() {
  for (int width : {1, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65}) {
    constexpr int height = 3;
    const auto row_bytes = static_cast<std::size_t>(width) * 4;
    std::vector<std::uint8_t> packed(row_bytes * height), padded((row_bytes + 7) * height, 231);
    for (std::size_t index = 0; index < packed.size(); ++index) {
      packed[index] = static_cast<std::uint8_t>(index * 71);
    }
    for (std::size_t row = 0; row < height; ++row) {
      std::copy_n(packed.data() + row * row_bytes, row_bytes, padded.data() + row * (row_bytes + 7));
    }
    const auto before = padded;
    const AffineWarpRequest request{{1, 0, 1, 0, 1, 0}, width + 2, height,
                                     AffineWarpBackend::image_transform};
    AffineWarpResult output, other;
    require(warp_affine_rgba({padded, width, height, row_bytes + 7}, request, output), "Padded image rejected");
    require(warp_affine_rgba({packed, width, height, row_bytes}, request, other), "Packed image rejected");
    require(output == other && padded == before, "Stride padding leaked or input changed");
    for (int y = 0; y < height; ++y) {
      for (int x = 0; x < width + 2; ++x) {
        const auto destination = static_cast<std::size_t>(y * (width + 2) + x);
        const auto source = static_cast<std::size_t>(y * width + x - 1) * 4;
        const bool inside = x > 0 && x <= width;
        for (std::size_t channel = 0; channel < 4; ++channel) {
          require(output.rgba[destination * 4 + channel] == (inside ? packed[source + channel] : 0),
                  "Integer translation, straight alpha or transparent border differs");
        }
        for (std::size_t channel = 0; channel < 3; ++channel) {
          require(output.bgr[destination * 3 + channel] == (inside ? packed[source + 2 - channel] : 0),
                  "Derived BGR ordering differs");
        }
      }
    }
  }
}

void rejection_and_aliasing() {
  const std::vector<std::uint8_t> input{71, 33, 90, 0, 19, 28, 37, 255};
  for (auto backend : {AffineWarpBackend::fsnew, AffineWarpBackend::image_transform}) {
    const AffineWarpRequest valid{{1, 0, 0, 0, 1, 0}, 2, 1, backend};
    AffineWarpResult output{{7, 8, 9}, {4, 5, 6}};
    const auto sentinel = output;
    auto reject = [&](AffineWarpRequest request, RgbaImageView view) {
      require(!warp_affine_rgba(view, request, output), "Invalid request was accepted");
      require(output == sentinel, "Rejected request changed output");
    };
    const RgbaImageView view{input, 2, 1, 8};
    auto request = valid;
    request.backend = static_cast<AffineWarpBackend>(99);
    reject(request, view);
    request = valid;
    request.width = 0;
    reject(request, view);
    request = valid;
    request.source_to_destination = {1, 2, 0, 2, 4, 0};
    reject(request, view);
    for (float invalid : {std::numeric_limits<float>::infinity(),
                           std::numeric_limits<float>::quiet_NaN()}) {
      for (std::size_t index = 0; index < 6; ++index) {
        request = valid;
        request.source_to_destination[index] = invalid;
        reject(request, view);
      }
    }
    request = valid;
    request.source_to_destination[2] = 3000000;
    reject(request, view);
    reject(valid, {std::span(input).first(7), 2, 1, 8});
    reject(valid, {input, 2, 1, 7});
    const int saved = std::fegetround();
    require(std::fesetround(FE_DOWNWARD) == 0, "Cannot set rounding negative control");
    const bool accepted = warp_affine_rgba(view, valid, output);
    require(std::fesetround(saved) == 0, "Cannot restore rounding mode");
    require(!accepted && output == sentinel, "Unsupported rounding accepted or changed output");
    output.rgba = input;
    require(warp_affine_rgba({output.rgba, 2, 1, 8}, valid, output), "Valid aliased input rejected");
    require(output.rgba == input && output.bgr == std::vector<std::uint8_t>({90, 33, 71, 37, 28, 19}),
            "Aliasing or alpha preservation failed");
  }
}
}  // namespace

int main() {
  try {
    boundary_pixels();
    geometry_and_layout();
    rejection_and_aliasing();
    std::cout << "Lens warp backends: " << checks << " checks passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
