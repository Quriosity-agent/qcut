#pragma once

#include "record_restore.hpp"

namespace creator_contract {
struct RecordGraphPoint {
  std::string id;
  std::int32_t type = 0;
  std::shared_ptr<RecordPoint> point;
  editor_contract::MutationState mutation;
};

struct RecordGraphMetadata {
  std::string id;
  std::string resource_id;
  std::string resource_name;
  std::int32_t source_platform = 0;
  editor_contract::MutationState mutation;
};

struct RecordGraph : RecordGraphMetadata {
  RecordNodeList<RecordGraphPoint> points;
};

void validate_graph_record(const RecordGraph& graph, const RecordGraphPointIndex& existing = {});
void restore_graph_point_from(RecordGraphPoint& destination, const RecordGraphPoint* source);
std::shared_ptr<RecordGraphPoint> restore_graph_point_copy(const RecordGraphPoint& source);
std::size_t restore_graph_from(RecordGraph& destination, const RecordGraph* source,
                              const RecordGraphPointIndex& existing = {});
std::shared_ptr<RecordGraph> restore_graph_copy(const RecordGraph& source,
                                              const RecordGraphPointIndex& existing = {});
}  // namespace creator_contract
