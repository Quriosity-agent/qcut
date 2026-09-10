#pragma once

#include "gl_fragment_profile.hpp"

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <string_view>
#include <vector>

namespace agfx_test {

inline constexpr std::uint64_t fragment_fnv_offset = 14695981039346656037ULL;
inline constexpr std::uint64_t fragment_fnv_prime = 1099511628211ULL;

inline void hash_fragment_word(std::uint64_t& hash, std::uint32_t value) noexcept {
  for (std::size_t index = 0; index < 4; ++index) {
    hash ^= (value >> (index * 8)) & 0xffU;
    hash *= fragment_fnv_prime;
  }
}

inline std::uint64_t hash_fragment_floats(const float* values, std::size_t count) noexcept {
  std::uint64_t hash = fragment_fnv_offset;
  for (std::size_t index = 0; index < count; ++index) {
    hash_fragment_word(hash, std::bit_cast<std::uint32_t>(values[index]));
  }
  return hash;
}

// Fixed-seed generator for the operand sets the lowering measurements use, so
// the two independent oracle runs and the sanitized run see the same operands.
inline constexpr std::uint32_t fragment_fixture_seed = 0x51435554U;

inline std::uint32_t next_fragment_word(std::uint32_t& state) noexcept {
  state = state * 1664525U + 1013904223U;
  return state;
}

// The uniform block one recovered draw carries. Each capture pins its own
// sigma/step pair because the plan derives them from the source dimensions;
// the sample count, gamma and border mode are identical across all six.
struct PinnedAxisDraw {
  std::string_view capture;
  agfx_contract::PassAxis axis;
  std::uint32_t width;
  std::uint32_t height;
  float sample_count;
  float step;
  float sigma;
};

// Six captures, two Gaussian draws each. Values are the uniform words the
// capture recorded, not values re-derived from the plan.
inline constexpr std::array<PinnedAxisDraw, 12> pinned_axis_draws{{
    {"chart-final-a", agfx_contract::PassAxis::horizontal, 160, 90, 7.46030283F, 0.00527793588F, 0.0157500003F},
    {"chart-final-a", agfx_contract::PassAxis::vertical, 160, 90, 7.46030283F, 0.00938299764F, 0.0280000009F},
    {"chart-final-b", agfx_contract::PassAxis::horizontal, 160, 90, 7.46030283F, 0.00527793588F, 0.0157500003F},
    {"chart-final-b", agfx_contract::PassAxis::vertical, 160, 90, 7.46030283F, 0.00938299764F, 0.0280000009F},
    {"offaxis-final-a", agfx_contract::PassAxis::horizontal, 128, 72, 7.46030283F, 0.00529390899F, 0.0157976653F},
    {"offaxis-final-a", agfx_contract::PassAxis::vertical, 128, 72, 7.46030283F, 0.00938299764F, 0.0280000009F},
    {"offaxis-final-b", agfx_contract::PassAxis::horizontal, 128, 72, 7.46030283F, 0.00529390899F, 0.0157976653F},
    {"offaxis-final-b", agfx_contract::PassAxis::vertical, 128, 72, 7.46030283F, 0.00938299764F, 0.0280000009F},
    {"ramp-final-a", agfx_contract::PassAxis::horizontal, 160, 90, 7.46030283F, 0.00529072434F, 0.0157881621F},
    {"ramp-final-a", agfx_contract::PassAxis::vertical, 160, 90, 7.46030283F, 0.00938299764F, 0.0280000009F},
    {"ramp-final-b", agfx_contract::PassAxis::horizontal, 160, 90, 7.46030283F, 0.00529072434F, 0.0157881621F},
    {"ramp-final-b", agfx_contract::PassAxis::vertical, 160, 90, 7.46030283F, 0.00938299764F, 0.0280000009F},
}};

// Every draw admits exactly seven taps: the counter stops at the first index
// whose float conversion exceeds 7.46030283.
inline constexpr std::uint32_t pinned_tap_count = 7;

// One measured profile: the eight fp32 values the GL fragment stage produced
// for exp((((-0.5) * n * step) * n * step) / (sigma * sigma)) on the verified
// renderer, in tap order with the centre first. These are observations, not a
// recovered algorithm; the standard library disagrees with several of them.
struct PinnedTapWeights {
  std::string_view name;
  std::array<std::uint32_t, 8> measured;
  std::uint32_t libm_differences;
};

// Filled from the oracle's JSON. `libm_differences` counts how many of the
// eight the standard library reproduces incorrectly on the same inputs.
inline constexpr std::array<PinnedTapWeights, 4> pinned_tap_weights{{
    {"chart-x", {0x3f800000U, 0x3f7205a9U, 0x3f4c80d7U, 0x3f1a7216U, 0x3ed080a2U, 0x3e7b949bU, 0x3e07a83bU, 0x3d82c214U}, 3U},
    {"offaxis-x", {0x3f800000U, 0x3f7205a9U, 0x3f4c80d7U, 0x3f1a7215U, 0x3ed080a1U, 0x3e7b9495U, 0x3e07a838U, 0x3d82c213U}, 5U},
    {"ramp-x", {0x3f800000U, 0x3f7205a9U, 0x3f4c80d7U, 0x3f1a7216U, 0x3ed080a2U, 0x3e7b9498U, 0x3e07a83bU, 0x3d82c214U}, 3U},
    {"shared-y", {0x3f800000U, 0x3f7205a9U, 0x3f4c80d7U, 0x3f1a7215U, 0x3ed080a1U, 0x3e7b9495U, 0x3e07a838U, 0x3d82c214U}, 3U},
}};

// Fingerprint of the complete 4081-entry gamma-decode table the GL fragment
// stage produced for pow(index / 4080, 2.2), and how many of those entries the
// standard library reproduces differently on the same inputs.
inline constexpr std::uint64_t pinned_gamma_decode_fingerprint = 0xd247d3a561d1b9f8ULL;
inline constexpr std::uint32_t pinned_gamma_decode_libm_differences = 2860U;
inline constexpr std::uint32_t pinned_gamma_decode_maximum_ulp = 18U;

// Per-draw attribution. `libm` is the standard-library model, `measured` adds
// the measured tap and gamma tables plus the fused accumulate, and
// `instrumented` additionally evaluates the closing divide and gamma encode on
// the same fragment stage. All three are reported; none is selected for looking
// better than the others.
struct PinnedAttribution {
  std::string_view capture;
  agfx_contract::PassAxis axis;
  std::uint32_t bytes;
  std::uint32_t libm_differences;
  std::uint32_t measured_differences;
  std::uint32_t instrumented_differences;
};

inline constexpr std::array<PinnedAttribution, 12> pinned_attribution{{
    {"chart-final-a", agfx_contract::PassAxis::horizontal, 57600, 0, 0, 0},
    {"chart-final-a", agfx_contract::PassAxis::vertical, 57600, 0, 0, 0},
    {"chart-final-b", agfx_contract::PassAxis::horizontal, 57600, 0, 0, 0},
    {"chart-final-b", agfx_contract::PassAxis::vertical, 57600, 0, 0, 0},
    {"offaxis-final-a", agfx_contract::PassAxis::horizontal, 36864, 0, 0, 0},
    {"offaxis-final-a", agfx_contract::PassAxis::vertical, 36864, 0, 0, 0},
    {"offaxis-final-b", agfx_contract::PassAxis::horizontal, 36864, 0, 0, 0},
    {"offaxis-final-b", agfx_contract::PassAxis::vertical, 36864, 0, 0, 0},
    {"ramp-final-a", agfx_contract::PassAxis::horizontal, 57600, 0, 0, 0},
    {"ramp-final-a", agfx_contract::PassAxis::vertical, 57600, 0, 0, 0},
    {"ramp-final-b", agfx_contract::PassAxis::horizontal, 57600, 0, 0, 0},
    {"ramp-final-b", agfx_contract::PassAxis::vertical, 57600, 0, 0, 0},
}};

// One row and one column lifted out of a pinned capture, so that the default
// suite has real native pixels to answer to on a machine with no GPU and no
// vendor runtime.
//
// A single row is enough because the sampler's row footprint collapses: an
// output row samples at v = (y + 0.5) / height, which lands the vertical
// footprint exactly on texel y with a zero fractional weight, so the second row
// of the footprint contributes nothing. A horizontal pass on one row therefore
// reproduces that row of the full pass, and by the same argument a vertical
// pass on one column reproduces that column. Both claims are re-checked in the
// oracle against every row and column of a full capture, not assumed here.
//
// Source is the ramp figure of `ramp-final-a`: the horizontal row is the one
// whose 160 pixels are all distinct, the vertical column the richest of that
// capture's gaussian.x output.
inline constexpr std::uint32_t fragment_row_width = 160;
inline constexpr std::uint32_t fragment_column_height = 90;
inline constexpr float fragment_row_sample_count = 7.46030283F;
inline constexpr float fragment_row_step = 0.00529072434F;
inline constexpr float fragment_row_sigma = 0.0157881621F;
inline constexpr float fragment_column_step = 0.00938299764F;
inline constexpr float fragment_column_sigma = 0.0280000009F;

inline constexpr std::string_view fragment_row_source_hex =
    "010101ff020202ff040404ff060606ff070707ff090909ff0a0a0aff0c0c0cff0e0e0eff"
    "0f0f0fff111111ff121212ff141414ff161616ff171717ff191919ff1a1a1aff1c1c1cff"
    "1d1d1dff1f1f1fff212121ff222222ff242424ff252525ff272727ff292929ff2a2a2aff"
    "2c2c2cff2d2d2dff2f2f2fff313131ff323232ff343434ff353535ff373737ff393939ff"
    "3a3a3aff3c3c3cff3d3d3dff3f3f3fff414141ff424242ff444444ff454545ff474747ff"
    "494949ff4a4a4aff4c4c4cff4d4d4dff4f4f4fff505050ff525252ff545454ff555555ff"
    "575757ff585858ff5a5a5aff5c5c5cff5d5d5dff5f5f5fff606060ff626262ff646464ff"
    "656565ff676767ff686868ff6a6a6aff6c6c6cff6d6d6dff6f6f6fff707070ff727272ff"
    "747474ff757575ff777777ff787878ff7a7a7aff7c7c7cff7d7d7dff7f7f7fff808080ff"
    "828282ff838383ff858585ff878787ff888888ff8a8a8aff8b8b8bff8d8d8dff8f8f8fff"
    "909090ff929292ff939393ff959595ff979797ff989898ff9a9a9aff9b9b9bff9d9d9dff"
    "9f9f9fffa0a0a0ffa2a2a2ffa3a3a3ffa5a5a5ffa7a7a7ffa8a8a8ffaaaaaaffabababff"
    "adadadffafafafffb0b0b0ffb2b2b2ffb3b3b3ffb5b5b5ffb6b6b6ffb8b8b8ffbababaff"
    "bbbbbbffbdbdbdffbebebeffc0c0c0ffc2c2c2ffc3c3c3ffc5c5c5ffc6c6c6ffc8c8c8ff"
    "cacacaffcbcbcbffcdcdcdffcececeffd0d0d0ffd2d2d2ffd3d3d3ffd5d5d5ffd6d6d6ff"
    "d8d8d8ffdadadaffdbdbdbffddddddffdededeffe0e0e0ffe2e2e2ffe3e3e3ffe5e5e5ff"
    "e6e6e6ffe8e8e8ffe9e9e9ffebebebffedededffeeeeeefff0f0f0fff1f1f1fff3f3f3ff"
    "f5f5f5fff6f6f6fff8f8f8fff9f9f9fffbfbfbfffdfdfdfffefefeff";

inline constexpr std::string_view fragment_row_native_hex =
    "040404ff050505ff060606ff070707ff080808ff0a0a0aff0b0b0bff0d0d0dff0e0e0eff"
    "101010ff111111ff131313ff141414ff161616ff181818ff191919ff1b1b1bff1c1c1cff"
    "1e1e1eff1f1f1fff212121ff222222ff242424ff262626ff272727ff292929ff2a2a2aff"
    "2c2c2cff2e2e2eff2f2f2fff313131ff323232ff343434ff363636ff373737ff393939ff"
    "3a3a3aff3c3c3cff3e3e3eff3f3f3fff414141ff424242ff444444ff464646ff474747ff"
    "494949ff4a4a4aff4c4c4cff4d4d4dff4f4f4fff515151ff525252ff545454ff555555ff"
    "575757ff585858ff5a5a5aff5c5c5cff5d5d5dff5f5f5fff606060ff626262ff646464ff"
    "656565ff676767ff686868ff6a6a6aff6c6c6cff6d6d6dff6f6f6fff707070ff727272ff"
    "747474ff757575ff777777ff787878ff7a7a7aff7c7c7cff7d7d7dff7f7f7fff808080ff"
    "828282ff838383ff858585ff878787ff888888ff8a8a8aff8b8b8bff8d8d8dff8f8f8fff"
    "909090ff929292ff939393ff959595ff979797ff989898ff9a9a9aff9b9b9bff9d9d9dff"
    "9f9f9fffa0a0a0ffa2a2a2ffa3a3a3ffa5a5a5ffa7a7a7ffa8a8a8ffaaaaaaffabababff"
    "adadadffafafafffb0b0b0ffb2b2b2ffb3b3b3ffb5b5b5ffb6b6b6ffb8b8b8ffbababaff"
    "bbbbbbffbdbdbdffbebebeffc0c0c0ffc2c2c2ffc3c3c3ffc5c5c5ffc6c6c6ffc8c8c8ff"
    "cacacaffcbcbcbffcdcdcdffcececeffd0d0d0ffd2d2d2ffd3d3d3ffd5d5d5ffd6d6d6ff"
    "d8d8d8ffdadadaffdbdbdbffddddddffdededeffe0e0e0ffe2e2e2ffe3e3e3ffe5e5e5ff"
    "e6e6e6ffe8e8e8ffe9e9e9ffebebebffedededffeeeeeefff0f0f0fff1f1f1fff3f3f3ff"
    "f5f5f5fff6f6f6fff8f8f8fff9f9f9fffafafafffbfbfbfffbfbfbff";

inline constexpr std::string_view fragment_column_source_hex =
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "0481fbff0484fbff0487fbff0489fbff048cfbff048ffbff0492fbff0495fbff0498fbff"
    "049afbff049dfbff04a0fbff04a3fbff04a6fbff04a9fbff04abfbff04aefbff04b1fbff"
    "04b4fbff04b7fbff04bafbff04bcfbff04bffbff04c2fbff04c5fbff04c8fbff04cbfbff"
    "04cefbff04d1fbff04d3fbff04d6fbff04d9fbff04dcfbff04dffbff04e2fbff04e5fbff"
    "04e7fbff04eafbff04edfbff04f0fbff04f3fbff04f5fbff04f8fbff04fbfbff04fefbff";

inline constexpr std::string_view fragment_column_native_hex =
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff040404ff"
    "040404ff040404ff040404ff040e1bff041a31ff042649ff043565ff044684ff0457a4ff"
    "0468c2ff0473d6ff047de5ff0485f0ff048af6ff048ffaff0492fbff0495fbff0498fbff"
    "049bfbff049dfbff04a0fbff04a3fbff04a6fbff04a9fbff04acfbff04aefbff04b1fbff"
    "04b4fbff04b7fbff04bafbff04bdfbff04bffbff04c2fbff04c5fbff04c8fbff04cbfbff"
    "04cefbff04d1fbff04d4fbff04d6fbff04d9fbff04dcfbff04dffbff04e2fbff04e5fbff"
    "04e8fbff04eafbff04edfbff04f0fbff04f2fbff04f5fbff04f6fbff04f8fbff04f9fbff";

inline std::vector<std::uint8_t> decode_fragment_hex(std::string_view text) {
  std::vector<std::uint8_t> bytes(text.size() / 2);
  for (std::size_t index = 0; index < bytes.size(); ++index) {
    const auto digit = [&](std::size_t offset) -> std::uint32_t {
      const char character = text[index * 2 + offset];
      return static_cast<std::uint32_t>(character <= '9' ? character - '0' : character - 'a' + 10);
    };
    bytes[index] = static_cast<std::uint8_t>((digit(0) << 4) | digit(1));
  }
  return bytes;
}

// The GL fragment stage lowers `c + a * b` to a fused multiply-add and `a / b`
// to a reciprocal followed by a multiply. Both were measured over the same
// fixed-seed operand set; the counts say how many of those operands the two
// unfused standard-library forms reproduce incorrectly.
inline constexpr std::uint32_t pinned_lowering_operands = 4096U;
inline constexpr std::uint32_t pinned_unfused_multiply_add_differences = 296U;
inline constexpr std::uint32_t pinned_fused_multiply_add_differences = 0U;
inline constexpr std::uint32_t pinned_ieee_division_differences = 1141U;
inline constexpr std::uint32_t pinned_reciprocal_multiply_differences = 371U;

// The elementary functions the gamma and weight sites are built from, measured
// over the same 4081-point sweep. Every one of them disagrees with the standard
// library somewhere, and the fragment stage's own pow equals its own
// exp2(y * log2(x)) exactly while the library's composition of the same two
// calls does not. Together these are why the profile is a measurement and not a
// portable formula.
inline constexpr std::uint32_t pinned_elementary_points = 4081U;
inline constexpr std::uint32_t pinned_log2_differences = 1972U;
inline constexpr std::uint32_t pinned_log2_maximum_ulp = 3U;
inline constexpr std::uint32_t pinned_exp2_differences = 1362U;
inline constexpr std::uint32_t pinned_exp2_maximum_ulp = 1U;
inline constexpr std::uint32_t pinned_exp_differences = 2897U;
inline constexpr std::uint32_t pinned_exp_maximum_ulp = 8U;
inline constexpr std::uint32_t pinned_reciprocal_differences = 324U;
inline constexpr std::uint32_t pinned_reciprocal_maximum_ulp = 1U;
inline constexpr std::uint32_t pinned_pow_differs_from_stage_exp2_log2 = 0U;
inline constexpr std::uint32_t pinned_pow_differs_from_library_exp2_log2 = 2336U;

// Constant folding control. The same pow call written with literal operands is
// folded by the shader compiler and lands on the standard library's value,
// while the identical call fed through a texel fetch lands elsewhere. A probe
// without this control would be measuring the compiler, not the fragment stage.
inline constexpr std::uint32_t pinned_folding_controls = 3U;
inline constexpr std::uint32_t pinned_folded_matches_libm = 3U;
inline constexpr std::uint32_t pinned_folded_matches_runtime = 0U;

// The mediump sampler declared on the input texture does not introduce a
// narrower sampling arithmetic: the fragment stage reproduced the already
// closed M4 bilinear profile exactly over this many channel comparisons.
inline constexpr std::uint32_t pinned_sampler_channels = 56368U;
inline constexpr std::uint32_t pinned_sampler_differences = 0U;

}  // namespace agfx_test
