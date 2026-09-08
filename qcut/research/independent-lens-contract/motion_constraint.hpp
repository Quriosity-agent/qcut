#pragma once

#include "lens_contract.hpp"

namespace lens_contract {

struct MotionConstraint {
  float width;
  float height;
  Point center;
  float minimum_scale = 0.2F;
};

// Move::Run with the border-cut-down mode used by MergeUtil. This is a pixel
// coordinate transform; a normalized template vector needs Rigid2Lock first.
// Rejection preserves output. Domain checks are independent policy.
bool constrain_motion(const MotionConstraint& constraint,
                      const RigidTransform& input, RigidTransform& output);

}  // namespace lens_contract
