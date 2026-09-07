#include "texture_sample.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

using namespace agfx_contract;

namespace {

struct Checks {
  unsigned count = 0;

  void require(bool condition, std::string_view label) {
    ++count;
    if (!condition) throw std::runtime_error(std::string(label));
  }

  void color(const std::array<float, 4>& actual,
             const std::array<float, 4>& expected, std::string_view label) {
    for (std::size_t channel = 0; channel < 4; ++channel) {
      require(std::isfinite(actual[channel]) &&
                  std::abs(actual[channel] - expected[channel]) <= 0.000001F, label);
    }
  }

  template <typename Action>
  void rejects(Action action, std::string_view label) {
    bool rejected = false;
    try {
      action();
    } catch (const std::invalid_argument&) {
      rejected = true;
    }
    require(rejected, label);
  }
};

constexpr std::array<float, 4> red{1, 0, 0, 1};
constexpr std::array<float, 4> green{0, 1, 0, 1};
constexpr std::array<float, 4> blue{0, 0, 1, 1};
constexpr std::array<float, 4> white{1, 1, 1, 1};

void interpolation_cases(Checks& checks) {
  const std::array<std::uint8_t, 16> pixels{
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255};
  const TextureView texture{pixels, 2, 2};
  const SampleSettings nearest{TexelFilter::nearest};
  const std::array points{SamplePoint{.25F, .25F}, SamplePoint{.75F, .25F},
      SamplePoint{.25F, .75F}, SamplePoint{.75F, .75F}};
  const std::array expected{red, green, blue, white};
  const auto batch = sample_texture_points(texture, points, nearest);
  checks.require(batch.size() == expected.size(), "batch cardinality");
  for (std::size_t i = 0; i < points.size(); ++i) {
    checks.color(batch[i], expected[i], "known corner nearest");
    checks.color(sample_texture(texture, points[i], {}), expected[i], "linear is exact at texel center");
  }
  checks.color(sample_texture(texture, {.5F, .5F}, {}), {.5F, .5F, .5F, 1}, "four corner average");
  checks.color(sample_texture(texture, {.375F, .625F}, {}), {.375F, .25F, .75F, 1}, "asymmetric bilinear weights");
  checks.color(sample_texture(texture, {std::nextafter(.5F, 0.0F), .25F}, nearest), red, "nearest below boundary");
  checks.color(sample_texture(texture, {.5F, .25F}, nearest), green, "nearest exact boundary chooses high texel");
  checks.color(sample_texture(texture, {1, 1}, nearest), white, "nearest clamp at unit corner");
  checks.require(sample_texture_points(texture, {}, {}).empty(), "empty sample batch");

  const std::array<std::uint8_t, 8> straight_alpha{255, 0, 0, 0, 0, 255, 0, 255};
  checks.color(sample_texture({straight_alpha, 2, 1}, {.5F, .5F}, {}), {.5F, .5F, 0, .5F},
               "sampling interpolates channels without implicit premultiplication");

  const std::array<std::uint8_t, 32> cube{
      0, 0, 0, 255, 255, 0, 0, 255,
      0, 255, 0, 255, 255, 255, 0, 255,
      0, 0, 255, 255, 255, 0, 255, 255,
      0, 255, 255, 255, 255, 255, 255, 255};
  const TextureView volume{cube, 2, 2, 2};
  checks.color(sample_texture(volume, {.5F, .5F, .5F}, {}), {.5F, .5F, .5F, 1}, "eight corner average");
  checks.color(sample_texture(volume, {.375F, .625F, .4375F}, {}), {.25F, .75F, .375F, 1}, "asymmetric trilinear weights");
  checks.color(sample_texture(volume, {.75F, .75F, .75F}, nearest), white, "nearest last voxel");
  checks.color(sample_texture(volume, {.25F, .25F, .25F}, nearest), {0, 0, 0, 1}, "nearest first voxel");
  auto repeat = nearest;
  repeat.wrap_t = TexelWrap::repeat;
  repeat.wrap_r = TexelWrap::repeat;
  checks.color(sample_texture(volume, {.25F, -.25F, -.25F}, repeat), {0, 1, 1, 1}, "negative repeat on y and z");
  repeat.wrap_t = TexelWrap::mirror;
  repeat.wrap_r = TexelWrap::mirror;
  checks.color(sample_texture(volume, {.25F, -.25F, -.25F}, repeat), {0, 0, 0, 1}, "negative mirror on y and z");
}

void address_cases(Checks& checks) {
  const std::array<std::uint8_t, 8> pixels{255, 0, 0, 255, 0, 0, 255, 255};
  const TextureView texture{pixels, 2, 1};
  struct Fixture {
    TexelWrap wrap;
    float u;
    std::array<float, 4> nearest;
    std::array<float, 4> linear;
  };
  const std::array fixtures{
      Fixture{TexelWrap::repeat, -.25F, blue, blue},
      Fixture{TexelWrap::mirror, -.25F, red, red},
      Fixture{TexelWrap::clamp, -.25F, red, red},
      Fixture{TexelWrap::border, -.25F, green, green},
      Fixture{TexelWrap::repeat, 0, red, {.5F, 0, .5F, 1}},
      Fixture{TexelWrap::mirror, 0, red, red},
      Fixture{TexelWrap::border, 0, red, {.5F, .5F, 0, 1}},
      Fixture{TexelWrap::repeat, 1, red, {.5F, 0, .5F, 1}},
      Fixture{TexelWrap::mirror, 1, blue, blue},
      Fixture{TexelWrap::border, 1, green, {0, .5F, .5F, 1}},
      Fixture{TexelWrap::mirror, 1.25F, blue, blue},
      Fixture{TexelWrap::mirror, 1.75F, red, red},
      Fixture{TexelWrap::repeat, -1.25F, blue, blue},
      Fixture{TexelWrap::mirror, -1.25F, blue, blue},
      Fixture{TexelWrap::repeat, -2.25F, blue, blue},
      Fixture{TexelWrap::mirror, -2.25F, red, red}};
  for (const auto& fixture : fixtures) {
    SampleSettings settings{TexelFilter::nearest, fixture.wrap, TexelWrap::clamp, TexelWrap::clamp, green};
    checks.color(sample_texture(texture, {fixture.u, .5F}, settings), fixture.nearest, "known nearest address fixture");
    settings.filter = TexelFilter::linear;
    checks.color(sample_texture(texture, {fixture.u, .5F}, settings), fixture.linear, "known linear address fixture");
  }
  const std::array<std::uint8_t, 4> one{255, 255, 255, 255};
  const SampleSettings all_border{TexelFilter::linear, TexelWrap::border, TexelWrap::border, TexelWrap::border};
  checks.color(sample_texture({one, 1, 1}, {0, 0, 0}, all_border), {.125F, .125F, .125F, .125F},
               "border participates separately on all three axes");
  checks.color(sample_texture({one, 1, 1}, {-.5F, .5F}, all_border), {0, 0, 0, 0}, "full outside texel center");
  for (const auto wrap : {TexelWrap::repeat, TexelWrap::mirror, TexelWrap::clamp}) {
    const SampleSettings settings{TexelFilter::linear, wrap, wrap, wrap};
    checks.color(sample_texture({one, 1, 1}, {-100.25F, 99.5F, 7.75F}, settings), white, "unit extent at many periods");
  }
}

void layout_cases(Checks& checks) {
  const std::array<std::uint8_t, 48> padded_bgra{
      0, 0, 255, 11, 0, 255, 0, 22, 253, 253, 253, 253,
      255, 0, 0, 33, 255, 255, 255, 44, 253, 253, 253, 253, 253, 253, 253, 253,
      0, 0, 0, 55, 0, 255, 255, 66, 253, 253, 253, 253,
      255, 0, 255, 77, 255, 255, 0, 88};
  const std::array<std::uint8_t, 32> expected{
      255, 0, 0, 11, 0, 255, 0, 22, 0, 0, 255, 33, 255, 255, 255, 44,
      0, 0, 0, 55, 255, 255, 0, 66, 255, 0, 255, 77, 0, 255, 255, 88};
  const TextureView texture{padded_bgra, 2, 2, 2, 12, 28, ChannelOrder::bgra};
  const auto packed = tight_rgba8(texture);
  checks.require(packed.size() == expected.size(), "tight BGRA output size excludes padding");
  for (std::size_t i = 0; i < expected.size(); ++i) checks.require(packed[i] == expected[i], "known BGRA row and slice layout");
  const std::array positions{SamplePoint{.25F, .25F, .25F}, SamplePoint{.75F, .25F, .25F},
      SamplePoint{.25F, .75F, .25F}, SamplePoint{.75F, .75F, .25F},
      SamplePoint{.25F, .25F, .75F}, SamplePoint{.75F, .25F, .75F},
      SamplePoint{.25F, .75F, .75F}, SamplePoint{.75F, .75F, .75F}};
  const auto samples = sample_texture_points(texture, positions, {});
  for (std::size_t i = 0; i < positions.size(); ++i) {
    checks.color(samples[i], {expected[4 * i] / 255.0F, expected[4 * i + 1] / 255.0F,
                              expected[4 * i + 2] / 255.0F, expected[4 * i + 3] / 255.0F}, "padded sampling known voxel");
  }
  const std::array<std::uint8_t, 12> final_padding{1, 2, 3, 4, 250, 250, 250, 250, 5, 6, 7, 8};
  checks.require(tight_rgba8({final_padding, 1, 2, 1, 8}) == std::vector<std::uint8_t>({1, 2, 3, 4, 5, 6, 7, 8}),
                 "last row trailing padding is not required");
}

void rejection_cases(Checks& checks) {
  const std::array<std::uint8_t, 16> pixels{};
  const TextureView valid{pixels, 2, 2};
  const auto max = std::numeric_limits<std::size_t>::max();
  const auto max_dimension = std::numeric_limits<std::uint32_t>::max();
  const std::array invalid_textures{
      TextureView{pixels, 0, 2}, TextureView{pixels, 2, 0}, TextureView{pixels, 2, 2, 0},
      TextureView{pixels, 2, 2, 1, 7}, TextureView{pixels, 2, 2, 2, 8, 15},
      TextureView{std::span(pixels).first(15), 2, 2}, TextureView{pixels, 2, 2, 2},
      TextureView{pixels, 1, 2, 1, max}, TextureView{pixels, 1, 1, 3, 4, max},
      TextureView{pixels, max_dimension, max_dimension, max_dimension},
      TextureView{pixels, 2, 2, 1, 0, 0, static_cast<ChannelOrder>(-1)}};
  for (const auto& texture : invalid_textures) {
    checks.rejects([&] { static_cast<void>(tight_rgba8(texture)); }, "malformed layout conversion rejected");
    checks.rejects([&] { static_cast<void>(sample_texture(texture, {.5F, .5F}, {})); }, "malformed layout sample rejected");
    checks.rejects([&] { static_cast<void>(sample_texture_points(texture, {}, {})); }, "empty batch cannot bypass layout validation");
  }
  for (const int invalid : {-1, 999}) {
    SampleSettings settings{};
    settings.filter = static_cast<TexelFilter>(invalid);
    checks.rejects([&] { static_cast<void>(sample_texture(valid, {.5F, .5F}, settings)); }, "unknown filter rejected");
    checks.rejects([&] { static_cast<void>(sample_texture_points(valid, {}, settings)); }, "empty batch validates filter");
    for (unsigned axis_index = 0; axis_index < 3; ++axis_index) {
      settings = {};
      if (axis_index == 0) settings.wrap_s = static_cast<TexelWrap>(invalid);
      if (axis_index == 1) settings.wrap_t = static_cast<TexelWrap>(invalid);
      if (axis_index == 2) settings.wrap_r = static_cast<TexelWrap>(invalid);
      checks.rejects([&] { static_cast<void>(sample_texture(valid, {.5F, .5F}, settings)); }, "unknown wrap rejected on each axis");
    }
  }
  for (const float value : {std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity(),
                           std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::max(), 0x1p62F, -0x1p62F}) {
    for (unsigned axis_index = 0; axis_index < 3; ++axis_index) {
      SamplePoint point{.5F, .5F, .5F};
      if (axis_index == 0) point.u = value;
      if (axis_index == 1) point.v = value;
      if (axis_index == 2) point.w = value;
      for (const auto filter : {TexelFilter::linear, TexelFilter::nearest}) {
        checks.rejects([&] { static_cast<void>(sample_texture(valid, point, {filter})); }, "nonfinite or out-of-domain coordinate rejected");
      }
    }
  }
  for (const float value : {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
    for (std::size_t channel = 0; channel < 4; ++channel) {
      SampleSettings settings{};
      settings.border_color[channel] = value;
      checks.rejects([&] { static_cast<void>(sample_texture(valid, {.5F, .5F}, settings)); }, "nonfinite border rejected even when unused");
    }
  }
  const std::array partial{SamplePoint{.5F, .5F}, SamplePoint{std::numeric_limits<float>::quiet_NaN(), .5F}};
  checks.rejects([&] { static_cast<void>(sample_texture_points(valid, partial, {})); }, "batch throws instead of returning partial output");
}

} // namespace

int main() {
  Checks checks;
  interpolation_cases(checks);
  address_cases(checks);
  layout_cases(checks);
  rejection_cases(checks);
  std::cout << checks.count << " texture sampling checks passed\n";
  return 0;
}
