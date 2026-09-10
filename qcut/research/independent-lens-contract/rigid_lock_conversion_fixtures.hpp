#pragma once

#include "rigid_lock_conversion.hpp"

#include <array>
#include <bit>
#include <cstdint>

namespace lens_contract::rigid_lock_fixtures {

struct Random {
  std::uint32_t value;
  std::uint32_t next() { value = value * 1664525U + 1013904223U; return value; }
  float unit() { return static_cast<float>(next() >> 8) / 16777216.0F; }
  // Keeps the sign but never lands inside the rejected singular neighbourhood.
  float scale() {
    const float magnitude = 0.01F + unit() * 3.99F;
    return next() % 2U == 0U ? magnitude : -magnitude;
  }
};

struct Case {
  LockFrame frame;
  RigidTransform input;
};

// `centered` reproduces the (width/2, height/2) center MergeUtil passes; the
// wide form proves arbitrary centers are covered too.
inline Case sample(Random& random, bool centered) {
  const float width = static_cast<float>(1U + random.next() % 8192U);
  const float height = static_cast<float>(1U + random.next() % 8192U);
  const Point center = centered ? Point{width / 2.0F, height / 2.0F}
                                : Point{width * random.unit(), height * random.unit()};
  return {{center, width, height},
          {width * (random.unit() * 8.0F - 4.0F), height * (random.unit() * 8.0F - 4.0F),
           random.unit() * 720.0F - 360.0F, random.scale()}};
}

struct PinnedCase {
  LockFrame frame;
  RigidTransform input;
  bool to_lock;
};

// The first eight cases hold degrees at a signed zero, where cosf, sinf and
// atan2f are exact on any conforming libm and sqrtf(fl(x*x)) is exactly |x|;
// those goldens are pinned bit for bit. The rest depend on libm rounding and
// are pinned with a tolerance. Every case is also replayed against the real
// library by the optional native oracle, so the goldens are native results.
inline constexpr std::array<PinnedCase, 16> pinned_cases{{
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.25F, -0.5F, 0.0F, 0.5F}, true},
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.25F, -0.5F, 0.0F, 0.5F}, false},
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.0F, 0.0F, 0.0F, -1.0F}, true},
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.0F, 0.0F, 0.0F, -1.0F}, false},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {12.0F, -7.0F, -0.0F, 0.7F}, true},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {12.0F, -7.0F, -0.0F, 0.7F}, false},
    {{{0.5F, 0.5F}, 1.0F, 1.0F}, {0.0F, 0.0F, 0.0F, 2.0F}, true},
    {{{0.5F, 0.5F}, 1.0F, 1.0F}, {0.0F, 0.0F, 0.0F, 2.0F}, false},
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.1F, -0.2F, 45.0F, 0.8F}, true},
    {{{960.0F, 540.0F}, 1920.0F, 1080.0F}, {0.1F, -0.2F, 45.0F, 0.8F}, false},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {12.0F, -7.0F, 23.0F, 0.7F}, true},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {12.0F, -7.0F, 23.0F, 0.7F}, false},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {-3.0F, 4.0F, -180.0F, 1.5F}, true},
    {{{80.0F, 50.0F}, 257.0F, 145.0F}, {-3.0F, 4.0F, -180.0F, 1.5F}, false},
    {{{0.5F, 0.5F}, 1.0F, 1.0F}, {0.0F, 0.0F, 90.0F, 2.0F}, true},
    {{{0.5F, 0.5F}, 1.0F, 1.0F}, {0.0F, 0.0F, 90.0F, 2.0F}, false}}};

inline constexpr std::size_t exact_pinned_cases = 8;

// Native results for the cases above, as raw binary32 words. NaN words are the
// observed pattern; only the classification is ever asserted.
inline constexpr std::array<std::array<std::uint32_t, 4>, 16> pinned_goldens{
    {{0xc3f00000U, 0x44070000U, 0x00000000U, 0x40000000U},
     {0xba088889U, 0x3af2b9d7U, 0x80000000U, 0x40000000U},
     {0x00000000U, 0x00000000U, 0xffc00000U, 0xbf800000U},
     {0xaa2b2000U, 0xaeb78230U, 0x7fc00000U, 0xbf800000U},
     {0xc50afa4aU, 0x4432d6dcU, 0x80000000U, 0x3fb6db6eU},
     {0x3ce83c5aU, 0x3e8ab81fU, 0x00000000U, 0x3fb6db6eU},
     {0x00000000U, 0x00000000U, 0x00000000U, 0x3f000000U},
     {0x00000000U, 0x00000000U, 0x00000000U, 0x3f000000U},
     {0x43a2b554U, 0x423f00f0U, 0x4228be91U, 0x3fb448ccU},
     {0x38c11278U, 0x3a00b9d8U, 0x4228be91U, 0x3fb448ccU},
     {0xc51b91d8U, 0x431f7dbaU, 0x41b27218U, 0x3fbfdb49U},
     {0x3dfe6991U, 0xbd664b4bU, 0x41b27217U, 0x3fbfdb49U},
     {0xc33068d0U, 0x4366c214U, 0xc333f5d7U, 0xbf2aaaacU},
     {0xbf25095fU, 0xbef5da05U, 0xc333f5d7U, 0xbf2aaaacU},
     {0x00000000U, 0x00000000U, 0x42b3f74eU, 0x3f000000U},
     {0xa5000000U, 0x00000000U, 0x42b3f74eU, 0x3f000000U}}};

inline RigidTransform golden(std::size_t index) {
  return std::bit_cast<RigidTransform>(pinned_goldens[index]);
}

inline bool run(const PinnedCase& fixture, RigidTransform& output) {
  return fixture.to_lock ? rigid_to_lock(fixture.frame, fixture.input, output)
                         : lock_to_rigid(fixture.frame, fixture.input, output);
}

inline std::array<std::uint32_t, 4> words(const RigidTransform& transform) {
  return std::bit_cast<std::array<std::uint32_t, 4>>(transform);
}

// Non-NaN fields must agree bit for bit, so signed zeros and infinities stay
// distinguishable. NaN payloads are never claimed, only the classification.
inline bool same_field(float expected, float actual) {
  if (expected != expected || actual != actual) {
    return expected != expected && actual != actual;
  }
  return std::bit_cast<std::uint32_t>(expected) == std::bit_cast<std::uint32_t>(actual);
}

inline bool same(const RigidTransform& expected, const RigidTransform& actual) {
  return same_field(expected.translation_x, actual.translation_x) &&
         same_field(expected.translation_y, actual.translation_y) &&
         same_field(expected.degrees, actual.degrees) &&
         same_field(expected.scale, actual.scale);
}

// NaN payloads must not reach the fingerprint; a quiet NaN folds to one word.
inline void hash(std::uint64_t& value, const RigidTransform& transform) {
  const auto fields = std::bit_cast<std::array<float, 4>>(transform);
  for (std::size_t index = 0; index < fields.size(); ++index) {
    const std::uint32_t word = fields[index] != fields[index]
                                   ? 0x7fc00000U
                                   : std::bit_cast<std::uint32_t>(fields[index]);
    for (unsigned shift = 0; shift < 32; shift += 8) {
      value ^= (word >> shift) & 255U;
      value *= 1099511628211ULL;
    }
  }
}

}  // namespace lens_contract::rigid_lock_fixtures
