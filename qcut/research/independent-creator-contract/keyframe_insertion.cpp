#include "keyframe_insertion.hpp"

#include "keyframe_controls.hpp"
#include "mutation.hpp"
#include "../independent-editor-contract/window.hpp"
#include "../independent-editor-contract/wrapped_time.hpp"

#include <algorithm>
#include <limits>
#include <stdexcept>
#include <utility>

namespace creator_contract {
namespace {
using detail::mark_changed;

void validate_group(const CommonKeyframeGroup& group) {
  for (const auto& frame : group.keyframes) {
    if (!frame) throw std::invalid_argument("Null frame is outside the insertion domain");
  }
}

void validate_payload(const FilterKeyframePayload& payload) {
  if (payload.fields != 5 || payload.values.empty()) {
    throw std::invalid_argument("Only nonempty numeric time/value insertion payloads are verified");
  }
}
}  // namespace

FilterKeyframePayload filter_insertion_payload(std::int64_t timeline_time, double intensity) {
  return {5, timeline_time, {intensity}};
}

std::vector<double> resize_numeric_keyframe_values(std::span<const double> requested,
                                                  std::size_t existing_size) {
  if (requested.empty()) throw std::invalid_argument("An empty numeric payload is not an assignment");
  if (existing_size > static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max())) {
    throw std::length_error("Existing dimensions exceed the verified signed-32-bit domain");
  }
  std::vector<double> result(requested.begin(), requested.end());
  if (existing_size != 0) result.resize(existing_size, requested.front());
  return result;
}

bool apply_filter_keyframe_payload(CommonKeyframe& frame, const FilterKeyframePayload& payload,
                                   std::int64_t resolved_time) {
  validate_payload(payload);
  auto values = resize_numeric_keyframe_values(payload.values, frame.values.size());
  if (frame.time_offset != resolved_time) {
    frame.time_offset = resolved_time;
    mark_changed(frame.mutation);
  }
  return assign_keyframe_values(frame, values);
}

EnsuredGroup ensure_common_keyframe_group(CommonKeyframeArray& array, std::string property,
                                           std::string material_id) {
  for (const auto& group : array.active) {
    if (group && group->property == property && (material_id.empty() || group->material_id == material_id)) {
      return {group, false, 0};
    }
  }
  auto group = std::make_shared<CommonKeyframeGroup>();
  group->property = std::move(property);
  group->material_id = std::move(material_id);
  if (!group->property.empty() || !group->material_id.empty()) mark_changed(group->mutation);
  array.active.push_back(group);
  group->mutation.tracking = array.track_removed_children ? 1 : 0;
  if (array.track_removed_children) {
    group->mutation.state_code = 1;
  } else {
    mark_changed(group->mutation);
    mark_changed(array.mutation);
  }
  return {group, true, 1};
}

std::shared_ptr<CommonKeyframe> make_filter_keyframe(std::string id, std::int64_t time,
                                                   double intensity) {
  auto frame = std::make_shared<CommonKeyframe>();
  frame->id = std::move(id);
  frame->left_control = std::make_shared<KeyframeControl>();
  frame->right_control = std::make_shared<KeyframeControl>();
  apply_filter_keyframe_payload(*frame, filter_insertion_payload(time, intensity), time);
  return frame;
}

OrderedInsertion insert_keyframe_ordered(CommonKeyframeGroup& group,
                                        const std::shared_ptr<CommonKeyframe>& frame) {
  validate_group(group);
  if (!frame) throw std::invalid_argument("Cannot insert a null keyframe");
  const auto position = std::find_if(group.keyframes.begin(), group.keyframes.end(),
      [&](const auto& existing) { return existing->time_offset > frame->time_offset; });
  const auto index = static_cast<std::size_t>(position - group.keyframes.begin());
  group.keyframes.insert(position, frame);
  frame->mutation.tracking = group.track_inserted_children ? 1 : 0;
  if (group.track_inserted_children) {
    frame->mutation.state_code = 1;
  } else {
    mark_changed(frame->mutation);
    mark_changed(group.list_mutation);
  }
  return {index, 1};
}

ResolvedInsertion add_filter_keyframe_at_resolved_time(CommonKeyframeGroup& group,
    const FilterKeyframePayload& payload, std::int64_t resolved_time, std::string new_id) {
  validate_group(group);
  validate_payload(payload);
  std::vector<std::int64_t> times;
  times.reserve(group.keyframes.size());
  for (const auto& frame : group.keyframes) times.push_back(frame->time_offset);
  const auto window = editor_contract::select_keyframe_window(times,
      {editor_contract::wrapped_difference(resolved_time, 1000),
       editor_contract::wrapped_sum(resolved_time, 1000)});
  std::size_t index = 0;
  std::size_t clocks = 0;
  bool replaced = true;
  if (window.selected) {
    index = *window.selected;
    replaced = apply_filter_keyframe_payload(*group.keyframes[index], payload, resolved_time);
  } else {
    auto frame = make_filter_keyframe(std::move(new_id), resolved_time, payload.values.front());
    // The new native values array is empty before this assignment, so its complete shape survives.
    assign_keyframe_values(*frame, payload.values);
    const auto insertion = insert_keyframe_ordered(group, frame);
    index = insertion.index;
    clocks = insertion.clock_write_events;
  }
  const auto id = group.keyframes[index]->id;
  if (auto* selected = find_keyframe_by_id(group, id)) clear_keyframe_graph(*selected);
  repair_controls_around(group, id);
  return {!window.selected.has_value(), index, replaced, clocks};
}

}  // namespace creator_contract
