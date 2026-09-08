#pragma once

#include "graph_tree.hpp"

namespace creator_contract {
struct GraphDiffRequest {
  GraphTreeIndex& before;
  GraphTreeIndex& after;
  GraphTreeIndex& replacements;
  GraphTreeIndex& shared;
  bool& replaced;
  bool& replace_shared;
};
// Scalar writes preserve mutation flags; missing shared keys can be inserted as null.
void restore_graph_tree_diff(GraphRecordTree& current, const GraphDiffRequest& request);
void restore_graph_array_diff(GraphPointArray& current, const GraphDiffRequest& request);
void restore_graph_point_diff(RecordGraphPoint& current, const GraphDiffRequest& request);
void restore_coordinate_diff(RecordPoint& current, const GraphDiffRequest& request);
}  // namespace creator_contract
