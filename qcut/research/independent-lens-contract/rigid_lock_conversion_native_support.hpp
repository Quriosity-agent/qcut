#pragma once

#include "motion_constraint_native_support.hpp"
#include "rigid_lock_conversion.hpp"

#include <cstring>

namespace lens_contract::diagnostic {

inline constexpr char rigid_to_lock_anchor[] =
    "_ZN4LENS9ALGORITHM7MoveSys4Util10Rigid2LockERNS1_5RigidEffff";
inline constexpr char lock_to_rigid_anchor[] =
    "_ZN4LENS9ALGORITHM7MoveSys4Util10Lock2RigidERNS1_5RigidEffff";

// Both conversions take a Rigid by reference plus four floats. The only object
// involved is that Rigid, and it is filled exclusively by the real constructor
// reached through the pinned 0x97208 wrapper; nothing is hand-built.
class NativeRigidLock {
 public:
  using Conversion = void (*)(void*, float, float, float, float);

  explicit NativeRigidLock(const Oracle& oracle)
      : to_lock_(oracle.offset<Conversion>(rigid_to_lock_anchor, 0x967f8, 0x967f8)),
        to_rigid_(oracle.offset<Conversion>(lock_to_rigid_anchor, 0x9622c, 0x9622c)),
        construct_rigid_(oracle.offset<Conversion>(rigid_to_lock_anchor, 0x967f8, 0x97208)) {}

  RigidTransform convert(bool to_lock, const LockFrame& frame, const RigidTransform& input) {
    static_assert(sizeof(RigidTransform) == 16);
    MotionStorage<16> rigid;
    construct_rigid_(rigid.data(), input.translation_x, input.translation_y, input.degrees,
                     input.scale);
    rigid.guards();
    RigidTransform before{};
    std::memcpy(&before, rigid.data(), sizeof(before));
    // Re-proves the {tx, ty, degrees, scale} layout before every single call.
    require(std::memcmp(&before, &input, sizeof(before)) == 0,
            "Native Rigid constructor layout differs");
    (to_lock ? to_lock_ : to_rigid_)(rigid.data(), frame.center.x, frame.center.y, frame.width,
                                     frame.height);
    rigid.guards();
    RigidTransform result{};
    std::memcpy(&result, rigid.data(), sizeof(result));
    return result;
  }

 private:
  Conversion to_lock_;
  Conversion to_rigid_;
  Conversion construct_rigid_;
};

}  // namespace lens_contract::diagnostic
