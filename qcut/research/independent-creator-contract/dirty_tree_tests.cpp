#include "dirty_tree.hpp"
#include "keyframe_insertion.hpp"
#include "test_support.hpp"

#include <limits>

using namespace creator_contract;

int main() {
  try {
    Checks checks;
    for (std::uint8_t tracking : {std::uint8_t{0}, std::uint8_t{1}, std::uint8_t{255}}) {
      for (std::uint32_t code : {0U, 1U, 2U, 3U, std::numeric_limits<std::uint32_t>::max()}) {
        for (std::uint8_t changed : {std::uint8_t{0}, std::uint8_t{1}}) {
          editor_contract::MutationState state{tracking, code, changed};
          reset_mutation_state(state);
          checks.require(state == editor_contract::MutationState{tracking, tracking == 0 ? code : 0U, 0},
                         "Reset preserves tracking and clears code only when tracked");
        }
      }
    }

    auto frame = make_filter_keyframe("key", 123, -0.0);
    frame->mutation = {1, 3, 0};
    frame->left_control->mutation = {0, 17, 0};
    frame->right_control->mutation = {1, 2, 0};
    checks.require(!keyframe_is_dirty(*frame), "State codes alone do not imply dirty");
    frame->right_control->mutation.changed = 1;
    checks.require(keyframe_is_dirty(*frame), "Child control dirty propagates despite clean frame flag");
    reset_keyframe_dirty(*frame);
    checks.require(!keyframe_is_dirty(*frame), "Reset clears frame and both controls");
    checks.require(frame->mutation.state_code == 0 && frame->left_control->mutation.state_code == 17 &&
                       frame->right_control->mutation.state_code == 0, "Each child independently applies tracking gate");
    checks.same_bits(frame->values[0], -0.0, "Dirty reset preserves raw scalar bits");
    checks.require(frame->id == "key" && frame->time_offset == 123, "Dirty reset does not undo payload");

    CommonKeyframeGroup group;
    group.keyframes = {frame, frame};
    group.retained_keyframes = {frame, nullptr};
    group.track_inserted_children = true;
    frame->mutation = {1, 3, 1};
    group.mutation = {0, 9, 0};
    group.list_mutation = {1, 2, 0};
    const auto capacity = group.keyframes.capacity();
    checks.require(group_is_dirty(group), "Active descendant makes group dirty");
    reset_group_dirty(group);
    checks.require(group.keyframes.size() == 2 && group.keyframes[0] == group.keyframes[1] &&
                       group.keyframes.capacity() == capacity, "Reset retains active order, aliases, and storage");
    checks.require(group.retained_keyframes.empty() && !group_is_dirty(group), "Reset clears retained references");
    checks.require(frame->mutation == editor_contract::MutationState{1, 0, 0},
                   "Active-retained alias is reset through its active occurrence");
    checks.require(group.track_inserted_children && group.mutation.state_code == 9 && group.list_mutation.state_code == 0,
                   "Container tracking configuration and untracked state code survive reset");

    auto removed_only = make_filter_keyframe("removed", 456, 0.7);
    removed_only->mutation = {1, 3, 1};
    removed_only->left_control->mutation.changed = 1;
    group.retained_keyframes = {removed_only};
    checks.require(!group_is_dirty(group), "Retained-only dirty nodes are ignored by dirty query");
    reset_group_dirty(group);
    checks.require(removed_only->mutation == editor_contract::MutationState{1, 3, 1} &&
                       removed_only->left_control->mutation.changed == 1,
                   "Retained-only nodes are released without resetting their state");

    for (bool tracked : {false, true}) {
      CommonKeyframeGroup test;
      test.track_inserted_children = tracked;
      auto a = make_filter_keyframe("a", 0, 0.1);
      auto b = make_filter_keyframe("b", 1, 0.2);
      auto c = make_filter_keyframe("c", 2, 0.3);
      test.keyframes = {a, b, c};
      b->mutation = {1, 2, 0};
      test.list_mutation = {1, 0, 0};
      const auto result = remove_keyframe_at(test, 1);
      checks.require(result.keyframe == b && result.clock_write_events == 1,
                     "Removal returns the actual object and one clock event");
      checks.require(test.keyframes == std::vector{a, c} && test.retained_keyframes == std::vector{b},
                     "Removal retains identity and preserves remaining order");
      checks.require(b->mutation == editor_contract::MutationState{1, tracked ? 3U : 2U, 0},
                     "Tracked removal sets code three without forcing child changed");
      checks.require(test.list_mutation == editor_contract::MutationState{1, 2, 1},
                     "Removal dirties the list regardless of child tracking");
    }

    CommonKeyframeGroup lifetime;
    std::weak_ptr<CommonKeyframe> weak;
    {
      auto only = make_filter_keyframe("lifetime", 0, 1);
      weak = only;
      lifetime.keyframes.push_back(only);
    }
    {
      const auto result = remove_keyframe_at(lifetime, 0);
      checks.require(!weak.expired() && result.keyframe.use_count() == 2,
                     "Retained plus returned reference owns removed frame");
    }
    checks.require(!weak.expired(), "Retained list keeps removed-only frame alive");
    reset_group_dirty(lifetime);
    checks.require(weak.expired(), "Reset releases last retained reference");

    CommonKeyframeArray root;
    auto active_group = std::make_shared<CommonKeyframeGroup>();
    active_group->keyframes = {frame};
    root.active = {active_group, active_group};
    root.retained = {active_group};
    root.track_removed_children = true;
    active_group->mutation = {1, 2, 0};
    frame->left_control->mutation.changed = 1;
    checks.require(common_array_is_dirty(root), "Dirty reaches outer group array");
    const auto removed_group = remove_common_group_at(root, 0);
    checks.require(removed_group.group == active_group && removed_group.clock_write_events == 1 &&
                       active_group->mutation == editor_contract::MutationState{1, 3, 0},
                   "Group removal records code three and preserves changed");
    reset_common_array_dirty(root);
    checks.require(!common_array_is_dirty(root) && root.retained.empty() && root.active.size() == 1 &&
                       active_group->mutation == editor_contract::MutationState{1, 0, 0},
                   "Outer reset recursively clears active aliases and releases retained groups");

    auto invalid_frame = make_filter_keyframe("invalid", 1, 0.5);
    invalid_frame->has_graph = true;
    active_group->keyframes.push_back(invalid_frame);
    root.mutation.changed = 1;
    root.retained = {active_group};
    frame->mutation.changed = 1;
    bool rejected = false;
    try { reset_common_array_dirty(root); } catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected && root.mutation.changed == 1 && frame->mutation.changed == 1 && root.retained.size() == 1,
                   "Unsupported descendant rejects before any reset or retained release");
    invalid_frame->has_graph = false;
    invalid_frame->left_control.reset();
    rejected = false;
    try { (void)common_array_is_dirty(root); } catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected, "Dirty parent does not hide a null-control domain violation");
    rejected = false;
    try { (void)remove_keyframe_at(group, std::numeric_limits<std::size_t>::max()); }
    catch (const std::out_of_range&) { rejected = true; }
    checks.require(rejected && group.keyframes.size() == 2, "Invalid removal index leaves lists unchanged");
    frame->mutation.changed = 2;
    rejected = false;
    try { (void)keyframe_is_dirty(*frame); } catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected, "Noncanonical bool is explicitly outside the query domain");
    return checks.finish();
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
