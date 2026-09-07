#include "mip_sample.hpp"

#include <bit>
#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

using namespace agfx_contract;

namespace {

struct Checks {
  std::size_t count = 0;
  void require(bool condition, std::string_view label) {
    ++count;
    if (!condition) throw std::runtime_error(std::string(label));
  }
  template <typename Action> void rejects(Action action, std::string_view label) {
    bool rejected = false;
    try { action(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, label);
  }
};

void lod_cases(Checks& checks) {
  struct Fixture { float lod; MipSelection nearest; MipSelection linear; };
  const std::array fixtures{
    Fixture{-1.0F, {0, 0, 0}, {0, 1, 0}},
    Fixture{0.0F, {0, 0, 0}, {0, 1, 0}},
    Fixture{0.49F, {0, 0, 0}, {0, 1, 31}},
    Fixture{0.5F, {0, 0, 0}, {0, 1, 32}},
    Fixture{0.51F, {0, 0, 0}, {0, 1, 32}},
    Fixture{0.515380859375F, {1, 1, 0}, {0, 1, 33}},
    Fixture{0.75F, {1, 1, 0}, {0, 1, 48}},
    Fixture{1.49951171875F, {1, 1, 0}, {1, 2, 32}},
    Fixture{1.51F, {1, 1, 0}, {1, 2, 32}},
    Fixture{1.51513671875F, {2, 2, 0}, {1, 2, 33}},
    Fixture{2.4990234375F, {2, 2, 0}, {2, 3, 32}},
    Fixture{2.5146484375F, {3, 3, 0}, {2, 3, 33}},
    Fixture{14.0F, {14, 14, 0}, {14, 14, 0}},
    Fixture{100.0F, {14, 14, 0}, {14, 14, 0}},
  };
  for (const auto& fixture : fixtures) {
    checks.require(select_m4_mip({fixture.lod, 15, MipFilter::nearest}) == fixture.nearest, "native LOD nearest golden");
    checks.require(select_m4_mip({fixture.lod, 15, MipFilter::linear}) == fixture.linear, "native LOD linear golden");
    checks.require(select_m4_mip({fixture.lod, 15, MipFilter::none}) == MipSelection{0, 0, 0}, "disabled mip selects base");
  }
  // Every 1/64 boundary is binary16-representable in the supported LOD range.
  for (std::uint32_t unit = 1; unit < 14 * 64; ++unit) {
    const float boundary = static_cast<float>(unit) / 64.0F;
    const auto half_bits = std::bit_cast<std::uint32_t>(boundary);
    const float previous_half = std::bit_cast<float>(half_bits - (1U << 13));
    const float midpoint = (boundary + previous_half) * .5F;
    const auto lower = select_m4_mip({std::nextafter(midpoint, 0.0F), 15, MipFilter::linear});
    const auto upper = select_m4_mip({std::nextafter(midpoint, 15.0F), 15, MipFilter::linear});
    checks.require(lower.first * 64 + lower.weight_64 == unit - 1, "float immediately below half midpoint");
    checks.require(upper.first * 64 + upper.weight_64 == unit, "float immediately above half midpoint");
    const auto tied = select_m4_mip({midpoint, 15, MipFilter::linear});
    const auto rounded_unit = ((half_bits >> 13) & 1U) == 0 ? unit : unit - 1;
    checks.require(tied.first * 64 + tied.weight_64 == rounded_unit, "half midpoint rounds to even");
  }
  for (std::uint32_t count = 1; count <= 15; ++count) {
    for (const auto mode : {MipFilter::none, MipFilter::nearest, MipFilter::linear}) {
      checks.require(select_m4_mip({-std::numeric_limits<float>::max(), count, mode}).first == 0, "negative finite clamp");
      const auto result = select_m4_mip({std::numeric_limits<float>::max(), count, mode});
      const auto last = mode == MipFilter::none ? 0U : count - 1;
      checks.require(result == MipSelection{last, last, 0}, "positive finite clamp");
    }
  }
  for (const auto invalid : {std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
    checks.rejects([&] { select_m4_mip({invalid, 4, MipFilter::none}); }, "nonfinite LOD rejected even if unused");
  }
  for (const auto count : {0U, 16U, 0xffffffffU}) {
    checks.rejects([&] { select_m4_mip({0, count, MipFilter::linear}); }, "invalid count rejected");
  }
  checks.rejects([] { select_m4_mip({0, 4, static_cast<MipFilter>(3)}); }, "invalid filter rejected");
}

void blend_cases(Checks& checks) {
  checks.require(blend_m4_mip_texels({{0, 0, 255, 85}, {255, 85, 0, 0}, 1}) ==
      std::array<float, 4>{64.0F / 4080.0F, 21.0F / 4080.0F, 4016.0F / 4080.0F, 1339.0F / 4080.0F}, "native fixed-point blend golden");
  checks.require(blend_m4_mip_texels({{0, 85, 0, 1}, {85, 0, 1, 0}, 2}) ==
      std::array<float, 4>{43.0F / 4080.0F, 1318.0F / 4080.0F, 1.0F / 4080.0F, 16.0F / 4080.0F}, "half byte/16 steps round upward in both directions");
  for (std::uint32_t a = 0; a < 256; ++a) {
    for (std::uint32_t b = 0; b < 256; ++b) {
      const auto first = static_cast<std::uint8_t>(a);
      const auto second = static_cast<std::uint8_t>(b);
      for (std::uint32_t weight = 0; weight <= 64; ++weight) {
        const auto actual = blend_m4_mip_texels({{first, first, second, second}, {second, second, first, first}, weight});
        const double precise = static_cast<double>(a) + (static_cast<double>(b) - a) * weight / 64.0;
        const float expected = static_cast<float>(std::floor(precise * 16.0 + .5)) / 4080.0F;
        checks.require(actual[0] == expected && actual[1] == expected, "exhaustive byte pair fixed-point arithmetic");
        checks.require(actual[0] >= 0 && actual[0] <= 1, "UNORM blend range");
      }
    }
  }
  checks.rejects([] { blend_m4_mip_texels({{}, {}, 65}); }, "invalid blend weight rejected");
  const auto original_rounding = std::fegetround();
  checks.require(std::fesetround(FE_DOWNWARD) == 0, "set rounding negative control");
  bool rejected = false;
  try { blend_m4_mip_texels({{}, {}, 1}); } catch (const std::invalid_argument&) { rejected = true; }
  const auto restored = std::fesetround(original_rounding);
  checks.require(restored == 0 && rejected, "reject wrong rounding and restore environment");
}

void texture_cases(Checks& checks) {
  const std::array<std::uint8_t, 8> base{255, 0, 0, 255, 0, 0, 255, 0};
  const std::array<std::uint8_t, 4> next{0, 255, 0, 255};
  const std::array levels{TextureView{base, 2, 1}, TextureView{next, 1, 1}};
  MipTextureRequest request{levels, {.25F, .5F}, {TexelFilter::nearest}, .51F, MipFilter::nearest};
  checks.require(sample_m4_mip_texture(request) == std::array<float, 4>{1, 0, 0, 1}, "quantized nearest retains low level above .5");
  request.lod = .515380859375F;
  checks.require(sample_m4_mip_texture(request) == std::array<float, 4>{0, 1, 0, 1}, "quantized nearest switches at measured boundary");
  request.lod = .51F;
  request.filter = MipFilter::linear;
  checks.require(sample_m4_mip_texture(request) == std::array<float, 4>{.5F, .5F, 0, 1}, "quantized LOD linear blend");
  request.point = {.5F, .5F};
  request.settings.filter = TexelFilter::linear;
  checks.require(sample_m4_mip_texture(request) == std::array<float, 4>{.25F, .5F, .25F, .75F}, "spatial and mip interpolation preserve straight alpha");
  request.point.w = 0;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "2D domain only");
  request.point.w = .5F;
  auto invalid = levels;
  request.levels = invalid;
  request.filter = MipFilter::none;
  invalid[1].bytes = {};
  checks.rejects([&] { sample_m4_mip_texture(request); }, "validate truncated unselected level");
  invalid = levels;
  invalid[1].width = 2;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "halved dimensions required");
  invalid = levels;
  invalid[1].order = ChannelOrder::bgra;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "mixed channel order rejected");
  invalid = levels;
  invalid[1].depth = 2;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "volume mip chain rejected");
  invalid = levels;
  invalid[0].row_stride = 7;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "short row rejected");
  invalid = levels;
  invalid[0].width = 16385;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "unsupported extent rejected");
  request.levels = {};
  checks.rejects([&] { sample_m4_mip_texture(request); }, "empty chain rejected");
  const std::array excess{levels[1], levels[1]};
  request.levels = excess;
  checks.rejects([&] { sample_m4_mip_texture(request); }, "excess levels rejected");
}

