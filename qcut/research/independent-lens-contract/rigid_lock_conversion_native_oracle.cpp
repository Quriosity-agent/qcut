#include "rigid_lock_conversion_fixtures.hpp"
#include "rigid_lock_conversion_native_support.hpp"

#include <cmath>
#include <cstdio>
#include <iostream>
#include <unistd.h>
#include <vector>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;

struct Totals {
  std::size_t calls = 0;
  std::size_t comparisons = 0;
  std::size_t nan_results = 0;
  std::size_t nan_fields = 0;
  std::size_t policy_rejections = 0;
  std::size_t relay_out_of_domain = 0;
  std::uint64_t hash = 14695981039346656037ULL;
  std::uint64_t boundary_hash = 14695981039346656037ULL;
};

bool finite_transform(const RigidTransform& transform) {
  return std::isfinite(transform.translation_x) && std::isfinite(transform.translation_y) &&
         std::isfinite(transform.degrees) && std::isfinite(transform.scale);
}

void compare(Totals& totals, NativeRigidLock& native, bool to_lock, const LockFrame& frame,
             const RigidTransform& input, std::uint64_t* extra = nullptr) {
  RigidTransform expected{};
  const bool accepted = to_lock ? rigid_to_lock(frame, input, expected)
                                : lock_to_rigid(frame, input, expected);
  const auto observed = native.convert(to_lock, frame, input);
  if (!accepted) {
    // The independent entry only refuses inside the declared policy domain, and
    // native must have produced a non-finite field wherever it does.
    require(!finite_transform(observed), "Independent rejection hid a finite native result");
    ++totals.policy_rejections;
    return;
  }
  require(rigid_lock_fixtures::same(expected, observed),
          "Conversion differs at call " + std::to_string(totals.calls));
  const auto fields = std::bit_cast<std::array<float, 4>>(observed);
  std::size_t nans = 0;
  for (float field : fields) nans += std::isnan(field) ? 1U : 0U;
  totals.nan_fields += nans;
  totals.nan_results += nans != 0 ? 1U : 0U;
  totals.comparisons += fields.size();
  ++totals.calls;
  rigid_lock_fixtures::hash(totals.hash, observed);
  if (extra) rigid_lock_fixtures::hash(*extra, observed);
}

// Re-derives the goldens the default CTest pins, straight from the library.
void pinned(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  for (std::size_t index = 0; index < rigid_lock_fixtures::pinned_cases.size(); ++index) {
    const auto& fixture = rigid_lock_fixtures::pinned_cases[index];
    compare(totals, native, fixture.to_lock, fixture.frame, fixture.input);
    const auto observed = native.convert(fixture.to_lock, fixture.frame, fixture.input);
    require(rigid_lock_fixtures::same(rigid_lock_fixtures::golden(index), observed),
            "Pinned golden " + std::to_string(index) + " is not the native result");
  }
}

// The exact fixtures the default CTest uses to state that the two directions
// do not round trip, replayed against the library so the claim is native.
void round_trip(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  const LockFrame frame{{960.0F, 540.0F}, 1920.0F, 1080.0F};
  const RigidTransform input{0.0F, 0.0F, 45.0F, 1.0F};
  compare(totals, native, true, frame, input);
  RigidTransform locked{};
  require(rigid_to_lock(frame, input, locked), "Round-trip fixture rejected");
  compare(totals, native, false, frame, locked);
  const LockFrame offset{{123.0F, 45.0F}, 1920.0F, 1080.0F};
  compare(totals, native, true, offset, input);
}

void random_matrix(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  rigid_lock_fixtures::Random random{0x5f3a91c7U};
  for (unsigned index = 0; index < 300000; ++index) {
    const auto centered = rigid_lock_fixtures::sample(random, true);
    compare(totals, native, true, centered.frame, centered.input);
    compare(totals, native, false, centered.frame, centered.input);
    // The pair is not a round trip; both directions are checked independently.
    const auto wide = rigid_lock_fixtures::sample(random, false);
    compare(totals, native, true, wide.frame, wide.input);
    compare(totals, native, false, wide.frame, wide.input);
  }
}

