#pragma once

#include "record_stash.hpp"

#include <array>
#include <variant>

namespace creator_contract {
// Ownership token only; generating the SDK's process clock is outside this contract.
struct RecordArrayClock {};
struct GraphPointArray {
  std::string id;
  RecordNodeList<RecordGraphPoint> nodes;
  bool suppress_change_flag = false;
  std::shared_ptr<RecordArrayClock> clock = std::make_shared<RecordArrayClock>();
  std::array<std::uint64_t, 2> transient{};
};
struct GraphRecordTree : RecordGraphMetadata {
  std::shared_ptr<GraphPointArray> points;
};

using GraphTreeEntry = std::variant<std::monostate, std::shared_ptr<RecordPoint>,
    std::shared_ptr<RecordGraphPoint>, std::shared_ptr<GraphPointArray>, std::shared_ptr<GraphRecordTree>>;
using GraphTreeIndex = std::unordered_map<std::string, GraphTreeEntry>;

template <class T> std::shared_ptr<T> graph_tree_find(const GraphTreeIndex& index, const std::string& id) {
  const auto entry = index.find(id);
  if (entry == index.end()) return {};
  const auto value = std::get_if<std::shared_ptr<T>>(&entry->second);
  return value ? *value : std::shared_ptr<T>{};
}

void validate_graph_tree(const GraphRecordTree& tree);
void validate_graph_array(const GraphPointArray& array);
void validate_graph_tree_index(const GraphTreeIndex& index);

std::shared_ptr<GraphPointArray> stash_graph_array(const GraphPointArray& current,
    const GraphTreeIndex& history, bool& changed);
std::shared_ptr<GraphRecordTree> stash_graph_tree(const GraphRecordTree& current,
    const GraphTreeIndex& history, bool& changed);
}  // namespace creator_contract
