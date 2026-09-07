#pragma once

#include "common_keyframes.hpp"

namespace creator_contract {

// Reset clears the state code only while tracking is enabled; payload data is preserved.
void reset_mutation_state(editor_contract::MutationState& state) noexcept;

// Graph-backed frames and null active nodes/controls are outside this verified domain.
bool keyframe_is_dirty(const CommonKeyframe& frame);
bool group_is_dirty(const CommonKeyframeGroup& group);
bool common_array_is_dirty(const CommonKeyframeArray& array);

void reset_keyframe_dirty(CommonKeyframe& frame);
void reset_group_dirty(CommonKeyframeGroup& group);
void reset_common_array_dirty(CommonKeyframeArray& array);

struct RemovedKeyframe {
  std::shared_ptr<CommonKeyframe> keyframe;
  std::size_t clock_write_events;
};

// Unlike undo, this appends the removed reference to retained and never restores an earlier value.
RemovedKeyframe remove_keyframe_at(CommonKeyframeGroup& group, std::size_t index);

struct RemovedGroup {
  std::shared_ptr<CommonKeyframeGroup> group;
  std::size_t clock_write_events;
};
RemovedGroup remove_common_group_at(CommonKeyframeArray& array, std::size_t index);

}  // namespace creator_contract
