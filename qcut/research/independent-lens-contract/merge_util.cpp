#include "merge_util.hpp"

#include "motion_constraint.hpp"
#include "rigid_lock_conversion.hpp"

#include <algorithm>
#include <array>
#include <cfenv>
#include <cmath>

namespace lens_contract {
namespace {

// The conjunction of the three stage domains. rigid_to_lock caps the frame at
// 8192 and constrain_motion at 32768, so the smaller cap wins; widening this
// would let a frame reach a stage that refuses it and turn one attributable
// rejection into a different one.
constexpr float maximum_frame_extent = 8192.0F;

// Move's border mode and minimum scale are literals inside MergeUtil, not
// caller-visible options: 0xb1150 is `mov w1,#0xb` and 0xb1154/0xb1158 build
// 0x3E4CCCCD. constrain_motion only recovers mode 11, so the mode is implied
// by calling it at all; the minimum scale still has to be spelled out.
constexpr float move_minimum_scale = 0.2F;

bool usable(std::span<const float> values) {
  return values.size() >= merge_vector_length &&
         std::all_of(values.begin(), values.begin() + merge_vector_length,
                     [](float value) { return std::isfinite(value); });
}

bool bounded_extent(float value) {
  return std::isfinite(value) && value >= 1.0F && value <= maximum_frame_extent;
}

}  // namespace

MergeStage merge_util(const MergeSettings& settings, std::span<const float> current,
                      std::span<const float> box, std::vector<float>& output) {
  if (std::fegetround() != FE_TONEAREST || !bounded_extent(settings.width) ||
      !bounded_extent(settings.height)) {
    return MergeStage::settings;
  }
  if (!usable(current)) return MergeStage::template_vector;
  if (!usable(box)) return MergeStage::box_vector;

  // 0xb0f40-0xb0fb0 loads current[2], current[3], current[1], current[0] and
  // hands them to the Rigid constructor's tx, ty, degrees, scale parameters in
  // that order. The vector is NOT laid out like a Rigid.
  const RigidTransform templated{current[2], current[3], current[1], current[0]};
  const LockFrame framed{{settings.width / 2.0F, settings.height / 2.0F}, settings.width,
                         settings.height};
  RigidTransform locked{};
  if (!rigid_to_lock(framed, templated, locked)) return MergeStage::rigid_to_lock;

  // 0xb1018-0xb1028 also computes (box[2] - box[0]) / width and stores it to
  // a stack slot that is never loaded again. It is deliberately absent here:
  // reviving it as the horizontal offset is the single most plausible wrong
  // reading of this function, and the negative controls check for it.
  const float center_x = (box[2] + box[0]) / 2.0F;
  const float center_y = (box[3] + box[1]) / 2.0F;
  // Native issues two separate fdiv instructions and then one fsub
  // (0xb105c/0xb1068/0xb106c), and that order is kept verbatim. Folding it to
  // (sum - extent) / 2 has NOT been shown to be equivalent, so it is not done.
  const float offset_x = center_x - settings.width / 2.0F;
  const float offset_y = center_y - settings.height / 2.0F;

  // The motion stage is centered on the BOX, not on the frame; only the two
  // extents are shared with the Rigid2Lock call above.
  const MotionConstraint constraint{settings.width, settings.height,
                                    {center_x, center_y}, move_minimum_scale};
  const RigidTransform shifted{locked.translation_x + offset_x,
                               locked.translation_y + offset_y, locked.degrees, locked.scale};
  RigidTransform moved{};
  if (!constrain_motion(constraint, shifted, moved)) return MergeStage::motion;

  // 0xb121c-0xb1238 rebuilds the same box center for Lock2Rigid. Native
  // recomputes it from the vector rather than reusing the earlier value; the
  // expression is identical, so one evaluation is bit-for-bit the same.
  const LockFrame boxed{{center_x, center_y}, settings.width, settings.height};
  RigidTransform merged{};
  if (!lock_to_rigid(boxed, moved, merged)) return MergeStage::lock_to_rigid;

  // 0xb1248-0xb1268 writes scale, degrees, tx, ty in that order, which is the
  // same permutation the input used, not the Rigid field order.
  const std::array<float, merge_vector_length> result{merged.scale, merged.degrees,
                                                      merged.translation_x,
                                                      merged.translation_y};
  output.assign(result.begin(), result.end());
  return MergeStage::accepted;
}

}  // namespace lens_contract
