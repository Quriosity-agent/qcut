#include "history_index.hpp"

#include <stdexcept>

namespace creator_contract {
namespace {
constexpr std::size_t kListBudget = 1U << 20;

bool is_array(HistoryNodeKind kind) noexcept {
  return kind == HistoryNodeKind::keyframe_array || kind == HistoryNodeKind::graph_point_array;
}

void validate_node(const HistoryNode& node);

// `nullable` is true only for a keyframe's graph slot, the single gate the walk contains.
void validate_slot(const std::shared_ptr<HistoryNode>& child, HistoryNodeKind expected, bool nullable) {
  if (!child) {
    if (nullable) return;
    throw std::invalid_argument("The history walk dereferences this child without a null test");
  }
  if (child->kind != expected) throw std::invalid_argument("History child has the wrong node kind");
  validate_node(*child);
}

void validate_slots(const HistoryNode& node) {
  const auto count = [&node](std::size_t expected) {
    if (node.slots.size() != expected) throw std::invalid_argument("History node slot count differs");
  };
  switch (node.kind) {
    case HistoryNodeKind::point:
    case HistoryNodeKind::keyframe_array:
    case HistoryNodeKind::graph_point_array:
      count(0);
      return;
    case HistoryNodeKind::keyframe:
      count(3);
      validate_slot(node.slots[0], HistoryNodeKind::point, false);
      validate_slot(node.slots[1], HistoryNodeKind::point, false);
      validate_slot(node.slots[2], HistoryNodeKind::graph, true);
      return;
    case HistoryNodeKind::keyframes:
      count(1);
      validate_slot(node.slots[0], HistoryNodeKind::keyframe_array, false);
      return;
    case HistoryNodeKind::graph:
      count(1);
      validate_slot(node.slots[0], HistoryNodeKind::graph_point_array, false);
      return;
    case HistoryNodeKind::graph_point:
      count(1);
      validate_slot(node.slots[0], HistoryNodeKind::point, false);
      return;
  }
  throw std::invalid_argument("Unknown history node kind");
}

void validate_node(const HistoryNode& node) {
  validate_slots(node);
  if (!is_array(node.kind)) {
    if (!node.active.empty() || !node.retained.empty()) {
      throw std::invalid_argument("Only the two array levels carry node lists");
    }
    return;
  }
  if (node.active.size() > kListBudget || node.retained.size() > kListBudget) {
    throw std::length_error("History node list exceeds the independent budget");
  }
  const auto child_kind = node.kind == HistoryNodeKind::keyframe_array ? HistoryNodeKind::keyframe
                                                                      : HistoryNodeKind::graph_point;
  for (const auto& child : node.active) validate_slot(child, child_kind, false);
  // Retained entries must still be shaped like children of this array, but the walk never
  // loads the retained vector, so their own subtrees are not inspected here.
  for (const auto& child : node.retained) {
    if (!child) throw std::invalid_argument("Null retained history child");
    if (child->kind != child_kind) throw std::invalid_argument("Retained history child has the wrong node kind");
  }
}

void insert_child(const std::shared_ptr<HistoryNode>& child, HistoryIndex& index) {
  // libc++ builds the mapped strong copy before probing the bucket and destroys it again
  // when an equal key is already present, so a duplicate leaves the stored entry, the
  // stored key bytes and every reference count untouched.
  index.emplace(std::string_view(child->id), child);
}

void walk_all(const HistoryNode& node, HistoryIndex& index) {
  for (const auto& child : node.slots) {
    if (!child) continue;  // only a keyframe's graph slot reaches this
    insert_child(child, index);
    walk_all(*child, index);
  }
  for (const auto& child : node.active) {
    insert_child(child, index);
    walk_all(*child, index);
  }
}

// The escape hooks walk the identical spine and insert nothing, so the map is carried
// through unchanged rather than ignored.
template <class Index> void walk_escape(const HistoryNode& node, Index& index) {
  for (const auto& child : node.slots) {
    if (!child) continue;
    walk_escape(*child, index);
  }
  for (const auto& child : node.active) walk_escape(*child, index);
}
}  // namespace

void validate_history_node(const HistoryNode& root) { validate_node(root); }

void collect_history_nodes(const HistoryNode& root, HistoryIndex& index) {
  validate_node(root);
  if (index.size() > kListBudget) throw std::length_error("History index exceeds the independent budget");
  walk_all(root, index);
}

void collect_escape_history_nodes(const HistoryNode& root, HistoryIndex& index) {
  validate_node(root);
  walk_escape(root, index);
}

void assign_escape_history_nodes(const HistoryNode& root, const HistoryIndex& index) {
  validate_node(root);
  walk_escape(root, index);
}
}  // namespace creator_contract
