#pragma once

#include "../independent-editor-contract/value_state.hpp"
#include "record_list.hpp"

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace creator_contract {
struct RecordGraph;
struct RecordGraphPoint;
using RecordGraphPointIndex = std::unordered_map<std::string, std::shared_ptr<RecordGraphPoint>>;

struct RecordPoint {
  std::string id;
  double x = 0;
  double y = 0;
  editor_contract::MutationState mutation;
};

// Restore copies share the value allocation but independently reconstruct both controls.
struct RecordFrame {
  std::string id;
  std::int32_t curve_type = 0;
  std::int64_t time_offset = 0;
  std::shared_ptr<RecordPoint> left;
  std::shared_ptr<RecordPoint> right;
  std::shared_ptr<std::vector<double>> values;
  std::string string_value;
  editor_contract::MutationState mutation;
  // A legacy capture flag without a typed graph payload is still rejected.
  bool has_graph = false;
  std::shared_ptr<RecordGraph> graph{};
};

using RecordFrameList = RecordNodeList<RecordFrame>;

struct RecordGroup {
  std::string id;
  std::string material_id;
  std::string property;
  RecordFrameList frames;
  editor_contract::MutationState mutation;
};

using RecordFrameIndex = std::unordered_map<std::string, std::shared_ptr<RecordFrame>>;

void restore_point_from(RecordPoint& destination, const RecordPoint* source);
std::shared_ptr<RecordPoint> restore_point_copy(const RecordPoint& source);
void restore_frame_from(RecordFrame& destination, const RecordFrame* source,
                        const RecordGraphPointIndex& graph_points = {});
std::shared_ptr<RecordFrame> restore_frame_copy(const RecordFrame& source,
                                               const RecordGraphPointIndex& graph_points = {});

// The map is an existing identity index: restoration never inserts missing IDs into it.
// Returns the count of clock writes, not the native pointer-encoded timestamp.
std::size_t restore_frame_list(RecordFrameList& destination, const RecordFrameList& source,
                             const RecordFrameIndex& existing, const RecordGraphPointIndex& graph_points = {});
std::size_t restore_group_from(RecordGroup& destination, const RecordGroup* source,
                             const RecordFrameIndex& existing, const RecordGraphPointIndex& graph_points = {});
std::shared_ptr<RecordGroup> restore_group_copy(const RecordGroup& source,
                                               const RecordFrameIndex& existing = {},
                                               const RecordGraphPointIndex& graph_points = {});

}  // namespace creator_contract