void boundaries(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  const float epsilon = 1.0e-5F;
  for (float width : {1.0F, 2.0F, 3.0F, 17.0F, 1920.0F, 8192.0F}) {
    for (float height : {1.0F, 2.0F, 145.0F, 8192.0F}) {
      for (float anchor : {0.0F, 0.5F, 1.0F}) {
        const LockFrame frame{{width * anchor, height * anchor}, width, height};
        for (float angle : {-360.0F, -270.0F, -180.0F, -90.0F, -45.0F, -epsilon, -0.0F, 0.0F,
                             epsilon, 1.0e-4F, 1.0e-6F, 45.0F, 90.0F, 180.0F, 270.0F, 360.0F}) {
          for (float scale : {-4.0F, -1.0F, -1.0e-4F, 1.0e-4F, 0.2F, 1.0F, 4.0F}) {
            for (float fraction : {-4.0F, -epsilon, -0.0F, 0.0F, epsilon, 4.0F}) {
              const RigidTransform input{width * fraction, height * fraction, angle, scale};
              compare(totals, native, true, frame, input, &totals.boundary_hash);
              compare(totals, native, false, frame, input, &totals.boundary_hash);
            }
          }
        }
      }
    }
  }
}

// The singular family the independent entry refuses. Native has no guard, so
// this only records what it does; no payload is claimed.
void singular_family(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  for (float scale : {0.0F, -0.0F}) {
    for (float width : {1.0F, 320.0F, 8192.0F}) {
      const LockFrame frame{{width / 2.0F, 90.0F}, width, 180.0F};
      for (float angle : {-45.0F, 0.0F, 45.0F}) {
        compare(totals, native, true, frame, {10.0F, -20.0F, angle, scale});
        compare(totals, native, false, frame, {10.0F, -20.0F, angle, scale});
      }
    }
  }
}

// MergeUtil's own call shape: SettingInfo width/height and the derived center,
// with the template vector ordered {scale, degrees, tx, ty}.
void merge_util_shape(const Oracle& oracle, Totals& totals) {
  NativeRigidLock native(oracle);
  rigid_lock_fixtures::Random random{0x2b7d4e11U};
  constexpr std::array<std::array<float, 2>, 6> sizes{
      {{1920.0F, 1080.0F}, {1280.0F, 720.0F}, {720.0F, 1280.0F}, {640.0F, 480.0F},
       {3840.0F, 2160.0F}, {1080.0F, 1080.0F}}};
  for (const auto& size : sizes) {
    const LockFrame frame{{size[0] / 2.0F, size[1] / 2.0F}, size[0], size[1]};
    for (unsigned index = 0; index < 2048; ++index) {
      const RigidTransform vector{random.unit() * 2.0F - 1.0F, random.unit() * 2.0F - 1.0F,
                                  random.unit() * 90.0F - 45.0F, 0.2F + random.unit() * 1.8F};
      compare(totals, native, true, frame, vector, &totals.boundary_hash);
      RigidTransform locked{};
      RigidTransform relayed{};
      require(rigid_to_lock(frame, vector, locked), "MergeUtil-shaped fixture rejected");
      // Rigid2Lock's own output routinely leaves Lock2Rigid's accepted domain,
      // which is one more reason the pair cannot be presented as a round trip.
      if (!lock_to_rigid(frame, locked, relayed)) { ++totals.relay_out_of_domain; continue; }
      compare(totals, native, false, frame, locked, &totals.boundary_hash);
      // A separately drawn pixel-space input for the reverse direction.
      const RigidTransform pixels{size[0] * (random.unit() - 0.5F),
                                  size[1] * (random.unit() - 0.5F),
                                  random.unit() * 90.0F - 45.0F, 0.2F + random.unit() * 1.8F};
      compare(totals, native, false, frame, pixels, &totals.boundary_hash);
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-rigid-lock-native-oracle /absolute/liblens.dylib");
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0,
            "Cannot redirect vendor logs");
    const Oracle oracle(argv[1]);
    Totals totals;
    pinned(oracle, totals);
    round_trip(oracle, totals);
    random_matrix(oracle, totals);
    boundaries(oracle, totals);
    singular_family(oracle, totals);
    merge_util_shape(oracle, totals);
    require(totals.nan_results != 0, "Fixture matrix never reached the NaN degrees family");
    require(totals.policy_rejections != 0, "Fixture matrix never reached the singular family");
    std::fflush(stdout);
    require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
    close(saved_stdout);
    std::cout << "{\"calls\":" << totals.calls
        << ",\"float32_comparisons\":" << totals.comparisons
        << ",\"mismatches\":0,\"nan_class_mismatches\":0"
        << ",\"nan_results\":" << totals.nan_results
        << ",\"nan_fields\":" << totals.nan_fields
        << ",\"policy_rejections\":" << totals.policy_rejections
        << ",\"relay_out_of_domain\":" << totals.relay_out_of_domain
        << ",\"fingerprint\":\"" << std::hex << totals.hash
        << "\",\"boundary_fingerprint\":\"" << totals.boundary_hash << "\"}\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
