#pragma once

#include <cstdint>

namespace editor_contract {

// Numeric state names are deliberately neutral: no undo/event meaning is proven.
struct MutationState {
  std::uint8_t tracking = 0;
  std::uint32_t state_code = 0;
  std::uint8_t changed = 0;
  bool operator==(const MutationState&) const = default;
};

struct MaterialValue {
  double value = 0;
  MutationState mutation;
};

struct KeyframeTime {
  std::int64_t time_offset = 0;
  MutationState mutation;
};

void assign_material_value(MaterialValue& material, const double& value) noexcept;
void assign_keyframe_time(KeyframeTime& keyframe, const std::int64_t& time) noexcept;

}  // namespace editor_contract
