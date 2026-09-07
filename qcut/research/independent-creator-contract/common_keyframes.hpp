#pragma once

#include "../independent-editor-contract/value_state.hpp"

#include <memory>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace creator_contract {

struct KeyframeControl {
  double x = 0;
  double y = 0;
  editor_contract::MutationState mutation;
};

struct CommonKeyframe {
  std::string id;
  std::vector<double> values;
  bool has_graph = false;
  editor_contract::MutationState mutation;
  std::int64_t time_offset = 0;
  std::int32_t curve_type = 0;
  std::shared_ptr<KeyframeControl> left_control = {};
  std::shared_ptr<KeyframeControl> right_control = {};
};

struct CommonKeyframeGroup {
  std::string property;
  std::vector<std::shared_ptr<CommonKeyframe>> keyframes;
  editor_contract::MutationState mutation;
  std::string material_id = {};
  bool track_inserted_children = false;
  editor_contract::MutationState list_mutation = {};
};

struct CommonKeyframeArray {
  std::vector<std::shared_ptr<CommonKeyframeGroup>> active;
  std::vector<std::shared_ptr<CommonKeyframeGroup>> retained;
  bool track_removed_children = false;
  editor_contract::MutationState mutation;
};

std::vector<double> filter_keyframe_values(const double& intensity);
CommonKeyframe* find_keyframe_by_id(CommonKeyframeGroup& group, std::string_view id) noexcept;
void clear_keyframe_graph(CommonKeyframe& keyframe) noexcept;
bool assign_keyframe_values(CommonKeyframe& keyframe, const std::vector<double>& values);

void prepare_common_keyframe_clear(CommonKeyframeArray& array);

// Returns the number of native clock-write events; the pointer-encoded clock is not reproduced.
std::size_t clear_common_keyframes(CommonKeyframeArray& array);

}  // namespace creator_contract
