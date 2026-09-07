#include "common_keyframes.hpp"
#include "mutation.hpp"

#include <algorithm>
#include <stdexcept>

namespace creator_contract {
using detail::mark_changed;

std::vector<double> filter_keyframe_values(const double& intensity) {
  return {intensity};
}

CommonKeyframe* find_keyframe_by_id(CommonKeyframeGroup& group, std::string_view id) noexcept {
  for (const auto& keyframe : group.keyframes) {
    if (keyframe && keyframe->id == id) return keyframe.get();
  }
  return nullptr;
}

void clear_keyframe_graph(CommonKeyframe& keyframe) noexcept {
  keyframe.has_graph = false;
  mark_changed(keyframe.mutation);
}

bool assign_keyframe_values(CommonKeyframe& keyframe, const std::vector<double>& values) {
  if (keyframe.values.size() == values.size() &&
      std::equal(keyframe.values.begin(), keyframe.values.end(), values.begin())) return false;
  auto replacement = values;
  keyframe.values.swap(replacement);
  mark_changed(keyframe.mutation);
  return true;
}

void prepare_common_keyframe_clear(CommonKeyframeArray& array) {
  for (const auto& group : array.active) {
    if (!group) throw std::invalid_argument("Null common-keyframe group is outside the verified reset domain");
  }
  if (array.active.size() > array.retained.max_size() - array.retained.size()) {
    throw std::length_error("Retained common-keyframe list exceeds capacity");
  }
  array.retained.reserve(array.retained.size() + array.active.size());
}

std::size_t clear_common_keyframes(CommonKeyframeArray& array) {
  prepare_common_keyframe_clear(array);
  const auto removed = array.active.size();
  for (const auto& group : array.active) {
    if (array.track_removed_children && group->mutation.tracking != 0) {
      group->mutation.state_code = 3;
    }
    array.retained.push_back(group);
    mark_changed(array.mutation);
  }
  array.active.clear();
  return removed;
}

}  // namespace creator_contract
