#include "merge_util_fixtures.hpp"
#include "motion_constraint.hpp"
#include "rigid_lock_conversion.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace {
using namespace lens_contract;
using namespace lens_contract::merge_fixtures;
std::size_t checks = 0;
void require(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}

// Portable libm may round powf and atan2f differently; the optional pinned
// native oracle requires exact bits for every case, including these.
bool close(float expected, float actual) {
  if (std::isnan(expected) || std::isnan(actual)) {
    return std::isnan(expected) && std::isnan(actual);
  }
  return std::signbit(expected) == std::signbit(actual) &&
         std::abs(actual - expected) <= 1.0e-5F * std::max(1.0F, std::abs(expected));
}

MergeStage run(const PinnedCase& fixture, std::vector<float>& output) {
  return merge_util(fixture.settings, fixture.current, fixture.box, output);
}

void goldens() {
  std::vector<float> output;
  for (std::size_t index = 0; index < pinned_cases.size(); ++index) {
    require(run(pinned_cases[index], output) == MergeStage::accepted,
            "Pinned native case rejected");
    require(output.size() == merge_vector_length, "MergeUtil must return four elements");
    const Vector4 expected = golden(index);
#if defined(__APPLE__) && defined(__aarch64__)
    require(same(expected, output), "Native golden changed");
#endif
    for (std::size_t field = 0; field < merge_vector_length; ++field) {
      require(close(expected[field], output[field]), "Native golden moved beyond tolerance");
    }
  }
  // Only the two box midpoints reach the chain. Cases 0, 1 and 15 encode that
  // with three different rectangles that share a midpoint; moving the midpoint
  // has to move the result. The fixture needs a template scale above one:
  // border mode 11 keeps a full-size frame glued to the origin, so at scale
  // one the clipped translation is the same wherever the box sits.
  std::vector<float> reference;
  std::vector<float> shifted;
  PinnedCase moved = pinned_cases[10];
  require(run(moved, reference) == MergeStage::accepted, "Midpoint fixture rejected");
  moved.box = {320.0F, 360.0F, 960.0F, 719.0F};
  require(run(moved, shifted) == MergeStage::accepted && !same(shifted, reference),
          "The box midpoint does not reach the result");
}

// The three chain facts a wrong reading of MergeUtil would get wrong, stated
// as differences against the real goldens rather than as prose. Each block
// composes the same public entries in the wrong way and must disagree.
void chain_shape() {
  // Border mode 11 pins a full-size frame to the origin, so a template scale
  // of one collapses both the rotation search and the translation clip to the
  // same answer wherever the centers sit. Case 10 has a template scale of 2.5,
  // which leaves the slack the two centers actually act on.
  const PinnedCase fixture = pinned_cases[10];
  const MergeSettings settings = fixture.settings;
  std::vector<float> expected;
  require(run(fixture, expected) == MergeStage::accepted, "Chain fixture rejected");

  const RigidTransform templated{fixture.current[2], fixture.current[3], fixture.current[1],
                                 fixture.current[0]};
  const Point frame_center{settings.width / 2.0F, settings.height / 2.0F};
  const Point box_center{(fixture.box[2] + fixture.box[0]) / 2.0F,
                         (fixture.box[3] + fixture.box[1]) / 2.0F};
  require(box_center != frame_center, "Chain fixture must use an off-center box");
  RigidTransform locked{};
  require(rigid_to_lock({frame_center, settings.width, settings.height}, templated, locked),
          "Rigid2Lock stage rejected");
  const RigidTransform shifted{locked.translation_x + (box_center.x - settings.width / 2.0F),
                               locked.translation_y + (box_center.y - settings.height / 2.0F),
                               locked.degrees, locked.scale};

  const auto finish = [&](const Point& motion_center, const Point& unlock_center,
                          const RigidTransform& input, Vector4& result) {
    RigidTransform constrained{};
    require(constrain_motion({settings.width, settings.height, motion_center, 0.2F}, input,
                             constrained),
            "Motion stage rejected");
    RigidTransform merged{};
    require(lock_to_rigid({unlock_center, settings.width, settings.height}, constrained, merged),
            "Lock2Rigid stage rejected");
    result = {merged.scale, merged.degrees, merged.translation_x, merged.translation_y};
  };

  Vector4 reference{};
  finish(box_center, box_center, shifted, reference);
  require(same(reference, expected), "The recovered chain is not the composed chain");
  Vector4 variant{};
  // Move::Run is centered on the box, not on the frame.
  finish(frame_center, box_center, shifted, variant);
  require(!same(variant, expected), "The motion center is unobservable at this fixture");
  // Lock2Rigid is centered on the box too, unlike Rigid2Lock.
  finish(box_center, frame_center, shifted, variant);
  require(!same(variant, expected), "The unlock center is unobservable at this fixture");
  // 0xb1018 also computes (x1 - x0) / width and never reads it back. Using it
  // as the horizontal offset is the most plausible wrong reading.
  const RigidTransform dead{
      locked.translation_x + (fixture.box[2] - fixture.box[0]) / settings.width,
      locked.translation_y + (box_center.y - settings.height / 2.0F), locked.degrees,
      locked.scale};
  finish(box_center, box_center, dead, variant);
  require(!same(variant, expected), "The dead stack slot is unobservable at this fixture");
  // The template vector is not laid out like a Rigid.
  const RigidTransform permuted{fixture.current[0], fixture.current[1], fixture.current[2],
                                fixture.current[3]};
  RigidTransform other{};
  require(rigid_to_lock({frame_center, settings.width, settings.height}, permuted, other) &&
              (other.translation_x != locked.translation_x || other.scale != locked.scale),
          "The template permutation is unobservable at this fixture");
}

