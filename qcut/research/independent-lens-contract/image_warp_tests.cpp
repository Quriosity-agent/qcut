#include "image_warp.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
using namespace lens_contract;
std::size_t assertions = 0;

void require(bool condition, const std::string& message) {
  ++assertions;
  if (!condition) throw std::runtime_error(message);
}

struct Fixture {
  int width;
  int height;
  std::size_t stride;
  std::vector<std::uint8_t> bytes;
  RgbaImageView view() const { return {bytes, width, height, stride}; }
};

Fixture fixture(int width, int height, std::size_t padding = 0) {
  const auto stride = static_cast<std::size_t>(width) * 4 + padding;
  Fixture result{width, height, stride,
                  std::vector<std::uint8_t>(stride * static_cast<std::size_t>(height), 231)};
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const auto index = static_cast<std::size_t>(y) * stride + static_cast<std::size_t>(x) * 4;
      result.bytes[index] = static_cast<std::uint8_t>(1 + x + y * width);
      result.bytes[index + 1] = static_cast<std::uint8_t>(10 + x * 7);
      result.bytes[index + 2] = static_cast<std::uint8_t>(30 + y * 11);
      result.bytes[index + 3] = static_cast<std::uint8_t>((x + y) * 31);
    }
  }
  return result;
}

AffineWarpRequest identity(int width, int height) {
  return {{1, 0, 0, 0, 1, 0}, width, height};
}

void pixel(const AffineWarpResult& output, int width, int x, int y,
           const Fixture& input, int source_x, int source_y) {
  const auto destination = static_cast<std::size_t>(y * width + x);
  const auto offset = static_cast<std::size_t>(source_y) * input.stride +
                      static_cast<std::size_t>(source_x) * 4;
  for (std::size_t channel = 0; channel < 4; ++channel) {
    require(output.rgba[destination * 4 + channel] == input.bytes[offset + channel],
            "RGBA source coordinate or alpha changed");
  }
  for (std::size_t channel = 0; channel < 3; ++channel) {
    require(output.bgr[destination * 3 + channel] == input.bytes[offset + 2 - channel],
            "BGR channel order changed");
  }
}

void geometry() {
  const auto source = fixture(7, 5, 9);
  const auto before = source.bytes;
  AffineWarpResult output;
  auto request = identity(7, 5);
  require(warp_affine_rgba(source.view(), request, output), "Identity rejected");
  require(output.rgba.size() == 140 && output.bgr.size() == 105, "Output is not packed");
  for (int y = 0; y < 5; ++y) for (int x = 0; x < 7; ++x) pixel(output, 7, x, y, source, x, y);
  require(source.bytes == before, "Source or padding was modified");

  request.source_to_destination[2] = 1;
  request.source_to_destination[5] = 2;
  require(warp_affine_rgba(source.view(), request, output), "Translation rejected");
  pixel(output, 7, 1, 2, source, 0, 0);
  pixel(output, 7, 6, 4, source, 5, 2);
  require(std::all_of(output.rgba.begin(), output.rgba.begin() + 56,
                      [](auto value) { return value == 0; }), "Outside rows are not transparent black");
  require(output.rgba[2 * 7 * 4] == 0 && output.rgba[2 * 7 * 4 + 3] == 0,
          "Outside column or alpha was not zeroed");

  request.source_to_destination = {-1, 0, 6, 0, 1, 0};
  require(warp_affine_rgba(source.view(), request, output), "Horizontal reflection rejected");
  for (int y = 0; y < 5; ++y) for (int x = 0; x < 7; ++x) pixel(output, 7, x, y, source, 6 - x, y);

  request = {{0, -1, 4, 1, 0, 0}, 5, 7};
  require(warp_affine_rgba(source.view(), request, output), "Quarter turn rejected");
  for (int y = 0; y < 7; ++y) for (int x = 0; x < 5; ++x) pixel(output, 5, x, y, source, y, 4 - x);

  request = {{4, -1, 0, 0, 1, 0}, 4, 4};
  require(warp_affine_rgba(source.view(), request, output), "Split-round shear rejected");
  pixel(output, 4, 2, 2, source, 2, 2);
  pixel(output, 4, 1, 1, source, 0, 1);
}

