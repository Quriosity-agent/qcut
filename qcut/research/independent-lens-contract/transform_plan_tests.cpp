#include "transform_plan_fixtures.hpp"

#include <algorithm>
#include <cfenv>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace lens_contract;
std::size_t checks = 0;
void require(bool condition, const char* reason) {
  ++checks;
  if (!condition) throw std::runtime_error(reason);
}

void native_golden() {
  std::uint64_t fingerprint = 14695981039346656037ULL;
  std::size_t rejected = 0;
  for (const auto& request : plan_fixtures::anchors()) {
    TransformPlan plan;
    const bool accepted = plan_anchor_resize(request, plan);
    plan_fixtures::hash_word(fingerprint, accepted ? 1U : 0U);
    if (!accepted) {
      ++rejected;
      continue;
    }
    plan_fixtures::hash_plan(fingerprint, plan);
    TransformPlan repeat;
    require(plan_anchor_resize(request, repeat) && repeat == plan, "Repeated plan differs");
  }
  require(rejected == 4, "Pivot threshold classification changed");
  require(fingerprint == 0xd5ea9f600f6bffffULL,
          "Full forward/inverse matrix corpus differs from native bit-pattern golden");
}

void coordinates() {
  TransformPlan plan;
  require(plan_anchor_resize({{2, 4, 4, 8}, {0, 0, 8, 16}}, plan), "Simple resize rejected");
  require(plan.source_to_destination == std::array<float, 6>{4, 0, -8, 0, 4, -16},
          "Forward matrix direction or row order differs");
  require(plan.destination_to_source == std::array<float, 6>{0.25F, 0, 2, 0, 0.25F, 4},
          "Inverse matrix direction differs");
  require(plan_anchor_resize({{4, 5, -4, -5}, {0, 0, 8, 10}}, plan), "Reflection rejected");
  require(plan.source_to_destination == std::array<float, 6>{-1, 0, 4, 0, -1, 5},
          "Reflected anchor direction changed");
  require(plan_crop_resize({2, 4, 3, 5, 9, 17}, plan), "Inclusive crop rejected");
  require(plan.source_to_destination == std::array<float, 6>{4, 0, -8, 0, 4, -16},
          "Crop used width instead of width minus one");
  constexpr float threshold = 0x1.4p-20F;
  for (float value : {threshold, std::nextafter(threshold, 1.0F)}) {
    require(plan_anchor_resize({{0, 0, value, 2}, {0, 0, 1, 1}}, plan), "Valid pivot threshold rejected");
  }
}

void pixels() {
  constexpr int width = 7, height = 5;
  constexpr std::size_t stride = width * 4 + 7;
  std::vector<std::uint8_t> source(stride * height, 239);
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      for (std::size_t channel = 0; channel < 4; ++channel) {
        source[static_cast<std::size_t>(y) * stride + static_cast<std::size_t>(x) * 4 + channel] =
            static_cast<std::uint8_t>(y * 41 + x * 7 + static_cast<int>(channel));
      }
    }
  }
  const auto before = source;
  const RgbaImageView view{source, width, height, stride};
  for (const auto& origin : {std::array{1.0F, 1.0F}, std::array{-1.0F, -1.0F},
                             std::array{0.5F, 0.5F}}) {
    AffineWarpResult result;
    require(warp_crop_rgba(view, {origin[0], origin[1], 3, 3, 3, 3}, result), "Simple pixel crop rejected");
    require(result.rgba.size() == 36 && result.bgr.size() == 27, "Crop output dimensions differ");
    const int start_x = static_cast<int>(std::floor(origin[0] + 0.5F));
    const int start_y = static_cast<int>(std::floor(origin[1] + 0.5F));
    for (int y = 0; y < 3; ++y) {
      for (int x = 0; x < 3; ++x) {
        const int sx = start_x + x, sy = start_y + y;
        const bool inside = sx >= 0 && sx < width && sy >= 0 && sy < height;
        const auto output_index = static_cast<std::size_t>(y * 3 + x);
        const auto source_index = static_cast<std::size_t>(sy) * stride + static_cast<std::size_t>(sx) * 4;
        for (std::size_t channel = 0; channel < 4; ++channel) {
          require(result.rgba[output_index * 4 + channel] == (inside ? source[source_index + channel] : 0),
                  "Crop selected wrong pixel, border or alpha");
        }
        for (std::size_t channel = 0; channel < 3; ++channel) {
          require(result.bgr[output_index * 3 + channel] == (inside ? source[source_index + 2 - channel] : 0),
                  "Crop BGR order changed");
        }
      }
    }
  }
  require(source == before, "Crop changed source or padding");
  AffineWarpResult aliased;
  require(warp_crop_rgba(view, {0, 0, width, height, width, height}, aliased), "Identity crop rejected");
  const auto expected = aliased;
  require(warp_crop_rgba({aliased.rgba, width, height, width * 4},
                         {0, 0, width, height, width, height}, aliased), "Aliased crop rejected");
  require(aliased == expected, "Aliased crop changed pixels");
}

