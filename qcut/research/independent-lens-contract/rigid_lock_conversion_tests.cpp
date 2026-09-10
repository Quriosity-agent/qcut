#include "rigid_lock_conversion_fixtures.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace lens_contract;
using namespace lens_contract::rigid_lock_fixtures;
std::size_t checks = 0;
void require(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}

// Portable libm may round the four calls differently; the optional pinned
// native oracle requires exact bits for every case, including these.
bool close(float expected, float actual) {
  if (std::isnan(expected) || std::isnan(actual)) {
    return std::isnan(expected) && std::isnan(actual);
  }
  return std::abs(actual - expected) <= 1.0e-5F * std::max(1.0F, std::abs(expected));
}

void goldens() {
  for (std::size_t index = 0; index < pinned_cases.size(); ++index) {
    RigidTransform output{};
    require(run(pinned_cases[index], output), "Pinned native case rejected");
    const RigidTransform expected = golden(index);
    if (index < exact_pinned_cases) {
      require(same(expected, output), "Signed-zero-angle native golden changed");
      continue;
    }
    require(close(expected.translation_x, output.translation_x) &&
                close(expected.translation_y, output.translation_y) &&
                close(expected.degrees, output.degrees) &&
                close(expected.scale, output.scale),
            "Trigonometric native golden changed");
  }
  // The two singular-adjacent families native produces: a NaN angle from a
  // negative scale at a zero angle, with the other three fields still finite.
  RigidTransform output{};
  const LockFrame frame{{960.0F, 540.0F}, 1920.0F, 1080.0F};
  require(rigid_to_lock(frame, {0.0F, 0.0F, 0.0F, -1.0F}, output), "Negative scale rejected");
  require(std::isnan(output.degrees) && std::isfinite(output.translation_x) &&
              std::isfinite(output.translation_y) && output.scale == -1.0F,
          "Negative-scale NaN angle family changed");
  require(!rigid_to_lock(frame, {0.0F, 0.0F, 0.0F, 0.0F}, output) &&
              !lock_to_rigid(frame, {0.0F, 0.0F, 0.0F, -0.0F}, output),
          "Singular scale must be rejected, not inverted");
}

void fingerprints() {
  // Holding the angle at a signed zero keeps cosf, sinf and atan2f exact, so
  // this fingerprint is a bit-exact contract on any conforming libm.
  Random random{0x1d40b3a9U};
  std::uint64_t value = 14695981039346656037ULL;
  std::size_t results = 0;
  for (unsigned index = 0; index < 4096; ++index) {
    auto fixture = sample(random, index % 2 == 0);
    fixture.input.degrees = index % 4 < 2 ? 0.0F : -0.0F;
    RigidTransform output{};
    require(rigid_to_lock(fixture.frame, fixture.input, output), "Zero-angle fixture rejected");
    hash(value, output);
    ++results;
    require(lock_to_rigid(fixture.frame, fixture.input, output), "Zero-angle fixture rejected");
    hash(value, output);
    ++results;
  }
  require(results == 8192 && value == 0x203c0291aed5b4c3ULL,
          "8192 native-observed zero-angle results changed");
}

void structure() {
  const LockFrame frame{{960.0F, 540.0F}, 1920.0F, 1080.0F};
  RigidTransform expected{};
  RigidTransform aliased{0.1F, -0.2F, 45.0F, 0.8F};
  require(rigid_to_lock(frame, aliased, expected) && rigid_to_lock(frame, aliased, aliased) &&
              words(aliased) == words(expected), "Aliased rigid_to_lock changed the result");
  aliased = {0.1F, -0.2F, 45.0F, 0.8F};
  require(lock_to_rigid(frame, aliased, expected) && lock_to_rigid(frame, aliased, aliased) &&
              words(aliased) == words(expected), "Aliased lock_to_rigid changed the result");
  // The pair is not a round trip. Native spells the forward factor 0.01745f
  // and the reverse one float(180/pi); the asymmetry is deliberate and this
  // check fails the moment either constant is "corrected".
  RigidTransform locked{}, returned{};
  require(rigid_to_lock(frame, {0.0F, 0.0F, 45.0F, 1.0F}, locked) &&
              lock_to_rigid(frame, locked, returned),
          "Round-trip fixture rejected");
  require(close(locked.degrees, 42.1861F) && close(returned.degrees, 39.6338615F) &&
              close(returned.scale, 0.99254328F),
          "Degree constant pair or the chain order changed");
  // Arbitrary centers are in the covered domain, not just MergeUtil's w/2, h/2.
  const LockFrame offset{{123.0F, 45.0F}, 1920.0F, 1080.0F};
  RigidTransform shifted{};
  require(rigid_to_lock(offset, {0.0F, 0.0F, 45.0F, 1.0F}, shifted) &&
              words(shifted) != words(locked) && close(shifted.degrees, locked.degrees),
          "Center only shifts translation");
  // Every extreme of the accepted domain still produces a result.
  for (float extent : {1.0F, 8192.0F}) {
    for (float degrees : {-360.0F, 360.0F}) {
      for (float magnitude : {1.0e-4F, 4.0F}) {
        const LockFrame edge{{0.0F, extent}, extent, extent};
        const RigidTransform input{4.0F * extent, -4.0F * extent, degrees, -magnitude};
        RigidTransform result{};
        require(rigid_to_lock(edge, input, result) && lock_to_rigid(edge, input, result),
                "Domain corner rejected");
      }
    }
  }
}

