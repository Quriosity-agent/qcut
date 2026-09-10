#include "merge_util_fixtures.hpp"
#include "merge_util_native_support.hpp"
#include "motion_constraint.hpp"
#include "rigid_lock_conversion.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <string>
#include <unistd.h>
#include <vector>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;
using merge_fixtures::Case;
using merge_fixtures::Vector4;

constexpr std::size_t stage_count = 7;

// A reporting aid, not a gate. constrain_motion returns one bool, so the
// oracle re-walks the same bounds in the same order to name the first one that
// refused. Nothing here decides whether a call is compared.
enum class MotionReason { unknown, center, scale, degrees, translation };
constexpr std::size_t motion_reason_count = 5;

struct Totals {
  std::size_t calls = 0;
  std::size_t compared = 0;
  std::size_t comparisons = 0;
  std::size_t nan_results = 0;
  std::size_t nan_fields = 0;
  std::size_t rejected_with_finite_native = 0;
  std::array<std::size_t, stage_count> rejections{};
  std::array<std::size_t, motion_reason_count> motion_reasons{};
  std::uint64_t hash = 14695981039346656037ULL;
  std::uint64_t boundary_hash = 14695981039346656037ULL;
};

bool finite_values(std::span<const float> values) {
  for (float value : values) {
    if (!std::isfinite(value)) return false;
  }
  return true;
}

bool inside(float value, float low, float high) {
  return std::isfinite(value) && value >= low && value <= high;
}

// Recomputes exactly what merge_util hands the motion stage, using the same
// public entries, so the attribution below names a real gate.
MotionReason attribute_motion(const Case& fixture) {
  const RigidTransform templated{fixture.current[2], fixture.current[3], fixture.current[1],
                                 fixture.current[0]};
  const LockFrame framed{{fixture.settings.width / 2.0F, fixture.settings.height / 2.0F},
                         fixture.settings.width, fixture.settings.height};
  RigidTransform locked{};
  if (!rigid_to_lock(framed, templated, locked)) return MotionReason::unknown;
  const float center_x = (fixture.box[2] + fixture.box[0]) / 2.0F;
  const float center_y = (fixture.box[3] + fixture.box[1]) / 2.0F;
  if (!inside(center_x, 0.0F, fixture.settings.width) ||
      !inside(center_y, 0.0F, fixture.settings.height)) {
    return MotionReason::center;
  }
  if (!inside(std::abs(locked.scale), 0.0F, 4.0F)) return MotionReason::scale;
  if (!inside(locked.degrees, -180.0F, 180.0F)) return MotionReason::degrees;
  const float translation_x = locked.translation_x + (center_x - fixture.settings.width / 2.0F);
  const float translation_y = locked.translation_y + (center_y - fixture.settings.height / 2.0F);
  if (!inside(translation_x, -4.0F * fixture.settings.width, 4.0F * fixture.settings.width) ||
      !inside(translation_y, -4.0F * fixture.settings.height, 4.0F * fixture.settings.height)) {
    return MotionReason::translation;
  }
  return MotionReason::unknown;
}

void compare(Totals& totals, NativeMergeUtil& native, const Case& fixture,
             std::uint64_t* extra = nullptr) {
  std::vector<float> expected;
  const MergeStage stage = merge_util(fixture.settings, fixture.current, fixture.box, expected);
  std::vector<float> current(fixture.current.begin(), fixture.current.end());
  std::vector<float> box(fixture.box.begin(), fixture.box.end());
  const std::vector<float> observed = native.run(current, box);
  ++totals.calls;
  if (stage != MergeStage::accepted) {
    ++totals.rejections[static_cast<std::size_t>(stage)];
    if (stage == MergeStage::motion) {
      ++totals.motion_reasons[static_cast<std::size_t>(attribute_motion(fixture))];
    }
    // Only the singular/NaN family makes native non-finite. A bound rejection
    // leaves native perfectly finite, and that is recorded rather than hidden:
    // this diagnostic does not claim agreement outside the declared domain.
    if (finite_values(observed)) ++totals.rejected_with_finite_native;
    return;
  }
  require(merge_fixtures::same(expected, observed),
          "MergeUtil differs at call " + std::to_string(totals.calls));
  std::size_t nans = 0;
  for (float field : observed) nans += std::isnan(field) ? 1U : 0U;
  totals.nan_fields += nans;
  totals.nan_results += nans != 0 ? 1U : 0U;
  totals.comparisons += observed.size();
  ++totals.compared;
  merge_fixtures::hash(totals.hash, observed);
  if (extra) merge_fixtures::hash(*extra, observed);
}

