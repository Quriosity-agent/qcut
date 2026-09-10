#pragma once

#include "merge_util.hpp"
#include "rigid_lock_conversion_fixtures.hpp"

#include <array>
#include <bit>
#include <cstdint>
#include <span>

namespace lens_contract::merge_fixtures {

using rigid_lock_fixtures::Random;
using rigid_lock_fixtures::same_field;
using Vector4 = std::array<float, merge_vector_length>;

// SettingInfo +0x10 as the real default constructor leaves it. init never
// writes this field, and MergeUtil loads it once and drops it, so the value
// only exists here to keep the fixtures shaped like the native record.
inline constexpr float native_unused_field = 0.8F;
static_assert(std::bit_cast<std::uint32_t>(native_unused_field) == 0x3f4ccccdU);

struct Case {
  MergeSettings settings;
  Vector4 current;
  Vector4 box;
};

// The frame sizes the native oracle configures through the real init entry.
// 17x145 is kept deliberately: at that size the lock translation routinely
// leaves the motion stage's +-4*extent domain, and hiding it would misreport
// the rejection rate as zero everywhere.
inline constexpr std::array<std::array<float, 2>, 7> frame_sizes{
    {{1920.0F, 1080.0F},
     {1280.0F, 720.0F},
     {720.0F, 1280.0F},
     {640.0F, 480.0F},
     {3840.0F, 2160.0F},
     {1.0F, 1.0F},
     {17.0F, 145.0F}}};

// `current` carries a NORMALIZED rigid: its translations are fractions of the
// frame, not pixels. Drawing them at pixel magnitude pushes the lock
// translation past the motion stage's +-4*extent gate for almost every sample,
// which would measure the generator instead of the algorithm.
inline Case sample(Random& random, const std::array<float, 2>& size, bool wide_angle) {
  const float magnitude = 0.25F + random.unit() * 2.75F;
  const float scale = random.next() % 8U == 0U ? -magnitude : magnitude;
  const float degrees =
      wide_angle ? random.unit() * 360.0F - 180.0F : random.unit() * 50.0F - 25.0F;
  const Vector4 current{scale, degrees, random.unit() * 2.0F - 1.0F,
                        random.unit() * 2.0F - 1.0F};
  // No ordering is imposed on the rectangle: only the two midpoints reach the
  // algorithm, so reversed and zero-area boxes are ordinary inputs here.
  const Vector4 box{size[0] * random.unit(), size[1] * random.unit(),
                    size[0] * random.unit(), size[1] * random.unit()};
  return {{size[0], size[1], native_unused_field}, current, box};
}

inline bool same(std::span<const float> expected, std::span<const float> actual) {
  if (expected.size() != actual.size()) return false;
  for (std::size_t index = 0; index < expected.size(); ++index) {
    if (!same_field(expected[index], actual[index])) return false;
  }
  return true;
}

inline Vector4 words(std::span<const float> values) {
  Vector4 copy{};
  for (std::size_t index = 0; index < copy.size() && index < values.size(); ++index) {
    copy[index] = values[index];
  }
  return copy;
}

// NaN payloads must not reach the fingerprint; a quiet NaN folds to one word.
inline void hash(std::uint64_t& value, std::span<const float> values) {
  for (float field : values) {
    const std::uint32_t word =
        field != field ? 0x7fc00000U : std::bit_cast<std::uint32_t>(field);
    for (unsigned shift = 0; shift < 32; shift += 8) {
      value ^= (word >> shift) & 255U;
      value *= 1099511628211ULL;
    }
  }
}

struct PinnedCase {
  MergeSettings settings;
  Vector4 current;
  Vector4 box;
};

// The sixteen cases the default CTest pins and the optional oracle replays
// against the real library. Cases 0, 1 and 15 deliberately share a result:
// only the box midpoints reach the algorithm, so a full-frame box, a centered
// half-frame box and a one-pixel-smaller box with the same midpoints agree,
// and an angle inside the +-1e-5 zero band is indistinguishable from zero.
inline constexpr std::array<PinnedCase, 16> pinned_cases{{
    {{1920.0F, 1080.0F, native_unused_field}, {1.0F, 0.0F, 0.0F, 0.0F},
     {0.0F, 0.0F, 1920.0F, 1080.0F}},
    {{1920.0F, 1080.0F, native_unused_field}, {1.0F, -0.0F, 0.0F, 0.0F},
     {480.0F, 270.0F, 1440.0F, 810.0F}},
    {{1920.0F, 1080.0F, native_unused_field}, {2.0F, 0.0F, 0.25F, -0.5F},
     {0.0F, 0.0F, 1920.0F, 1080.0F}},
    {{1280.0F, 720.0F, native_unused_field}, {0.5F, 0.0F, 0.0F, 0.0F},
     {0.0F, 0.0F, 1280.0F, 720.0F}},
    {{1.0F, 1.0F, native_unused_field}, {1.0F, 0.0F, 0.0F, 0.0F}, {0.0F, 0.0F, 1.0F, 1.0F}},
    {{640.0F, 480.0F, native_unused_field}, {1.0F, -0.0F, 0.5F, 0.5F},
     {0.0F, 0.0F, 640.0F, 480.0F}},
    {{3840.0F, 2160.0F, native_unused_field}, {4.0F, 0.0F, 0.0F, 0.0F},
     {960.0F, 540.0F, 2880.0F, 1620.0F}},
    {{17.0F, 145.0F, native_unused_field}, {1.0F, 0.0F, 0.0F, 0.0F}, {0.0F, 0.0F, 17.0F, 145.0F}},
    {{1920.0F, 1080.0F, native_unused_field}, {1.0F, 30.0F, 0.1F, -0.2F},
     {100.0F, 80.0F, 1000.0F, 700.0F}},
    {{1920.0F, 1080.0F, native_unused_field}, {0.6F, -45.0F, -0.3F, 0.4F},
     {12.0F, 34.0F, 1900.0F, 1000.0F}},
    {{1280.0F, 720.0F, native_unused_field}, {2.5F, 12.5F, 0.75F, -0.75F},
     {640.0F, 360.0F, 1279.0F, 719.0F}},
    {{720.0F, 1280.0F, native_unused_field}, {1.0F, 180.0F, 0.0F, 0.0F},
     {0.0F, 0.0F, 720.0F, 1280.0F}},
    {{640.0F, 480.0F, native_unused_field}, {-1.0F, 25.0F, 0.2F, 0.2F},
     {50.0F, 50.0F, 600.0F, 400.0F}},
    {{3840.0F, 2160.0F, native_unused_field}, {0.34F, -7.5F, 0.9F, -0.9F},
     {1920.0F, 1080.0F, 1920.0F, 1080.0F}},
    {{17.0F, 145.0F, native_unused_field}, {1.5F, 3.0F, 0.05F, -0.05F},
     {1.0F, 2.0F, 16.0F, 143.0F}},
    {{1920.0F, 1080.0F, native_unused_field}, {1.0F, 1.0e-5F, 0.0F, 0.0F},
     {0.0F, 0.0F, 1919.0F, 1079.0F}}}};

// Native results for the cases above, as raw binary32 words. They are asserted
// bit for bit only on the platform the oracle actually ran on; elsewhere the
// default test checks the tolerance, the sign of every field and the NaN
// class, because the decomposition calls powf and atan2f on swept matrix
// elements and those round differently across libm implementations.
inline constexpr std::array<std::array<std::uint32_t, merge_vector_length>, 16> pinned_goldens{
    {{0x3f800000U, 0x80000000U, 0x29c64000U, 0x29d3a000U},
     {0x3f800000U, 0x80000000U, 0x29c64000U, 0x29d3a000U},
     {0x40000000U, 0x80000000U, 0x3e800000U, 0xbf000000U},
     {0x3f800000U, 0x80000000U, 0xaa580000U, 0x274c0000U},
     {0x3f800000U, 0x00000000U, 0x00000000U, 0x00000000U},
     {0x3f800000U, 0x80000000U, 0x29900000U, 0x26a80000U},
     {0x40800000U, 0x00000000U, 0xac094800U, 0xaff1d550U},
     {0x3f800000U, 0x80000000U, 0x27100000U, 0x26fe0000U},
     {0x3f800000U, 0x00000000U, 0x2ea071b0U, 0xafc214bcU},
     {0x3f800000U, 0x80000000U, 0xad8e9140U, 0x2df74660U},
     {0x401ff232U, 0x4143afafU, 0xbfb2a166U, 0xbf149ff7U},
     {0xc0a00006U, 0x4333e9ecU, 0xbbd1d8d8U, 0xb69b7f40U},
     {0xc0a24b1bU, 0xc319926aU, 0xbc3944dbU, 0x3f3c7393U},
     {0x3f800000U, 0x80000000U, 0xaac5e000U, 0xb3f29ffbU},
     {0x3fbdda55U, 0x402144bcU, 0x3d1fe1e8U, 0xbd3a44fdU},
     {0x3f800000U, 0x80000000U, 0x29c64000U, 0x29d3a000U}}};

inline Vector4 golden(std::size_t index) {
  return std::bit_cast<Vector4>(pinned_goldens[index]);
}

}  // namespace lens_contract::merge_fixtures
