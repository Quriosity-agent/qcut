#pragma once

#include "common_keyframes.hpp"

#include <optional>

namespace creator_contract {

// Query/dynamic-cast resolution is supplied by the host; no SDK object is represented.
struct ResolvedFilterState {
  std::optional<editor_contract::MaterialValue> material;
  CommonKeyframeArray common_keyframes;
};

struct ExistingKeyframeUpdate {
  double intensity;
  bool request_keyframe_enabled;
  bool auto_add_others_keyframe;
  std::string keyframe_id;
};

enum class KeyframeUpdateResult {
  disabled,
  missing_group,
  empty_group,
  updated_existing,
  capture_lookup_required,
};

struct UpdateEffect {
  bool material_setter_called;
  KeyframeUpdateResult keyframe_result;
  bool values_replaced;
};

// resolved_group is the result of findKeyframes_(KFTypeFilter, "", false).
// A missing/empty ID requests capture lookup rather than being reported as success.
UpdateEffect update_resolved_filter(ResolvedFilterState& filter,
                                    CommonKeyframeGroup* resolved_group,
                                    const ExistingKeyframeUpdate& request);

struct ResetEffect {
  bool material_setter_called;
  std::size_t common_groups_removed;
  std::size_t clock_write_events;
};

ResetEffect reset_resolved_filter(ResolvedFilterState& filter);

}  // namespace creator_contract
