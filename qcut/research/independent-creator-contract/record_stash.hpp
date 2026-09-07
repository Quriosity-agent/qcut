#pragma once

#include "record_graph.hpp"

namespace creator_contract {
struct RecordStashIndex {
  RecordGraphPointIndex graph_points;
  std::unordered_map<std::string, std::shared_ptr<RecordPoint>> coordinates;
};

// Null means no replacement snapshot; changed is cumulative across the traversal.
std::shared_ptr<RecordPoint> stash_point(const RecordPoint& current,
                                        const RecordStashIndex& history, bool& changed);
std::shared_ptr<RecordGraphPoint> stash_graph_point(const RecordGraphPoint& current,
                                                   const RecordStashIndex& history, bool& changed);
}  // namespace creator_contract
