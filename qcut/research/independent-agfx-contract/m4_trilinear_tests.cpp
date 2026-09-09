#include "m4_trilinear_fixtures.hpp"

#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

using namespace agfx_contract;

namespace {
struct Checks {
  std::size_t count = 0;
  void require(bool value, std::string_view name) {
    ++count;
    if (!value) throw std::runtime_error(std::string(name));
  }
};

void native_fingerprint(Checks& checks) {
  const auto fixture = agfx_test::m4_fixture(3, 5, false, agfx_test::trilinear_pattern);
  const auto queries = agfx_test::trilinear_portable_queries();
  std::uint64_t fingerprint = 14695981039346656037ULL;
  for (int s = 0; s < 4; ++s) {
    for (int t = 0; t < 4; ++t) {
      const SampleSettings settings{TexelFilter::linear, static_cast<TexelWrap>(s), static_cast<TexelWrap>(t)};
      const auto result = sample_m4_texture_points({fixture.levels, queries, settings, MipFilter::linear});
      checks.require(result.size() == queries.size(), "trilinear batch shape");
      for (const auto& color : result) agfx_test::hash_color(fingerprint, color);
      checks.require(result.back() == sample_m4_texture({fixture.levels, queries.back().point,
          settings, queries.back().lod, MipFilter::linear}), "trilinear single/batch agreement");
    }
  }
  checks.require(fingerprint == 0xbbfdad0c20dff23aULL, "native trilinear fingerprint including joint-weight ties and mixed wraps");
}

void constant_texture(Checks& checks) {
  const std::array<std::uint8_t, 4> value{3, 127, 254, 211};
  const std::array<float, 4> expected{48.0F / 4080.0F, 2032.0F / 4080.0F, 4064.0F / 4080.0F, 3376.0F / 4080.0F};
  auto fixture = agfx_test::m4_fixture(3, 5, false);
  for (std::size_t level = 0; level < fixture.levels.size(); ++level) {
    const auto& view = fixture.levels[level];
    auto& bytes = fixture.storage[level];
    for (std::uint32_t y = 0; y < view.height; ++y) {
      for (std::uint32_t x = 0; x < view.width; ++x) {
        const auto offset = y * view.row_stride + static_cast<std::size_t>(x) * 4;
        std::copy(value.begin(), value.end(), bytes.begin() + static_cast<std::ptrdiff_t>(offset));
      }
    }
  }
  auto queries = agfx_test::trilinear_portable_queries();
  for (const auto s : {TexelWrap::repeat, TexelWrap::clamp, TexelWrap::mirror}) {
    for (const auto t : {TexelWrap::repeat, TexelWrap::clamp, TexelWrap::mirror}) {
      const auto colors = sample_m4_texture_points({fixture.levels, queries, {TexelFilter::linear, s, t}, MipFilter::linear});
      checks.require(std::all_of(colors.begin(), colors.end(), [&](const auto& color) { return color == expected; }),
          "all joint weights preserve a constant signal and its alpha");
    }
  }
  const SampleSettings border{TexelFilter::linear, TexelWrap::border, TexelWrap::border};
  checks.require(sample_m4_texture({fixture.levels, {-8.0F, 8.0F}, border, .51F, MipFilter::linear}) ==
      std::array<float, 4>{}, "transparent outside both selected levels");
}

void addressing_goldens(Checks& checks) {
  const auto mirror_fixture = agfx_test::m4_fixture(2, 2, false, agfx_test::trilinear_pattern);
  const auto mirror_query = agfx_test::trilinear_queries(2, 2, 2).at(2063);
  const SampleSettings mirrored{TexelFilter::linear, TexelWrap::repeat, TexelWrap::mirror};
  const auto mirror_color = sample_m4_texture({mirror_fixture.levels, mirror_query.point, mirrored,
      mirror_query.lod, MipFilter::linear});
  checks.require(std::bit_cast<std::uint32_t>(mirror_color[2]) == 1052186391U,
      "native mirror reversal golden at a joint-weight half step");
  const std::array<std::uint8_t, 4> black{};
  const std::array<std::uint8_t, 16> white{255, 255, 255, 255, 255, 255, 255, 255,
                                        255, 255, 255, 255, 255, 255, 255, 255};
  const std::array levels{TextureView{white, 2, 2}, TextureView{black, 1, 1}};
  const SampleSettings border{TexelFilter::linear, TexelWrap::border, TexelWrap::border};
  checks.require(sample_m4_texture({levels, {0, 0}, border, .5F, MipFilter::linear}) ==
      std::array<float, 4>{.125F, .125F, .125F, .125F}, "corner quarter coverage followed by half mip weight");
  const SampleSettings clamp{TexelFilter::linear, TexelWrap::clamp, TexelWrap::clamp};
  checks.require(sample_m4_texture({levels, {-8.0F, 8.0F}, clamp, .5F, MipFilter::linear}) ==
      std::array<float, 4>{.5F, .5F, .5F, .5F}, "clamped footprint retains complete mip coverage");
  checks.require(sample_m4_texture({levels, {.5F, .5F}, clamp, 8.0F, MipFilter::linear}) ==
      std::array<float, 4>{}, "terminal mip has no contribution from preceding level");
}
} // namespace

int main() {
  try {
    Checks checks;
    native_fingerprint(checks);
    constant_texture(checks);
    addressing_goldens(checks);
    std::cout << "M4 trilinear profile: " << checks.count << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
