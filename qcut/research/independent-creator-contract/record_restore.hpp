#pragma once

#include "../independent-editor-contract/value_state.hpp"

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace creator_contract {

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
  bool has_graph = false;
};

struct RecordFrameList {
  std::vector<std::shared_ptr<RecordFrame>> active;
  std::vector<std::shared_ptr<RecordFrame>> retained;
  editor_contract::MutationState mutation;
  bool track_children = false;
};

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
void restore_frame_from(RecordFrame& destination, const RecordFrame* source);
std::shared_ptr<RecordFrame> restore_frame_copy(const RecordFrame& source);

// The map is an existing identity index: restoration never inserts missing IDs into it.
// Returns the count of clock writes, not the native pointer-encoded timestamp.
std::size_t restore_frame_list(RecordFrameList& destination, const RecordFrameList& source,
                             const RecordFrameIndex& existing);
std::size_t restore_group_from(RecordGroup& destination, const RecordGroup* source,
                             const RecordFrameIndex& existing);

}  // namespace creator_contract
