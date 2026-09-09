#pragma once

#include "motion_constraint.hpp"

#include <bit>
#include <cstdint>

namespace lens_contract::motion_fixtures {
struct Random {
  std::uint32_t value;
  std::uint32_t next() { value = value * 1664525U + 1013904223U; return value; }
  float unit() { return static_cast<float>(next() >> 8) / 16777216.0F; }
};
struct Case { MotionConstraint constraint; RigidTransform input; };
inline Case sample(Random& random, bool rotate = true) {
  const float width = static_cast<float>(1U + random.next() % 32768U);
  const float height = static_cast<float>(1U + random.next() % 32768U);
  MotionConstraint constraint{width, height, {width * random.unit(), height * random.unit()},
                              0.01F + random.unit() * 0.99F};
  RigidTransform transform{width * (random.unit() * 8.0F - 4.0F),
                            height * (random.unit() * 8.0F - 4.0F),
                            rotate ? random.unit() * 360.0F - 180.0F : 0.0F,
                            random.unit() * 8.0F - 4.0F};
  return {constraint, transform};
}
inline std::array<std::uint32_t, 4> words(const RigidTransform& transform) {
  return std::bit_cast<std::array<std::uint32_t, 4>>(transform);
}
inline void hash(std::uint64_t& value, const RigidTransform& transform) {
  for (auto word : words(transform)) {
    for (unsigned shift = 0; shift < 32; shift += 8) {
      value ^= (word >> shift) & 255U;
      value *= 1099511628211ULL;
    }
  }
}
}  // namespace lens_contract::motion_fixtures
