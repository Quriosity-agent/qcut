#include "dirty_tree.hpp"

#include "mutation.hpp"

#include <limits>
#include <stdexcept>

namespace creator_contract {
namespace {
template <typename Node>
std::shared_ptr<Node> remove_at(std::vector<std::shared_ptr<Node>>& active,
    std::vector<std::shared_ptr<Node>>& retained, bool tracking,
    editor_contract::MutationState& mutation, std::size_t index) {
  if (index >= active.size() || index > static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max())) {
    throw std::out_of_range("Removal requires a valid signed-32-bit index");
  }
  auto node = active[index];
  if (!node) throw std::invalid_argument("Cannot remove a null node");
  retained.push_back(node);
  if (tracking && node->mutation.tracking != 0) node->mutation.state_code = 3;
  detail::mark_changed(mutation);
  active.erase(active.begin() + static_cast<std::ptrdiff_t>(index));
  return node;
}

void validate_flag(const editor_contract::MutationState& state) {
  if (state.changed > 1) throw std::invalid_argument("Noncanonical dirty bool is outside the verified model domain");
}

void validate_frame(const CommonKeyframe& frame) {
  if (frame.has_graph || !frame.left_control || !frame.right_control) {
    throw std::invalid_argument("Dirty traversal requires two controls and no graph");
  }
  validate_flag(frame.mutation);
  validate_flag(frame.left_control->mutation);
  validate_flag(frame.right_control->mutation);
}

void validate_group(const CommonKeyframeGroup& group) {
  validate_flag(group.mutation);
  validate_flag(group.list_mutation);
  for (const auto& frame : group.keyframes) {
    if (!frame) throw std::invalid_argument("Null active frame is outside the dirty traversal domain");
    validate_frame(*frame);
  }
}

void validate_array(const CommonKeyframeArray& array) {
  validate_flag(array.mutation);
  for (const auto& group : array.active) {
    if (!group) throw std::invalid_argument("Null active group is outside the dirty traversal domain");
    validate_group(*group);
  }
}

bool frame_dirty(const CommonKeyframe& frame) noexcept {
  return frame.mutation.changed != 0 || frame.left_control->mutation.changed != 0 ||
      frame.right_control->mutation.changed != 0;
}

bool group_dirty(const CommonKeyframeGroup& group) noexcept {
  if (group.mutation.changed != 0 || group.list_mutation.changed != 0) return true;
  for (const auto& frame : group.keyframes) {
    if (frame_dirty(*frame)) return true;
  }
  return false;
}

void reset_frame(CommonKeyframe& frame) noexcept {
  reset_mutation_state(frame.mutation);
  reset_mutation_state(frame.left_control->mutation);
  reset_mutation_state(frame.right_control->mutation);
}

void reset_group(CommonKeyframeGroup& group) noexcept {
  reset_mutation_state(group.mutation);
  reset_mutation_state(group.list_mutation);
  for (const auto& frame : group.keyframes) reset_frame(*frame);
  group.retained_keyframes.clear();
}
}  // namespace

void reset_mutation_state(editor_contract::MutationState& state) noexcept {
  if (state.tracking != 0) state.state_code = 0;
  state.changed = 0;
}

bool keyframe_is_dirty(const CommonKeyframe& frame) {
  validate_frame(frame);
  return frame_dirty(frame);
}

bool group_is_dirty(const CommonKeyframeGroup& group) {
  validate_group(group);
  return group_dirty(group);
}

bool common_array_is_dirty(const CommonKeyframeArray& array) {
  validate_array(array);
  if (array.mutation.changed != 0) return true;
  for (const auto& group : array.active) {
    if (group_dirty(*group)) return true;
  }
  return false;
}

void reset_keyframe_dirty(CommonKeyframe& frame) {
  validate_frame(frame);
  reset_frame(frame);
}

void reset_group_dirty(CommonKeyframeGroup& group) {
  validate_group(group);
  reset_group(group);
}

void reset_common_array_dirty(CommonKeyframeArray& array) {
  validate_array(array);
  reset_mutation_state(array.mutation);
  for (const auto& group : array.active) reset_group(*group);
  array.retained.clear();
}

RemovedKeyframe remove_keyframe_at(CommonKeyframeGroup& group, std::size_t index) {
  return {remove_at(group.keyframes, group.retained_keyframes, group.track_inserted_children,
                    group.list_mutation, index), 1};
}

RemovedGroup remove_common_group_at(CommonKeyframeArray& array, std::size_t index) {
  return {remove_at(array.active, array.retained, array.track_removed_children, array.mutation, index), 1};
}

}  // namespace creator_contract