// Re-derives the goldens the default CTest pins, straight from the library.
void pinned(NativeMergeUtil& native, Totals& totals) {
  for (std::size_t index = 0; index < merge_fixtures::pinned_cases.size(); ++index) {
    const auto& fixture = merge_fixtures::pinned_cases[index];
    native.configure(static_cast<int>(fixture.settings.width),
                     static_cast<int>(fixture.settings.height));
    const Case sample{fixture.settings, fixture.current, fixture.box};
    compare(totals, native, sample);
    std::vector<float> current(fixture.current.begin(), fixture.current.end());
    std::vector<float> box(fixture.box.begin(), fixture.box.end());
    const std::vector<float> observed = native.run(current, box);
    ++totals.calls;
    const auto expected = merge_fixtures::golden(index);
    require(merge_fixtures::same(expected, observed),
            "Pinned golden " + std::to_string(index) + " is not the native result");
  }
}

void random_matrix(NativeMergeUtil& native, Totals& totals, unsigned rounds) {
  merge_fixtures::Random random{0x6d2b79f5U};
  for (const auto& size : merge_fixtures::frame_sizes) {
    native.configure(static_cast<int>(size[0]), static_cast<int>(size[1]));
    for (unsigned index = 0; index < rounds; ++index) {
      compare(totals, native, merge_fixtures::sample(random, size, index % 4U == 0U));
    }
  }
}

// Explicit corners: boxes on the frame edge, zero-area boxes, box centers at
// 0 and at the full extent, signed-zero and +-180 angles, and the scale
// magnitudes the two conversion stages bound.
void boundaries(NativeMergeUtil& native, Totals& totals) {
  const float epsilon = 1.0e-5F;
  for (const auto& size : merge_fixtures::frame_sizes) {
    native.configure(static_cast<int>(size[0]), static_cast<int>(size[1]));
    const MergeSettings settings{size[0], size[1], merge_fixtures::native_unused_field};
    for (const Vector4 box : {Vector4{0.0F, 0.0F, size[0], size[1]},
                              Vector4{0.0F, 0.0F, 0.0F, 0.0F},
                              Vector4{size[0], size[1], size[0], size[1]},
                              Vector4{size[0], size[1], 0.0F, 0.0F},
                              Vector4{size[0] / 2.0F, size[1] / 2.0F, size[0] / 2.0F,
                                      size[1] / 2.0F},
                              Vector4{-0.0F, -0.0F, 0.0F, 0.0F},
                              Vector4{1.0F, 1.0F, size[0] - 1.0F, size[1] - 1.0F},
                              // Midpoints outside the frame: the motion stage
                              // refuses these, native does not.
                              Vector4{-size[0], -size[1], -size[0], -size[1]},
                              Vector4{3.0F * size[0], 3.0F * size[1], 3.0F * size[0],
                                      3.0F * size[1]}}) {
      for (float degrees : {-180.0F, -90.0F, -25.0F, -epsilon, -0.0F, 0.0F, epsilon, 1.0e-6F,
                            25.0F, 90.0F, 180.0F}) {
        for (float scale : {-4.0F, -1.0F, -0.25F, 1.0e-4F, 0.2F, 0.25F, 1.0F, 2.6F, 4.0F}) {
          for (float fraction : {-1.0F, -epsilon, -0.0F, 0.0F, epsilon, 1.0F}) {
            const Case fixture{settings, {scale, degrees, fraction, -fraction}, box};
            compare(totals, native, fixture, &totals.boundary_hash);
          }
        }
      }
    }
  }
}

// The singular family the independent entry refuses. Native has no guard, so
// this only records what it does; no payload is claimed.
void singular_family(NativeMergeUtil& native, Totals& totals) {
  for (const auto& size : merge_fixtures::frame_sizes) {
    native.configure(static_cast<int>(size[0]), static_cast<int>(size[1]));
    const MergeSettings settings{size[0], size[1], merge_fixtures::native_unused_field};
    for (float scale : {0.0F, -0.0F}) {
      for (float degrees : {-45.0F, 0.0F, 45.0F}) {
        compare(totals, native, {settings, {scale, degrees, 0.25F, -0.25F},
                                 {0.0F, 0.0F, size[0], size[1]}});
      }
    }
  }
}

