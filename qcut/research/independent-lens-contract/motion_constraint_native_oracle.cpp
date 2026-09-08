#include "motion_constraint_fixtures.hpp"
#include "motion_constraint_native_support.hpp"
#include "crop_selection_native_support.hpp"

#include <cmath>
#include <cstdio>
#include <iostream>
#include <unistd.h>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;
struct Totals {
  std::size_t calls = 0;
  std::size_t changed_rotation = 0;
  std::size_t changed_translation = 0;
  std::size_t changed_scale = 0;
  std::uint64_t hash = 14695981039346656037ULL;
  std::uint64_t portable_hash = 14695981039346656037ULL;
};

void compare(Totals& totals, NativeMotionConstraint& native, const MotionConstraint& constraint,
             const RigidTransform& input, bool portable = false) {
  RigidTransform expected{};
  require(constrain_motion(constraint, input, expected), "Independent motion rejected fixture");
  const auto actual = native.run(input);
  const auto before = motion_fixtures::words(input);
  const auto values = motion_fixtures::words(actual);
  require(values == motion_fixtures::words(expected), "Motion differs at call " + std::to_string(totals.calls));
  totals.changed_rotation += values[2] != before[2];
  totals.changed_scale += values[3] != before[3];
  totals.changed_translation += values[0] != before[0] || values[1] != before[1];
  ++totals.calls;
  motion_fixtures::hash(totals.hash, actual);
  if (portable) motion_fixtures::hash(totals.portable_hash, actual);
}

void random_matrix(const Oracle& oracle, Totals& totals) {
  motion_fixtures::Random random{0x38c647d1U};
  for (unsigned index = 0; index < 65536; ++index) {
    const auto fixture = motion_fixtures::sample(random);
    NativeMotionConstraint native(oracle, fixture.constraint);
    compare(totals, native, fixture.constraint, fixture.input);
    // The same native object must not accumulate state between Run calls.
    auto alternate = fixture.input;
    alternate.translation_x = -alternate.translation_x;
    alternate.degrees = -alternate.degrees;
    compare(totals, native, fixture.constraint, alternate);
    compare(totals, native, fixture.constraint, fixture.input);
  }
  motion_fixtures::Random portable{0x61a023f5U};
  for (unsigned index = 0; index < 4096; ++index) {
    const auto fixture = motion_fixtures::sample(portable, false);
    NativeMotionConstraint native(oracle, fixture.constraint);
    compare(totals, native, fixture.constraint, fixture.input, true);
  }
}

void boundaries(const Oracle& oracle, Totals& totals) {
  const float epsilon = 1.0e-5F;
  for (float width : {1.0F, 2.0F, 3.0F, 17.0F, 257.0F, 32768.0F}) {
    for (float height : {1.0F, 2.0F, 145.0F, 32768.0F}) {
      for (float anchor : {-0.0F, 0.5F, 1.0F}) {
        const MotionConstraint constraint{width, height, {width * anchor, height * anchor}, 0.2F};
        NativeMotionConstraint native(oracle, constraint);
        for (float angle : {-180.0F, -90.0F, -45.0F, -epsilon, -0.0F, 0.0F, epsilon,
                             std::nextafter(epsilon, 0.0F), std::nextafter(epsilon, 1.0F),
                             45.0F, 90.0F, 180.0F}) {
          for (float scale : {-4.0F, -0.0F, 0.0F, 0.2F, std::nextafter(0.2F, 0.0F),
                               std::nextafter(0.2F, 1.0F), 0.5F, 1.0F, 4.0F}) {
            for (float fraction : {-4.0F, -epsilon, -0.0F, 0.0F, epsilon, 4.0F}) {
              compare(totals, native, constraint, {width * fraction, height * fraction, angle, scale});
            }
          }
        }
      }
    }
  }
  // Width/height minus one, then scale, crosses BorderCutDown's area threshold.
  for (float scale : {std::nextafter(0.5F, 0.0F), 0.5F, std::nextafter(0.5F, 1.0F)}) {
    const MotionConstraint constraint{3.0F, 3.0F, {1.5F, 1.5F}, 0.01F};
    NativeMotionConstraint native(oracle, constraint);
    compare(totals, native, constraint, {3.0F, -3.0F, 45.0F, scale});
  }
}

void selected_centers(const Oracle& oracle, Totals& totals) {
  for (unsigned sequence = 0; sequence < 32; ++sequence) {
    const CenterFocusConfiguration configuration{0.5F, 0.5F, 0.8F, 257, 145};
    NativeCenterFocus native_focus(oracle);
    native_focus.initialize(configuration);
    CenterFocus own_focus;
    require(own_focus.initialize(configuration), "Own focus init rejected");
    motion_fixtures::Random random{sequence + 0x674213U};
    for (unsigned frame = 0; frame < 64; ++frame) {
      const float x = random.unit() * 180.0F;
      const float y = random.unit() * 80.0F;
      const DetectionBounds box{x, y, x + 64.0F, y + 32.0F};
      const std::span<const float> selected = frame % 7 == 0 ? std::span<const float>{} : std::span<const float>{box};
      require(own_focus.process(selected), "Own focus process rejected");
      const auto observed = native_focus.process(selected);
      require(std::memcmp(observed.data(), own_focus.state().output.data(), sizeof(observed)) == 0,
              "Focus output changed before constraint");
      const Point center{(observed[2] + observed[0]) / 2.0F, (observed[3] + observed[1]) / 2.0F};
      const MotionConstraint constraint{257.0F, 145.0F, center, 0.2F};
      NativeMotionConstraint native(oracle, constraint);
      // These are already locked pixel-space values, not normalized templates.
      const RigidTransform input{center.x - 257.0F / 2.0F, center.y - 145.0F / 2.0F,
                                  random.unit() * 90.0F - 45.0F, 0.8F};
      compare(totals, native, constraint, input);
    }
  }
}
}  // namespace
int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-motion-native-oracle /absolute/liblens.dylib");
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect vendor logs");
    const Oracle oracle(argv[1]);
    Totals totals;
    random_matrix(oracle, totals);
    boundaries(oracle, totals);
    selected_centers(oracle, totals);
    require(totals.changed_rotation && totals.changed_scale && totals.changed_translation,
            "Fixture matrix did not exercise all constraints");
    std::fflush(stdout);
    require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
    close(saved_stdout);
    std::cout << "{\"calls\":" << totals.calls << ",\"float32_comparisons\":" << totals.calls * 4
        << ",\"mismatches\":0,\"changed_rotation\":" << totals.changed_rotation
        << ",\"changed_translation\":" << totals.changed_translation
        << ",\"changed_scale\":" << totals.changed_scale
        << ",\"native_focus_frames\":2048,\"native_focus_values\":8192,\"fingerprint\":\""
        << std::hex << totals.hash << "\",\"portable_fingerprint\":\"" << totals.portable_hash << "\"}\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
