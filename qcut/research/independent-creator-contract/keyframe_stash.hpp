#pragma once

#include "graph_tree.hpp"

namespace creator_contract {
// lvve::CommonKeyframe. Every member is a field the record walk actually reads. The graph
// slot is the only child this family null-tests; both controls and the value vector are
// dereferenced unguarded, which is why the validators below reject them instead.
struct StashFrame {
  std::string id;
  std::int32_t curve_type = 0;
  std::int64_t time_offset = 0;
  std::shared_ptr<RecordPoint> left;
  std::shared_ptr<RecordPoint> right;
  // Shared, not owned: a record that keeps the historical payload shares this vector, and a
  // record that replaces it allocates a new one from the current contents.
  std::shared_ptr<std::vector<double>> values;
  std::string string_value;
  std::shared_ptr<GraphRecordTree> graph;
  editor_contract::MutationState mutation;
};

// NodeArray<lvve::CommonKeyframe>. The member set matches GraphPointArray because the two
// are the same class template: after normalising branch targets, the two record walks are
// 412 identical instructions apart from three constants (the array typeinfo, the element
// typeinfo and the element control-block vtable). `suppress_change_flag` is the flag the
// element loop consults before touching the caller's changed output.
struct StashFrameArray {
  std::string id;
  RecordNodeList<StashFrame> nodes;
  bool suppress_change_flag = false;
  // Ownership token only, shared with the record copy; the SDK's process clock is not reproduced.
  std::shared_ptr<RecordArrayClock> clock = std::make_shared<RecordArrayClock>();
  std::array<std::uint64_t, 2> transient{};
};

// lvve::CommonKeyframes. Unlike the graph node it compares no integer field, only its two
// strings, so a platform-style code change cannot be observed at this level.
struct StashGroup {
  std::string id;
  std::string material_id;
  std::string property;
  std::shared_ptr<StashFrameArray> frames;
  editor_contract::MutationState mutation;
};

// One index for the whole family. A present-but-wrong-typed entry is the independent form of
// the native dynamic_cast failing, and std::monostate is the present-but-null entry.
using KeyframeStashEntry =
    std::variant<std::monostate, std::shared_ptr<RecordPoint>, std::shared_ptr<RecordGraphPoint>,
                 std::shared_ptr<GraphPointArray>, std::shared_ptr<GraphRecordTree>,
                 std::shared_ptr<StashFrame>, std::shared_ptr<StashFrameArray>, std::shared_ptr<StashGroup>>;
using KeyframeStashIndex = std::unordered_map<std::string, KeyframeStashEntry>;

template <class T>
std::shared_ptr<T> keyframe_stash_find(const KeyframeStashIndex& index, const std::string& id) {
  const auto entry = index.find(id);
  if (entry == index.end()) return {};
  const auto value = std::get_if<std::shared_ptr<T>>(&entry->second);
  return value ? *value : std::shared_ptr<T>{};
}

void validate_stash_frame(const StashFrame& frame);
void validate_stash_frame_array(const StashFrameArray& array);
void validate_stash_group(const StashGroup& group);
void validate_keyframe_stash_index(const KeyframeStashIndex& index);

// Null means "this subtree produced no record"; `changed` is cumulative across the traversal
// and is the same reference the children write into.
std::shared_ptr<StashFrame> stash_keyframe(const StashFrame& current, const KeyframeStashIndex& history,
                                           bool& changed);
std::shared_ptr<StashFrameArray> stash_keyframe_array(const StashFrameArray& current,
                                                      const KeyframeStashIndex& history, bool& changed);
std::shared_ptr<StashGroup> stash_keyframe_group(const StashGroup& current, const KeyframeStashIndex& history,
                                                 bool& changed);

// The array walk is one class template with two instantiations. This applies the shared
// reconstruction to the graph-point element type so that its agreement with the separately
// written `stash_graph_array` is an executable claim, not a remark in a document. The graph
// stash path itself still goes through `graph_tree.cpp`; this entry point exists for the
// equivalence test and for callers that want the two instances driven from one source.
std::shared_ptr<GraphPointArray> stash_shared_graph_array(const GraphPointArray& current,
                                                          const KeyframeStashIndex& history, bool& changed);
}  // namespace creator_contract