void rounding() {
  const auto source = fixture(3, 1);
  AffineWarpResult output;
  auto request = identity(1, 1);
  constexpr float positive_tie = 511.5F / 1024;
  request.source_to_destination[2] = -positive_tie;
  require(warp_affine_rgba(source.view(), request, output), "Positive quantization tie rejected");
  pixel(output, 1, 0, 0, source, 1, 0);
  request.source_to_destination[2] = -std::nextafter(positive_tie, 0.0F);
  require(warp_affine_rgba(source.view(), request, output), "Below positive tie rejected");
  pixel(output, 1, 0, 0, source, 0, 0);
  constexpr float negative_tie = -512.5F / 1024;
  request.source_to_destination[2] = -negative_tie;
  require(warp_affine_rgba(source.view(), request, output), "Negative quantization tie rejected");
  pixel(output, 1, 0, 0, source, 0, 0);
  request.source_to_destination[2] = -std::nextafter(negative_tie, -1.0F);
  require(warp_affine_rgba(source.view(), request, output), "Below negative tie rejected");
  require(output.rgba == std::vector<std::uint8_t>(4) && output.bgr == std::vector<std::uint8_t>(3),
          "Negative out-of-bounds coordinate was clamped");
  request.source_to_destination[2] = -65536;
  require(warp_affine_rgba(source.view(), request, output), "Signed-short wrap fixture rejected");
  pixel(output, 1, 0, 0, source, 0, 0);
  request.source_to_destination[2] = -32768;
  require(warp_affine_rgba(source.view(), request, output), "Signed-short negative fixture rejected");
  require(output.rgba == std::vector<std::uint8_t>(4), "Signed-short narrowing was saturated");
}

void rejection_and_alias() {
  auto source = fixture(3, 2);
  const AffineWarpResult sentinel{{8, 9, 10}, {4, 5}};
  auto output = sentinel;
  const auto rejected = [&](const RgbaImageView& view, const AffineWarpRequest& request) {
    require(!warp_affine_rgba(view, request, output) && output == sentinel,
            "Invalid request accepted or changed output");
  };
  auto request = identity(3, 2);
  for (int invalid : {-1, 0, max_image_dimension + 1, std::numeric_limits<int>::max()}) {
    rejected(source.view(), {request.source_to_destination, invalid, 2});
    rejected(source.view(), {request.source_to_destination, 3, invalid});
    auto view = source.view(); view.width = invalid; rejected(view, request);
    view = source.view(); view.height = invalid; rejected(view, request);
  }
  rejected(source.view(), {request.source_to_destination, max_image_dimension, max_image_dimension});
  auto view = source.view(); view.row_stride = 11; rejected(view, request);
  view = source.view(); view.row_stride = std::numeric_limits<std::size_t>::max(); rejected(view, request);
  view = source.view(); view.bytes = view.bytes.first(view.bytes.size() - 1); rejected(view, request);
  for (float invalid : {std::numeric_limits<float>::infinity(),
                         -std::numeric_limits<float>::infinity(),
                         std::numeric_limits<float>::quiet_NaN()}) {
    for (std::size_t index = 0; index < 6; ++index) {
      auto damaged = request; damaged.source_to_destination[index] = invalid;
      rejected(source.view(), damaged);
    }
  }
  rejected(source.view(), {{0, 0, 0, 0, 0, 0}, 3, 2});
  rejected(source.view(), {{1, 2, 0, 2, 4, 0}, 3, 2});
  rejected(source.view(), {{1, 0, 3000000, 0, 1, 0}, 3, 2});
  rejected(source.view(), {{std::numeric_limits<float>::denorm_min(), 0, 0, 0, 1, 0}, 3, 2});
  const int original_rounding = std::fegetround();
  require(std::fesetround(FE_DOWNWARD) == 0, "Cannot set rounding mode for rejection test");
  rejected(source.view(), request);
  require(std::fesetround(original_rounding) == 0, "Cannot restore rounding mode");

  require(warp_affine_rgba(source.view(), request, output), "Valid image rejected after errors");
  const auto expected = output;
  const RgbaImageView aliased{output.rgba, 3, 2, 12};
  require(warp_affine_rgba(aliased, request, output) && output == expected,
          "Output alias changed source before completion");
  request.source_to_destination[2] = 1;
  require(warp_affine_rgba(source.view(), request, output), "Second request rejected");
  require(warp_affine_rgba(source.view(), identity(3, 2), output) && output == expected,
          "Output depends on preceding request");
}
}  // namespace

int main() {
  try {
    geometry(); rounding(); rejection_and_alias();
    std::cout << "Image warp: " << assertions << " assertions passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