void rejections() {
  const LockFrame valid{{960.0F, 540.0F}, 1920.0F, 1080.0F};
  const RigidTransform input{20.0F, 10.0F, 30.0F, 0.5F};
  const RigidTransform sentinel{9.0F, -0.0F, 7.0F, 6.0F};
  const auto unchanged = words(sentinel);
  RigidTransform output = sentinel;
  const auto refused = [&](const LockFrame& frame, const RigidTransform& transform) {
    return !rigid_to_lock(frame, transform, output) && words(output) == unchanged &&
           !lock_to_rigid(frame, transform, output) && words(output) == unchanged;
  };
  for (float invalid : {std::numeric_limits<float>::infinity(),
                        -std::numeric_limits<float>::infinity(),
                        std::numeric_limits<float>::quiet_NaN()}) {
    for (std::size_t field = 0; field < 4; ++field) {
      auto values = std::bit_cast<std::array<float, 4>>(input);
      values[field] = invalid;
      require(refused(valid, std::bit_cast<RigidTransform>(values)),
              "Invalid transform changed output");
    }
    for (std::size_t field = 0; field < 4; ++field) {
      auto frame = valid;
      const std::array<float*, 4> fields{&frame.center.x, &frame.center.y, &frame.width,
                                         &frame.height};
      *fields[field] = invalid;
      require(refused(frame, input), "Invalid frame changed output");
    }
  }
  for (const LockFrame invalid : {LockFrame{{0.0F, 540.0F}, 0.0F, 1080.0F},
                                  {{960.0F, 540.0F}, 8193.0F, 1080.0F},
                                  {{960.0F, 540.0F}, 1920.0F, 0.5F},
                                  {{-1.0F, 540.0F}, 1920.0F, 1080.0F},
                                  {{1921.0F, 540.0F}, 1920.0F, 1080.0F},
                                  {{960.0F, 1081.0F}, 1920.0F, 1080.0F}}) {
    require(refused(invalid, input), "Out-of-domain frame changed output");
  }
  for (const RigidTransform invalid : {RigidTransform{7681.0F, 0.0F, 0.0F, 1.0F},
                                       {0.0F, -4321.0F, 0.0F, 1.0F},
                                       {0.0F, 0.0F, 361.0F, 1.0F},
                                       {0.0F, 0.0F, -361.0F, 1.0F},
                                       {0.0F, 0.0F, 0.0F, 4.1F},
                                       {0.0F, 0.0F, 0.0F, -4.1F},
                                       {0.0F, 0.0F, 0.0F, 0.0F},
                                       {0.0F, 0.0F, 0.0F, -0.0F},
                                       {0.0F, 0.0F, 0.0F, 9.9e-5F},
                                       {0.0F, 0.0F, 0.0F, -9.9e-5F}}) {
    require(refused(valid, invalid), "Out-of-domain transform changed output");
  }
  const int original = std::fegetround();
  require(std::fesetround(FE_DOWNWARD) == 0, "Cannot select alternate rounding");
  const bool rejected = refused(valid, input);
  const int restored = std::fesetround(original);
  require(rejected && restored == 0, "Rounding mode policy changed");
}
}  // namespace

int main() {
  try {
    goldens();
    fingerprints();
    structure();
    rejections();
    std::cout << checks << " rigid/lock checks passed\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
