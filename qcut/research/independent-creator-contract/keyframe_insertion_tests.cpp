#include "keyframe_insertion.hpp"
#include "keyframe_controls.hpp"
#include "test_support.hpp"

#include <array>
#include <limits>

using namespace creator_contract;

int main() {
  try {
    Checks checks;
    const double nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000001234});
    for (double value : {0.0, -0.0, 0.37, -2.0, 10.0, nan,
                         std::numeric_limits<double>::infinity()}) {
      const auto payload = filter_insertion_payload(-42, value);
      checks.require(payload.fields == 5 && payload.timeline_time == -42 && payload.values.size() == 1,
                     "The insertion constant is the time/value bitmask");
      checks.same_bits(payload.values[0], value, "Raw payload bits survive");
      const auto expanded = resize_numeric_keyframe_values(payload.values, 3);
      for (double component : expanded) checks.same_bits(component, value, "Scalar broadcasts to existing shape");
      auto frame = make_filter_keyframe("new", 10, value);
      checks.require(frame->curve_type == 0 && !frame->has_graph && frame->left_control && frame->right_control,
                     "Fresh native frame defaults: curve zero, two points, no graph");
      checks.same_bits(frame->values[0], value, "Fresh values retain bit pattern");
    }
    checks.require(resize_numeric_keyframe_values(std::array{1.0, 2.0, 3.0}, 2) == std::vector{1.0, 2.0},
                   "Existing dimensions truncate extra requested channels");
    checks.require(resize_numeric_keyframe_values(std::array{1.0, 2.0}, 4) == std::vector{1.0, 2.0, 1.0, 1.0},
                   "Padding copies first requested channel, not the last");
    checks.require(resize_numeric_keyframe_values(std::array{1.0, 2.0}, 0) == std::vector{1.0, 2.0},
                   "Empty existing array adopts complete payload shape");

    CommonKeyframeArray groups;
    groups.active.push_back(nullptr);
    auto created = ensure_common_keyframe_group(groups, "KFTypeFilter", "material-a");
    checks.require(created.created && created.clock_write_events == 1 && groups.active.size() == 2,
                   "Missing group appends after existing slots, including null");
    checks.require(created.group->keyframes.empty() && created.group->mutation.changed == 1 &&
                       groups.mutation.changed == 1, "Fresh group has empty list and append bookkeeping");
    auto property_only = ensure_common_keyframe_group(groups, "KFTypeFilter", "");
    checks.require(!property_only.created && property_only.group == created.group,
                   "Empty requested material ignores existing material ID");
    auto different_material = ensure_common_keyframe_group(groups, "KFTypeFilter", "material-b");
    checks.require(different_material.created && different_material.group != created.group,
                   "Nonempty requested material requires both key components");
    auto repeated = ensure_common_keyframe_group(groups, "KFTypeFilter", "material-b");
    checks.require(!repeated.created && repeated.clock_write_events == 0 && repeated.group == different_material.group,
                   "Existing group is reused without an append event");
    CommonKeyframeArray tracked_groups;
    tracked_groups.track_removed_children = true;
    auto tracked_group = ensure_common_keyframe_group(tracked_groups, "KFTypeFilter", "");
    checks.require(tracked_group.group->mutation == editor_contract::MutationState{1, 1, 1} &&
                       tracked_groups.mutation == editor_contract::MutationState{},
                   "Tracked new group gets code one while container remains clean");

    CommonKeyframeGroup group;
    group.property = "KFTypeFilter";
    auto first = make_filter_keyframe("first", 10, 0.1);
    auto last = make_filter_keyframe("last", 30, 0.3);
    auto equal = make_filter_keyframe("equal", 10, 0.2);
    group.keyframes = {first, last};
    const auto ordered = insert_keyframe_ordered(group, equal);
    checks.require(ordered.index == 1 && ordered.clock_write_events == 1,
                   "Equal times insert after existing equals and write one clock event");
    checks.require(group.keyframes == std::vector{first, equal, last}, "Insertion preserves object identity and order");
    checks.require(group.list_mutation.changed == 1 && equal->mutation.changed == 1,
                   "Untracked append dirties list and inserted frame");

    CommonKeyframeGroup tracked;
    tracked.track_inserted_children = true;
    auto tracked_frame = make_filter_keyframe("tracked", 0, 0.5);
    tracked_frame->mutation = {0, 7, 0};
    insert_keyframe_ordered(tracked, tracked_frame);
    checks.require(tracked_frame->mutation == editor_contract::MutationState{1, 1, 0} &&
                       tracked.list_mutation == editor_contract::MutationState{},
                   "Tracked insertion records code one without dirtying the list");

    for (const auto offset : {-1001LL, -1000LL, 0LL, 1000LL, 1001LL}) {
      CommonKeyframeGroup test;
      auto existing = make_filter_keyframe("existing", 10000, 0.1);
      existing->values = {0.1, 0.2, 0.3};
      existing->has_graph = true;
      existing->curve_type = 3;
      test.keyframes = {existing};
      const auto result = add_filter_keyframe_at_resolved_time(test,
          filter_insertion_payload(999999, 0.7), 10000 + offset, "created");
      const bool expected_insert = offset == -1001 || offset == 1001;
      checks.require(result.inserted == expected_insert, "Collision radius is exactly inclusive 1000");
      checks.require(test.keyframes.size() == (expected_insert ? 2U : 1U), "Collision changes correct list size");
      const auto& target = test.keyframes[result.index];
      checks.require(target->time_offset == 10000 + offset && !target->has_graph,
                     "Resolved time replaces request timeline time and target graph is cleared");
      if (!expected_insert) {
        checks.require(target == existing && existing->curve_type == 3, "Collision keeps identity and curve");
        checks.require(existing->values == std::vector{0.7, 0.7, 0.7}, "Collision preserves dimensions");
      }
    }
    CommonKeyframeGroup duplicate_ids;
    auto earlier = make_filter_keyframe("dup", -10000, 0.1);
    earlier->has_graph = true;
    duplicate_ids.keyframes = {earlier};
    const auto duplicate_result = add_filter_keyframe_at_resolved_time(duplicate_ids,
        filter_insertion_payload(10000, 0.5), 10000, "dup");
    checks.require(duplicate_result.inserted && !earlier->has_graph,
                   "Post-insertion ID lookup clears first matching ID, without deduplication");

    auto preserved = make_filter_keyframe("preserved", 123, 0.25);
    auto invalid = filter_insertion_payload(1, 0.8);
    invalid.fields = 7;
    bool rejected = false;
    try { apply_filter_keyframe_payload(*preserved, invalid, 456); }
    catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected && preserved->time_offset == 123 && preserved->values == std::vector{0.25},
                   "Unsupported fields reject before mutation");
    rejected = false;
    try { (void)resize_numeric_keyframe_values({}, 2); }
    catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected, "Empty numeric assignment requires a separate fallback path");
    rejected = false;
    try { (void)resize_numeric_keyframe_values(std::array{1.0},
          static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max()) + 1); }
    catch (const std::length_error&) { rejected = true; }
    checks.require(rejected, "Dimensions beyond native signed int gate fail before allocation");
    CommonKeyframeGroup nulls;
    nulls.keyframes = {nullptr};
    rejected = false;
    try { insert_keyframe_ordered(nulls, preserved); }
    catch (const std::invalid_argument&) { rejected = true; }
    checks.require(rejected && nulls.keyframes.size() == 1 && nulls.keyframes[0] == nullptr,
                   "Malformed list rejects without mutation");
    return checks.finish();
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
