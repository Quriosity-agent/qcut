#include "motion_constraint_fixtures.hpp"

#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace lens_contract;
std::size_t checks = 0;
void require(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}

void goldens() {
  RigidTransform output{};
  const MotionConstraint square{100.0F, 100.0F, {50.0F, 50.0F}, 0.2F};
  require(constrain_motion(square, {100.0F, -100.0F, 0.0F, 0.5F}, output), "Translation fixture rejected");
  require(output.translation_x == 24.5F && output.translation_y == -25.0F && output.scale == 0.5F,
          "Inclusive last pixel or crop-before-translation changed");
  require(constrain_motion(square, {0.0F, 0.0F, 0.0F, -4.0F}, output) && output.scale == 0.2F,
          "Minimum scale clamp changed");
  require(constrain_motion(square, {0.0F, 0.0F, 0.0F, 4.0F}, output) && output.scale == 1.0F,
          "Maximum scale clamp changed");
  require(constrain_motion({1.0F, 4.0F, {0.5F, 2.0F}, 0.2F}, {4.0F, 8.0F, 45.0F, 0.0F}, output),
          "Degenerate area fixture rejected");
  require(output.translation_x == 4.0F && output.translation_y == 8.0F && output.degrees == 45.0F && output.scale == 0.2F,
          "Degenerate polygon must skip clipping but still clamp scale");
  const float epsilon = 1.0e-5F;
  for (float value : {-epsilon, -0.0F, 0.0F, epsilon}) {
    const RigidTransform input{value, value, value, 1.0F};
    require(constrain_motion(square, input, output) && motion_fixtures::words(input) == motion_fixtures::words(output),
            "Inclusive epsilon bypass or signed zero changed");
  }
  require(constrain_motion(square, {std::nextafter(epsilon, 1.0F), 0.0F, 0.0F, 1.0F}, output) && output.translation_x == 0.0F,
          "Next float outside epsilon did not clip");
  require(constrain_motion(square, {100.0F, -100.0F, 45.0F, 0.8F}, output), "Rotation fixture rejected");
  // Portable libm may differ; the optional pinned native oracle requires exact bits.
  require(std::abs(output.degrees - 16.61317444F) < 0.0001F &&
              std::abs(output.translation_x - -0.00001525878906F) < 0.0001F &&
              std::abs(output.translation_y - -0.2333755493F) < 0.0001F,
          "Rotation search, center or translation order changed");
  require(constrain_motion({257.0F, 145.0F, {80.0F, 50.0F}, 0.2F},
                           {500.0F, -200.0F, 23.0F, 0.7F}, output), "Off-axis fixture rejected");
  require(std::abs(output.degrees - 14.19368362F) < 0.0001F &&
              std::abs(output.translation_x - 47.97898865F) < 0.0001F &&
              std::abs(output.translation_y - -2.337230682F) < 0.0001F,
          "Off-axis center changed");
  RigidTransform aliased{100.0F, -100.0F, 45.0F, 0.8F};
  RigidTransform expected{};
  require(constrain_motion(square, aliased, expected) && constrain_motion(square, aliased, aliased) &&
              motion_fixtures::words(aliased) == motion_fixtures::words(expected), "Aliased input changed result");
}

void fingerprints() {
  motion_fixtures::Random random{0x61a023f5U};
  std::uint64_t hash = 14695981039346656037ULL;
  for (unsigned index = 0; index < 4096; ++index) {
    const auto fixture = motion_fixtures::sample(random, false);
    RigidTransform output{};
    require(constrain_motion(fixture.constraint, fixture.input, output), "Portable fixture rejected");
    motion_fixtures::hash(hash, output);
  }
  require(hash == 0x45f096155aba0950ULL, "4096 native-observed nontrigonometric fixtures changed");
}

void rejections() {
  const MotionConstraint valid{100.0F, 100.0F, {50.0F, 50.0F}, 0.2F};
  const RigidTransform input{20.0F, 10.0F, 30.0F, 0.5F};
  const RigidTransform sentinel{9.0F, -0.0F, 7.0F, 6.0F};
  const auto unchanged = motion_fixtures::words(sentinel);
  RigidTransform output = sentinel;
  for (float invalid : {std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity(),
                         std::numeric_limits<float>::quiet_NaN()}) {
    for (std::size_t field = 0; field < 4; ++field) {
      auto values = std::bit_cast<std::array<float, 4>>(input);
      values[field] = invalid;
      require(!constrain_motion(valid, std::bit_cast<RigidTransform>(values), output) &&
                  motion_fixtures::words(output) == unchanged, "Invalid transform changed output");
    }
    for (std::size_t field = 0; field < 5; ++field) {
      auto config = valid;
      const std::array<float*, 5> fields{&config.width, &config.height, &config.center.x, &config.center.y, &config.minimum_scale};
      *fields[field] = invalid;
      require(!constrain_motion(config, input, output) && motion_fixtures::words(output) == unchanged,
              "Invalid constraint changed output");
    }
  }
  for (const MotionConstraint invalid : {MotionConstraint{0.0F, 100.0F, {0.0F, 50.0F}, 0.2F},
       {32769.0F, 100.0F, {50.0F, 50.0F}, 0.2F}, {100.0F, 100.0F, {-1.0F, 50.0F}, 0.2F},
       {100.0F, 100.0F, {50.0F, 101.0F}, 0.2F}, {100.0F, 100.0F, {50.0F, 50.0F}, 0.0F},
       {100.0F, 100.0F, {50.0F, 50.0F}, 1.1F}}) {
    require(!constrain_motion(invalid, input, output) && motion_fixtures::words(output) == unchanged,
            "Out-of-domain constraint changed output");
  }
  for (const RigidTransform invalid : {RigidTransform{401.0F, 0.0F, 0.0F, 1.0F},
        {0.0F, -401.0F, 0.0F, 1.0F}, {0.0F, 0.0F, 181.0F, 1.0F}, {0.0F, 0.0F, 0.0F, -4.1F}}) {
    require(!constrain_motion(valid, invalid, output) && motion_fixtures::words(output) == unchanged,
            "Out-of-domain motion changed output");
  }
  const int original = std::fegetround();
  require(std::fesetround(FE_DOWNWARD) == 0, "Cannot select alternate rounding");
  const bool rejected = !constrain_motion(valid, input, output);
  const int restored = std::fesetround(original);
  require(rejected && restored == 0 && motion_fixtures::words(output) == unchanged,
          "Rounding mode policy changed");
}
}  // namespace
int main() {
  try { goldens(); fingerprints(); rejections(); std::cout << checks << " motion checks passed\n"; return 0; }
  catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