void fingerprints() {
  // The chain calls cosf, sinf, powf and atan2f on swept matrix elements, so
  // this fingerprint records what the platform the native oracle actually ran
  // on produces. Off that platform the sweep still checks that every fixture
  // resolves to a stage and that accepted results carry four elements; the
  // 2026-09-10 cloud CI refutation of the batch-4 fingerprint is the reason
  // nothing stronger is asserted there.
  Random random{0x1f123bb5U};
  std::uint64_t value = 14695981039346656037ULL;
  std::size_t accepted = 0;
  std::size_t motion_rejections = 0;
  std::vector<float> output;
  for (const auto& size : frame_sizes) {
    for (unsigned index = 0; index < 512; ++index) {
      const Case fixture = sample(random, size, index % 4U == 0U);
      const MergeStage stage =
          merge_util(fixture.settings, fixture.current, fixture.box, output);
      if (stage == MergeStage::motion) ++motion_rejections;
      if (stage != MergeStage::accepted) continue;
      require(output.size() == merge_vector_length, "Accepted result changed shape");
      hash(value, output);
      ++accepted;
    }
  }
  // The 17x145 frame legitimately leaves the motion stage's translation domain
  // for 324 of its 512 samples; a build that silently accepted everything
  // would be wrong, and so would one that hid the small frame.
  require(motion_rejections != 0, "The motion gate never fired in the sweep");
  require(accepted != 0, "The sweep accepted nothing");
#if defined(__APPLE__) && defined(__aarch64__)
  require(accepted == 3256, "The accepted count of the 3584-sample sweep changed");
  require(motion_rejections == 328, "The motion-gate rejection count changed");
  require(value == 0x2c7b262c16b8251bULL, "Native-observed sweep fingerprint changed");
#endif
}

void structure() {
  const PinnedCase fixture = pinned_cases[10];
  std::vector<float> expected;
  require(run(fixture, expected) == MergeStage::accepted, "Structure fixture rejected");

  // Native indexes both vectors with operator[] and ignores anything past the
  // fourth element.
  const std::array<float, 6> longer_current{fixture.current[0], fixture.current[1],
                                            fixture.current[2], fixture.current[3], 99.0F,
                                            -99.0F};
  const std::array<float, 5> longer_box{fixture.box[0], fixture.box[1], fixture.box[2],
                                        fixture.box[3], 77.0F};
  std::vector<float> ignored;
  require(merge_util(fixture.settings, longer_current, longer_box, ignored) ==
                  MergeStage::accepted &&
              same(ignored, expected),
          "Elements past the fourth changed the result");

  // SettingInfo +0x10 is loaded once at 0xb0f34 and never read again.
  for (float poison : {0.0F, -1.0F, 1.0e30F, std::numeric_limits<float>::infinity(),
                       std::numeric_limits<float>::quiet_NaN()}) {
    MergeSettings altered = fixture.settings;
    altered.unused_field = poison;
    std::vector<float> unchanged;
    require(merge_util(altered, fixture.current, fixture.box, unchanged) ==
                    MergeStage::accepted &&
                same(unchanged, expected),
            "SettingInfo +0x10 reached the result");
  }

  // The output may be the container the inputs came from.
  std::vector<float> aliased(fixture.current.begin(), fixture.current.end());
  const std::vector<float> box(fixture.box.begin(), fixture.box.end());
  require(merge_util(fixture.settings, aliased, box, aliased) == MergeStage::accepted &&
              same(aliased, expected),
          "Aliased output changed the result");

  // Every accepted frame extent still produces four elements.
  for (float extent : {1.0F, 2.0F, 8192.0F}) {
    const MergeSettings settings{extent, extent, native_unused_field};
    const std::array<float, 4> centred{1.0F, 0.0F, 0.0F, 0.0F};
    const std::array<float, 4> whole{0.0F, 0.0F, extent, extent};
    std::vector<float> corner;
    require(merge_util(settings, centred, whole, corner) == MergeStage::accepted &&
                corner.size() == merge_vector_length,
            "Domain corner rejected");
  }
}