void rejections() {
  const TransformPlan sentinel{{71, 72, 73, 74, 75, 76}, {81, 82, 83, 84, 85, 86}};
  TransformPlan output = sentinel;
  const AnchorResizeRequest valid{{0, 0, 2, 2}, {0, 0, 3, 3}};
  auto reject = [&](const AnchorResizeRequest& request) {
    require(!plan_anchor_resize(request, output) && output == sentinel,
            "Unsupported anchor plan accepted or changed output");
  };
  for (float invalid : {std::numeric_limits<float>::quiet_NaN(),
                         std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity()}) {
    for (std::size_t index = 0; index < 4; ++index) {
      auto request = valid;
      request.source_points[index] = invalid;
      reject(request);
      request = valid;
      request.destination_points[index] = invalid;
      reject(request);
    }
  }
  reject({{0, 0, 0, 2}, {0, 0, 3, 3}});
  reject({{0, 0, 2, 2}, {0, 0, 0, 3}});
  reject({{0, 0, std::nextafter(0x1.4p-20F, 0.0F), 2}, {0, 0, 3, 3}});
  reject({{1000000, 0, 1000001, 2}, {0, 0, 2, 2}});
  reject({{0, -1000000, 2, -999999}, {0, 0, 2, 2}});
  reject({{0, 0, 1, 2}, {-std::numeric_limits<float>::max(), 0,
                          std::numeric_limits<float>::max(), 3}});
  for (const auto& crop : {CropResizeRequest{0, 0, 1, 2, 2, 2}, {0, 0, 2, -2, 2, 2},
                           {0, 0, 2, 2, 1, 2}, {0, 0, 2, 2, 2, 0}, {0, 0, 2, 2, 8193, 2},
                           {0, 0, 2, 2, 8192, 8192}, {0x1p25F, 0, 2, 2, 2, 2}}) {
    require(!plan_crop_resize(crop, output) && output == sentinel,
            "Unsupported crop accepted or changed output");
  }
  const int saved = std::fegetround();
  require(std::fesetround(FE_DOWNWARD) == 0, "Cannot set rounding negative control");
  const bool accepted = plan_anchor_resize(valid, output);
  require(std::fesetround(saved) == 0, "Cannot restore rounding mode");
  require(!accepted && output == sentinel, "Unsupported rounding accepted or changed output");
  AffineWarpResult pixels{{1, 2, 3}, {4, 5, 6}};
  const auto pixels_before = pixels;
  require(!warp_crop_rgba({pixels.rgba, 2, 2, 8}, {0, 0, 2, 2, 2, 2}, pixels) && pixels == pixels_before,
          "Short source accepted or changed output");
}
}  // namespace

int main() {
  try {
    native_golden();
    coordinates();
    pixels();
    rejections();
    std::cout << "Lens transform plans: " << checks << " checks passed\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
