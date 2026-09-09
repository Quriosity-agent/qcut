#include "m4_texture_fixtures.hpp"

#include <cfenv>
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
  template <typename Action> void rejects(Action action, std::string_view name) {
    bool rejected = false;
    try { action(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, name);
  }
};

void known_cases(Checks& checks) {
  const std::array<std::uint8_t, 8> pixels{0, 85, 255, 1, 255, 0, 0, 0};
  const std::array levels{TextureView{pixels, 2, 1}};
  MipTextureRequest request{levels, {.25F + 1.0F / 512.0F, .5F}, {}, 0, MipFilter::none};
  checks.require(sample_m4_texture(request) == std::array<float, 4>{16.F / 4080.F, 1355.F / 4080.F, 4064.F / 4080.F, 16.F / 4080.F},
      "byte/16 golden after one spatial weight step");
  request.point.u = .25F + .5F / 512.0F;
  const auto at_tie = sample_m4_texture(request);
  request.point.u = std::nextafter(request.point.u, 0.0F);
  checks.require(at_tie[0] == 16.F / 4080.F && sample_m4_texture(request)[0] == 0, "spatial weight half step rounds upward");
  request.point = {-.25F, .5F};
  request.settings.filter = TexelFilter::nearest;
  request.settings.wrap_s = TexelWrap::repeat;
  checks.require(sample_m4_texture(request)[0] == 1, "negative repeat selects last texel");
  request.settings.wrap_s = TexelWrap::mirror;
  checks.require(sample_m4_texture(request)[0] == 0, "negative mirror selects first texel");
  request.settings.wrap_s = TexelWrap::border;
  checks.require(sample_m4_texture(request) == std::array<float, 4>{}, "nearest transparent border");
  request.point.u = -0.0F;
  checks.require(sample_m4_texture(request)[2] == 1, "signed zero remains on first texel");
  request.point.u = -0x1p-24F;
  checks.require(sample_m4_texture(request) == std::array<float, 4>{}, "negative verified lower boundary remains outside");
  const std::array<std::uint8_t, 4> next{255, 255, 255, 255};
  const std::array chain{levels[0], TextureView{next, 1, 1}};
  request.levels = chain;
  request.point = {.25F, .5F};
  request.lod = 1.0F / 64.0F;
  request.filter = MipFilter::linear;
  checks.require(sample_m4_texture(request) == blend_m4_mip_texels({{0, 85, 255, 1}, next, 1}), "nearest spatial and exact cross-level blending compose");
  request.settings.filter = TexelFilter::linear;
  request.settings.wrap_s = TexelWrap::clamp;
  checks.require(sample_m4_texture(request) == blend_m4_mip_texels({{0, 85, 255, 1}, next, 1}), "linear spatial and mip blend preserve texel-center golden");
}

void native_fingerprint(Checks& checks) {
  auto fixture = agfx_test::m4_fixture(3, 5, false);
  auto queries = agfx_test::m4_queries(3, 5);
  std::uint64_t hash = 14695981039346656037ULL;
  for (int spatial = 0; spatial < 2; ++spatial) {
    for (int mip = 0; mip < 3; ++mip) {
      if (spatial == 1 && mip == 2) continue;
      for (int s = 0; s < 4; ++s) {
        for (int t = 0; t < 4; ++t) {
          const SampleSettings settings{static_cast<TexelFilter>(spatial), static_cast<TexelWrap>(s), static_cast<TexelWrap>(t)};
          const auto result = sample_m4_texture_points({fixture.levels, queries, settings, static_cast<MipFilter>(mip)});
          checks.require(result.size() == queries.size(), "batch shape");
          for (const auto& value : result) agfx_test::hash_color(hash, value);
          checks.require(result.front() == sample_m4_texture({fixture.levels, queries.front().point, settings, queries.front().lod, static_cast<MipFilter>(mip)}), "single/batch consistency");
        }
      }
    }
  }
  checks.require(hash == 0x8305e9f8bc561478ULL, "independent native 3x5 fixture fingerprint");
  const SampleSettings repeat{TexelFilter::linear, TexelWrap::repeat, TexelWrap::repeat};
  const SamplePoint outside{0x1.701554p+1F, 0x1.2c2fecp+0F};
  const SamplePoint reduced{outside.u - 2.0F, outside.v - 1.0F};
  checks.require(sample_m4_texture({fixture.levels, outside, repeat, 0, MipFilter::none}) ==
      sample_m4_texture({fixture.levels, reduced, repeat, 0, MipFilter::none}), "repeat reduces before float dimension multiplication");
}

void invalid_cases(Checks& checks) {
  auto fixture = agfx_test::m4_fixture(3, 5, true);
  const std::array query{M4SampleQuery{{.25F, .5F}, 0}};
  M4TextureBatch batch{fixture.levels, query, {}, MipFilter::nearest};
  auto mutated = query;
  batch.queries = mutated;
  for (const auto invalid : {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN(),
                            std::nextafter(8.F, 9.F), -65536.F, std::numeric_limits<float>::denorm_min(),
                            -std::numeric_limits<float>::min(), std::numeric_limits<float>::min(),
                            std::nextafter(-0x1p-24F, 0.0F), std::nextafter(0x1p-24F, 0.0F)}) {
    mutated = query;
    mutated[0].point.u = invalid;
    checks.rejects([&] { sample_m4_texture_points(batch); }, "nonfinite or unverified u coordinate range");
    mutated[0].point = {.25F, invalid};
    checks.rejects([&] { sample_m4_texture_points(batch); }, "nonfinite or unverified v coordinate range");
  }
  mutated = query;
  mutated[0].lod = std::numeric_limits<float>::quiet_NaN();
  checks.rejects([&] { sample_m4_texture_points(batch); }, "invalid LOD");
  mutated = query;
  mutated[0].point.w = 0;
  checks.rejects([&] { sample_m4_texture_points(batch); }, "2D only");
  mutated = query;
  batch.settings.border_color[0] = 1;
  checks.rejects([&] { sample_m4_texture_points(batch); }, "unsupported border color");
  batch.settings = {};
  batch.settings.wrap_t = static_cast<TexelWrap>(4);
  checks.rejects([&] { sample_m4_texture_points(batch); }, "invalid wrap");
  batch.settings = {};
  batch.queries = {};
  checks.require(sample_m4_texture_points(batch).empty(), "empty batch still validates setup");
  batch.mip = static_cast<MipFilter>(3);
  checks.rejects([&] { sample_m4_texture_points(batch); }, "empty batch rejects invalid mip");
  batch.mip = MipFilter::nearest;
  fixture.levels.back().bytes = {};
  checks.rejects([&] { sample_m4_texture_points(batch); }, "unselected truncated level rejected");
  fixture = agfx_test::m4_fixture(3, 5, true);
  batch.levels = fixture.levels;
  const auto rounding = std::fegetround();
  checks.require(std::fesetround(FE_UPWARD) == 0, "set alternate rounding");
  bool rejected = false;
  try { sample_m4_texture_points(batch); } catch (const std::invalid_argument&) { rejected = true; }
  const auto restored = std::fesetround(rounding);
  checks.require(restored == 0 && rejected, "reject alternate rounding and restore environment");
}
} // namespace

int main() {
  try {
    Checks checks;
    known_cases(checks);
    native_fingerprint(checks);
    invalid_cases(checks);
    std::cout << "M4 spatial profile: " << checks.count << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