// The +0x10 field MergeUtil loads and drops. Poisoning it must not move the
// native result; that is the only way to state the load is dead at runtime.
void dead_field(NativeMergeUtil& native, Totals& totals) {
  native.configure(1920, 1080);
  const Case base{{1920.0F, 1080.0F, merge_fixtures::native_unused_field},
                  {1.0F, 30.0F, 0.1F, -0.2F},
                  {100.0F, 80.0F, 1000.0F, 700.0F}};
  compare(totals, native, base);
  std::vector<float> current(base.current.begin(), base.current.end());
  std::vector<float> box(base.box.begin(), base.box.end());
  const std::vector<float> reference = native.run(current, box);
  ++totals.calls;
  for (float poison : {0.0F, -1.0F, 1.0e30F}) {
    Case altered = base;
    altered.settings.unused_field = poison;
    std::vector<float> expected;
    require(merge_util(altered.settings, altered.current, altered.box, expected) ==
                MergeStage::accepted,
            "Dead-field fixture rejected");
    require(merge_fixtures::same(expected, reference),
            "The independent entry read SettingInfo +0x10");
  }
}

void emit(const Totals& totals, const NativeMergeUtil& native) {
  std::cout << "{\"calls\":" << totals.calls << ",\"compared_calls\":" << totals.compared
            << ",\"float32_comparisons\":" << totals.comparisons
            << ",\"mismatches\":0,\"nan_class_mismatches\":0"
            << ",\"nan_results\":" << totals.nan_results
            << ",\"nan_fields\":" << totals.nan_fields << ",\"policy_rejections\":{";
  static constexpr std::array<const char*, stage_count> stage_names{
      "accepted", "settings", "template_vector", "box_vector", "rigid_to_lock", "motion",
      "lock_to_rigid"};
  for (std::size_t index = 1; index < stage_count; ++index) {
    std::cout << (index == 1 ? "" : ",") << '"' << stage_names[index]
              << "\":" << totals.rejections[index];
  }
  static constexpr std::array<const char*, motion_reason_count> reason_names{
      "unknown", "box_center_outside_frame", "lock_scale_over_4", "lock_degrees_over_180",
      "lock_translation_over_4x_extent"};
  std::cout << "},\"motion_gate_attribution\":{";
  for (std::size_t index = 0; index < motion_reason_count; ++index) {
    std::cout << (index == 0 ? "" : ",") << '"' << reason_names[index]
              << "\":" << totals.motion_reasons[index];
  }
  std::cout << "},\"rejected_with_finite_native\":" << totals.rejected_with_finite_native
            << ",\"setting_info\":{\"size\":" << lens_contract::diagnostic::setting_info_size
            << ",\"offset\":" << lens_contract::diagnostic::setting_info_offset
            << ",\"pipeline_size\":" << lens_contract::diagnostic::pipeline_size
            << ",\"init_changed_from_default_at\":[";
  const auto& observed = native.settings_image();
  const auto& defaults = native.default_settings_image();
  bool first = true;
  for (std::size_t index = 0; index < observed.size(); ++index) {
    if (observed[index] == defaults[index]) continue;
    std::cout << (first ? "" : ",") << index;
    first = false;
  }
  std::cout << "]},\"fingerprint\":\"" << std::hex << totals.hash
            << "\",\"boundary_fingerprint\":\"" << totals.boundary_hash << "\"}\n"
            << std::flush;
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2 || argc == 3,
            "Usage: lens-merge-util-native-oracle /absolute/liblens.dylib [rounds]");
    const unsigned rounds = argc == 3 ? static_cast<unsigned>(std::stoul(argv[2])) : 50000U;
    // The pipeline constructor prints vendor banners on stdout; the JSON has
    // to be the only thing left on it.
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0,
            "Cannot redirect vendor logs");
    const Oracle oracle(argv[1]);
    Totals totals;
    {
      NativeMergeUtil native(oracle);
      pinned(native, totals);
      random_matrix(native, totals, rounds);
      boundaries(native, totals);
      singular_family(native, totals);
      dead_field(native, totals);
      require(totals.rejections[static_cast<std::size_t>(MergeStage::rigid_to_lock)] != 0,
              "Fixture matrix never reached the singular family");
      require(totals.rejections[static_cast<std::size_t>(MergeStage::motion)] != 0,
              "Fixture matrix never reached the motion gate");
      require(totals.motion_reasons[static_cast<std::size_t>(MotionReason::center)] != 0 &&
                  totals.motion_reasons[static_cast<std::size_t>(MotionReason::translation)] != 0,
              "Fixture matrix never reached both motion sub-gates");
      std::fflush(stdout);
      require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
      close(saved_stdout);
      emit(totals, native);
      require(dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect vendor logs");
    }
    std::fflush(stdout);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
