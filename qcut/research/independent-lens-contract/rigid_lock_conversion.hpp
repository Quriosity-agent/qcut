#pragma once

#include "lens_contract.hpp"

namespace lens_contract {

// The pixel frame both conversions receive. MergeUtil reads width and height
// from SettingInfo +0x00/+0x04 and passes (width/2, height/2) as the center,
// but the center is an ordinary argument and arbitrary centers are supported.
struct LockFrame {
  Point center;
  float width;
  float height;
};

// Util::Rigid2Lock. Normalized template Rigid to pixel-space lock parameters.
// Builds A = [[w/2,0,w/2],[0,h/2,h/2],[0,0,1]] and the rigid matrix B, inverts
// A*B*inv(A), decomposes it and applies the -center translation correction.
// Rejection preserves output; input and output may alias. Domain checks are
// independent policy.
bool rigid_to_lock(const LockFrame& frame, const RigidTransform& input,
                   RigidTransform& output);

// Util::Lock2Rigid. Pixel-space lock parameters back to a template Rigid.
// Builds five matrices and decomposes invM5*inv(M2*M3*M4*M1)*M5 with the atan2
// argument signs mirrored, taking translation straight from the result. This is
// NOT the inverse of rigid_to_lock: the two directions use a deliberately
// asymmetric degree/radian constant pair and do not round trip.
bool lock_to_rigid(const LockFrame& frame, const RigidTransform& input,
                   RigidTransform& output);

}  // namespace lens_contract
