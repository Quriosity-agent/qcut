#include "value_state.hpp"

#include <limits>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE signed-zero and NaN comparison semantics"
#endif

namespace editor_contract {
namespace {

static_assert(std::numeric_limits<double>::is_iec559 && sizeof(double) == 8);

void mark_changed(MutationState& mutation) noexcept {
  if (mutation.tracking != 0 && mutation.state_code == 0) {
    mutation.state_code = 2;
  }
  mutation.changed = 1;
}

}  // namespace

void assign_material_value(MaterialValue& material, const double& value) noexcept {
  // Equality suppresses signed-zero changes; every NaN comparison takes the write path.
  if (value == material.value) return;
  material.value = value;
  mark_changed(material.mutation);
}

void assign_keyframe_time(KeyframeTime& keyframe, const std::int64_t& time) noexcept {
  if (time == keyframe.time_offset) return;
  keyframe.time_offset = time;
  mark_changed(keyframe.mutation);
}

}  // namespace editor_contract
