#include "graph_tree.hpp"

#include <stdexcept>
#include <unordered_set>

namespace creator_contract {
namespace {
void validate_point(const std::shared_ptr<RecordGraphPoint>& point) {
  if (!point || !point->point) throw std::invalid_argument("Graph tree needs nonnull points and coordinates");
}
std::shared_ptr<RecordGraphPoint> deep_point(const RecordGraphPoint& point) {
  auto copy = std::make_shared<RecordGraphPoint>(point);
  copy->point = std::make_shared<RecordPoint>(*point.point);
  return copy;
}
std::shared_ptr<GraphPointArray> deep_array(const GraphPointArray& source) {
  auto result = std::make_shared<GraphPointArray>(source);
  result->nodes.active.clear(); result->nodes.retained.clear();
  result->nodes.mutation.tracking = 0;
  result->clock = std::make_shared<RecordArrayClock>();
  result->transient = {};
  for (const auto& point : source.nodes.active) result->nodes.active.push_back(deep_point(*point));
  for (const auto& point : source.nodes.retained) result->nodes.retained.push_back(deep_point(*point));
  return result;
}
RecordStashIndex point_history(const GraphTreeIndex& history) {
  RecordStashIndex result;
  for (const auto& [key, value] : history) {
    if (const auto point = std::get_if<std::shared_ptr<RecordGraphPoint>>(&value)) result.graph_points[key] = *point;
    if (const auto point = std::get_if<std::shared_ptr<RecordPoint>>(&value)) result.coordinates[key] = *point;
  }
  return result;
}
}

void validate_graph_array(const GraphPointArray& array) {
  constexpr std::size_t budget = 1U << 20;
  if (array.nodes.active.size() > budget || array.nodes.retained.size() > budget) {
    throw std::length_error("Graph tree list exceeds the independent budget");
  }
  if (!array.clock) throw std::invalid_argument("Graph tree requires a clock ownership token");
  for (const auto& point : array.nodes.active) validate_point(point);
  for (const auto& point : array.nodes.retained) validate_point(point);
}
void validate_graph_tree(const GraphRecordTree& tree) {
  if (!tree.points) throw std::invalid_argument("Graph tree requires an array");
  validate_graph_array(*tree.points);
}
void validate_graph_tree_index(const GraphTreeIndex& index) {
  if (index.size() > (1U << 20)) throw std::length_error("Graph index exceeds the independent budget");
  for (const auto& [key, value] : index) {
    (void)key;
    if (const auto tree = std::get_if<std::shared_ptr<GraphRecordTree>>(&value); tree && *tree) validate_graph_tree(**tree);
    if (const auto array = std::get_if<std::shared_ptr<GraphPointArray>>(&value); array && *array) validate_graph_array(**array);
    if (const auto point = std::get_if<std::shared_ptr<RecordGraphPoint>>(&value); point && *point) validate_point(*point);
  }
}

std::shared_ptr<GraphPointArray> stash_graph_array(const GraphPointArray& current,
    const GraphTreeIndex& history, bool& changed) {
  validate_graph_array(current); validate_graph_tree_index(history);
  std::unordered_set<std::string> previous_ids;
  if (const auto previous = graph_tree_find<GraphPointArray>(history, current.id)) {
    for (const auto& point : previous->nodes.active) previous_ids.insert(point->id);
  }
  const auto points = point_history(history);
  std::vector<std::shared_ptr<RecordGraphPoint>> active;
  active.reserve(current.nodes.active.size());
  bool replacement = false;
  for (const auto& point : current.nodes.active) {
    bool child_changed = false;
    auto child = stash_graph_point(*point, points, child_changed);
    if (child) {
      active.push_back(std::move(child));
      replacement = true;
      if (!current.suppress_change_flag && child_changed) changed = true;
      continue;
    }
    if (auto previous = graph_tree_find<RecordGraphPoint>(history, point->id)) {
      active.push_back(previous);
      if (previous_ids.contains(previous->id)) continue;
    } else active.push_back(deep_point(*point));
    replacement = true;
    if (!current.suppress_change_flag) changed = true;
  }
  if (!replacement && current.nodes.retained.empty()) return {};
  auto result = std::make_shared<GraphPointArray>(current);
  result->nodes.active = std::move(active);
  result->transient = {};
  if (!current.suppress_change_flag && !current.nodes.retained.empty()) changed = true;
  return result;
}

std::shared_ptr<GraphRecordTree> stash_graph_tree(const GraphRecordTree& current,
    const GraphTreeIndex& history, bool& changed) {
  validate_graph_tree(current); validate_graph_tree_index(history);
  const auto previous = graph_tree_find<GraphRecordTree>(history, current.id);
  if (!previous) {
    auto result = std::make_shared<GraphRecordTree>(current);
    result->points = deep_array(*current.points);
    changed = true;
    return result;
  }
  auto shallow = [&] {
    auto result = std::make_shared<GraphRecordTree>(*previous);
    result->mutation.state_code = current.mutation.state_code;
    result->mutation.changed = current.mutation.changed;
    return result;
  };
  std::shared_ptr<GraphRecordTree> result;
  if (current.mutation.changed) { result = shallow(); changed = true; }
  auto update = [&](const auto& value, const auto& prior, auto member) {
    if (value == prior) return;
    if (!result) result = shallow();
    result.get()->*member = value;
    changed = true;
  };
  update(current.resource_id, previous->resource_id, &GraphRecordTree::resource_id);
  update(current.resource_name, previous->resource_name, &GraphRecordTree::resource_name);
  update(current.source_platform, previous->source_platform, &GraphRecordTree::source_platform);
  if (auto points = stash_graph_array(*current.points, history, changed)) {
    if (!result) result = shallow();
    result->points = std::move(points);
  }
  return result;
}
}  // namespace creator_contract