void native_blend_fingerprint(Checks& checks) {
  std::uint64_t hash = 14695981039346656037ULL;
  const auto pixel = [](std::uint32_t value, bool second) {
    return std::array<std::uint8_t, 4>{static_cast<std::uint8_t>(value), static_cast<std::uint8_t>(255 - value),
        static_cast<std::uint8_t>(value ^ (second ? 0xaaU : 0x55U)),
        static_cast<std::uint8_t>(value ^ (second ? 0x55U : 0xaaU))};
  };
  // Native matrix order: RGBA then BGRA, weight, second byte, first byte, RGBA channel, LE float bits.
  for (unsigned format = 0; format < 2; ++format) {
    for (std::uint32_t weight = 0; weight <= 64; ++weight) {
      for (std::uint32_t second = 0; second < 256; ++second) {
        for (std::uint32_t first = 0; first < 256; ++first) {
          const auto result = blend_m4_mip_texels({pixel(first, false), pixel(second, true), weight});
          for (const auto value : result) {
            const auto bits = std::bit_cast<std::uint32_t>(value);
            for (unsigned shift = 0; shift < 32; shift += 8) {
              hash ^= (bits >> shift) & 255U;
              hash *= 1099511628211ULL;
            }
          }
        }
      }
    }
  }
  checks.require(hash == 0x9e65ecff738408a5ULL, "independent native M4 exhaustive byte-pair fingerprint");
}

} // namespace

int main() {
  try {
    Checks checks;
    lod_cases(checks);
    blend_cases(checks);
    texture_cases(checks);
    native_blend_fingerprint(checks);
    std::cout << "M4 mip contract: " << checks.count << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