void rejections() {
  const PinnedCase valid = pinned_cases[8];
  const Vector4 sentinel{9.0F, -0.0F, 7.0F, 6.0F};
  std::vector<float> output(sentinel.begin(), sentinel.end());
  const auto refused = [&](const MergeSettings& settings, std::span<const float> current,
                           std::span<const float> box, MergeStage expected) {
    const MergeStage stage = merge_util(settings, current, box, output);
    return stage == expected && same(output, sentinel);
  };

  for (float invalid : {std::numeric_limits<float>::infinity(),
                        -std::numeric_limits<float>::infinity(),
                        std::numeric_limits<float>::quiet_NaN()}) {
    for (std::size_t field = 0; field < merge_vector_length; ++field) {
      Vector4 current = valid.current;
      current[field] = invalid;
      require(refused(valid.settings, current, valid.box, MergeStage::template_vector),
              "Invalid template vector changed output");
      Vector4 box = valid.box;
      box[field] = invalid;
      require(refused(valid.settings, valid.current, box, MergeStage::box_vector),
              "Invalid box changed output");
    }
    MergeSettings settings = valid.settings;
    settings.width = invalid;
    require(refused(settings, valid.current, valid.box, MergeStage::settings),
            "Invalid width changed output");
    settings = valid.settings;
    settings.height = invalid;
    require(refused(settings, valid.current, valid.box, MergeStage::settings),
            "Invalid height changed output");
  }

  for (const MergeSettings settings : {MergeSettings{0.0F, 1080.0F, native_unused_field},
                                       {0.5F, 1080.0F, native_unused_field},
                                       {8193.0F, 1080.0F, native_unused_field},
                                       {1920.0F, 0.0F, native_unused_field},
                                       {1920.0F, 8193.0F, native_unused_field},
                                       {-1.0F, -1.0F, native_unused_field}}) {
    require(refused(settings, valid.current, valid.box, MergeStage::settings),
            "Out-of-domain frame changed output");
  }

  // Native indexes without a bounds check, so anything shorter than four
  // elements is undefined behaviour there; this entry refuses it.
  for (std::size_t length = 0; length < merge_vector_length; ++length) {
    require(refused(valid.settings, std::span<const float>(valid.current.data(), length),
                    valid.box, MergeStage::template_vector),
            "Short template vector changed output");
    require(refused(valid.settings, valid.current,
                    std::span<const float>(valid.box.data(), length), MergeStage::box_vector),
            "Short box changed output");
  }

  // The singular scale family: native inverts without a guard and returns NaN.
  for (float scale : {0.0F, -0.0F, 9.9e-5F, -9.9e-5F, 4.1F, -4.1F}) {
    Vector4 current = valid.current;
    current[0] = scale;
    require(refused(valid.settings, current, valid.box, MergeStage::rigid_to_lock),
            "Singular or oversized scale changed output");
  }
  for (float degrees : {361.0F, -361.0F}) {
    Vector4 current = valid.current;
    current[1] = degrees;
    require(refused(valid.settings, current, valid.box, MergeStage::rigid_to_lock),
            "Out-of-domain template angle changed output");
  }

  // The motion stage is where a legitimate frame and a legitimate box still
  // fail: the box midpoint has to be inside the frame.
  for (const Vector4 box : {Vector4{-4000.0F, 0.0F, -4000.0F, 0.0F},
                            Vector4{4000.0F, 0.0F, 4000.0F, 0.0F},
                            Vector4{0.0F, -4000.0F, 0.0F, -4000.0F}}) {
    require(refused(valid.settings, valid.current, box, MergeStage::motion),
            "Box midpoint outside the frame changed output");
  }

  const int original = std::fegetround();
  require(std::fesetround(FE_DOWNWARD) == 0, "Cannot select alternate rounding");
  const bool rejected = refused(valid.settings, valid.current, valid.box, MergeStage::settings);
  const int restored = std::fesetround(original);
  require(rejected && restored == 0, "Rounding mode policy changed");
}
}  // namespace

int main() {
  try {
    goldens();
    chain_shape();
    fingerprints();
    structure();
    rejections();
    std::cout << checks << " merge-util checks passed\n";
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
