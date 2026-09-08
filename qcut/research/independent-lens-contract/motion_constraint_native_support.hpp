#pragma once

#include "motion_constraint.hpp"
#include "native_identity.hpp"

#include <cstring>
#include <bit>
#include <vector>

#if !defined(_LIBCPP_VERSION)
#error "The fixed native object ABI requires Apple libc++"
#endif

namespace lens_contract::diagnostic {
inline constexpr char move_anchor[] = "_ZN4LENS9ALGORITHM7MoveSys4Move3RunERNS1_5RigidE";

template <std::size_t Capacity> class MotionStorage {
 public:
  MotionStorage() { bytes_.fill(0xa5); }
  void* data() { return bytes_.data() + 32; }
  const void* data() const { return bytes_.data() + 32; }
  void guards() const {
    for (std::size_t i = 0; i < bytes_.size(); ++i) {
      if (i < 32 || i >= 32 + Capacity) require(bytes_[i] == 0xa5, "Native motion object exceeded allocation");
    }
  }
 private:
  alignas(16) std::array<std::uint8_t, Capacity + 64> bytes_{};
};

class NativeMotionConstraint {
 public:
  NativeMotionConstraint(const Oracle& oracle, const MotionConstraint& constraint)
      : destroy_(oracle.offset<void (*)(void*)>(move_anchor, 0x9fc24, 0x9ffbc)),
        construct_rigid_(oracle.offset<void (*)(void*, float, float, float, float)>(move_anchor, 0x9fc24, 0x97208)),
        run_(oracle.symbol<void (*)(void*, void*)>(move_anchor)),
        expected_parameters_{11U, std::bit_cast<std::uint32_t>(constraint.width),
                             std::bit_cast<std::uint32_t>(constraint.height),
                             std::bit_cast<std::uint32_t>(constraint.center.x),
                             std::bit_cast<std::uint32_t>(constraint.center.y),
                             std::bit_cast<std::uint32_t>(constraint.minimum_scale)} {
    static_assert(sizeof(std::vector<char>) == 24);
    MotionStorage<24> parameter;
    const auto construct_parameter = oracle.offset<void (*)(void*, int, float, float, float, float, float)>(move_anchor, 0x9fc24, 0x9fa94);
    const auto destroy_parameter = oracle.offset<void (*)(void*)>(move_anchor, 0x9fc24, 0x9fb24);
    const auto construct_move = oracle.offset<void (*)(void*, const void*)>(move_anchor, 0x9fc24, 0x9faf0);
    construct_parameter(parameter.data(), 11, constraint.width, constraint.height,
                        constraint.center.x, constraint.center.y, constraint.minimum_scale);
    parameter.guards();
    try { construct_move(storage_.data(), parameter.data()); }
    catch (...) { destroy_parameter(parameter.data()); throw; }
    destroy_parameter(parameter.data());
    parameter.guards();
    storage_.guards();
    parameters_unchanged();
  }
  ~NativeMotionConstraint() { destroy_(storage_.data()); }
  NativeMotionConstraint(const NativeMotionConstraint&) = delete;
  NativeMotionConstraint& operator=(const NativeMotionConstraint&) = delete;

  RigidTransform run(const RigidTransform& input) {
    MotionStorage<16> rigid;
    construct_rigid_(rigid.data(), input.translation_x, input.translation_y, input.degrees, input.scale);
    rigid.guards();
    RigidTransform before{};
    static_assert(sizeof(before) == 16);
    std::memcpy(&before, rigid.data(), sizeof(before));
    require(std::memcmp(&before, &input, sizeof(before)) == 0, "Native Rigid constructor layout differs");
    run_(storage_.data(), rigid.data());
    storage_.guards();
    rigid.guards();
    parameters_unchanged();
    RigidTransform result{};
    std::memcpy(&result, rigid.data(), sizeof(result));
    return result;
  }
 private:
  // MergeUtil stack slots prove both owning objects are 24 bytes. Their real
  // constructors own the encoded parameter buffers; no vector is fabricated.
  MotionStorage<24> storage_;
  void (*destroy_)(void*);
  void (*construct_rigid_)(void*, float, float, float, float);
  void (*run_)(void*, void*);
  std::array<std::uint32_t, 6> expected_parameters_;
  void parameters_unchanged() const {
    std::array<const std::uint8_t*, 3> pointers{};
    std::memcpy(pointers.data(), storage_.data(), sizeof(pointers));
    require(pointers[0] && pointers[1] == pointers[0] + 24,
            "Native Move parameter buffer layout differs");
    std::array<std::uint32_t, 6> values{};
    std::memcpy(values.data(), pointers[0], sizeof(values));
    require(values == expected_parameters_, "Native Move changed or misordered its parameters");
  }
};
}  // namespace lens_contract::diagnostic
