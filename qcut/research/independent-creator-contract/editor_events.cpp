#include "editor_events.hpp"

#include <stdexcept>

namespace creator_contract {

UpdateEffect update_resolved_filter(ResolvedFilterState& filter,
                                    CommonKeyframeGroup* resolved_group,
                                    const ExistingKeyframeUpdate& request) {
  if (resolved_group && resolved_group->property != "KFTypeFilter") {
    throw std::invalid_argument("Resolved group must be KFTypeFilter");
  }
  const bool writes_material = filter.material.has_value();
  if (writes_material) editor_contract::assign_material_value(*filter.material, request.intensity);
  if (!(request.request_keyframe_enabled || request.auto_add_others_keyframe)) {
    return {writes_material, KeyframeUpdateResult::disabled, false};
  }
  if (!resolved_group) return {writes_material, KeyframeUpdateResult::missing_group, false};
  if (resolved_group->keyframes.empty() && !request.auto_add_others_keyframe) {
    return {writes_material, KeyframeUpdateResult::empty_group, false};
  }
  if (!request.keyframe_id.empty()) {
    if (auto* keyframe = find_keyframe_by_id(*resolved_group, request.keyframe_id)) {
      clear_keyframe_graph(*keyframe);
      const auto replaced = assign_keyframe_values(*keyframe, filter_keyframe_values(request.intensity));
      return {writes_material, KeyframeUpdateResult::updated_existing, replaced};
    }
  }
  return {writes_material, KeyframeUpdateResult::capture_lookup_required, false};
}

ResetEffect reset_resolved_filter(ResolvedFilterState& filter) {
  // QCut rejects malformed input and reserves before any observable state mutation.
  auto& array = filter.common_keyframes;
  prepare_common_keyframe_clear(array);
  const bool writes_material = filter.material.has_value();
  if (writes_material) editor_contract::assign_material_value(*filter.material, 1.0);
  const auto removed = clear_common_keyframes(array);
  return {writes_material, removed, removed};
}

}  // namespace creator_contract
