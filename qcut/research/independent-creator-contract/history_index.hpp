#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace creator_contract {
// The seven node classes the history walk reaches. The kind alone selects which children
// are visited; no other field of a node takes part in the traversal.
enum class HistoryNodeKind : std::uint8_t {
  point,              // lvve::CommonPoint, a leaf with no walked child
  keyframe,           // lvve::CommonKeyframe: left control, right control, optional graph
  keyframe_array,     // NodeArray<lvve::CommonKeyframe>
  keyframes,          // lvve::CommonKeyframes, holding the keyframe array
  graph,              // lvve::Graph, holding the graph-point array
  graph_point_array,  // GraphPointArray
  graph_point,        // lvve::GraphPoint, holding its coordinate
};

// One reconstructed node of the walked family. `retained` is carried so that its exclusion
// from the traversal stays observable, not so that it can be traversed.
struct HistoryNode {
  HistoryNodeKind kind = HistoryNodeKind::point;
  // The inserted key is a view over these bytes. Empty IDs, embedded NUL and IDs long
  // enough to leave the short-string form are all inside the domain.
  std::string id;
  // Fixed children in visit order: a keyframe's left control, right control and graph
  // slot, or the single array/coordinate the other non-leaf kinds hold. Only a keyframe's
  // graph slot may be null.
  std::vector<std::shared_ptr<HistoryNode>> slots;
  // Array storage. The walk reads `active` only; `retained` is never loaded.
  std::vector<std::shared_ptr<HistoryNode>> active;
  std::vector<std::shared_ptr<HistoryNode>> retained;
};

// Keys are views over the inserted node's own `id`; the mapped strong reference is what
// keeps those bytes alive after the parent is released. Changing an inserted node's `id`
// afterwards leaves the recorded key behind and is outside this contract.
using HistoryIndex = std::unordered_map<std::string_view, std::shared_ptr<HistoryNode>>;

// QCut boundary policy: every slot other than a keyframe's graph, and every active list
// entry, is dereferenced by the native walk with no null test, so a null is rejected here
// instead of reproducing the crash. Retained entries are checked for shape but not
// traversed, because the walk never loads them.
void validate_history_node(const HistoryNode& root);

// Accumulates into the caller's map, which may already hold entries. The root never
// inserts itself, an already present key keeps its mapped node and its own key bytes, and
// retained children are never visited.
void collect_history_nodes(const HistoryNode& root, HistoryIndex& index);

// The same spine with no insertion anywhere in this family. That is what makes an empty
// escape map a proven boundary rather than an assumption; it is not a recovered selection
// rule, and for these seven classes both calls are observably inert.
void collect_escape_history_nodes(const HistoryNode& root, HistoryIndex& index);
void assign_escape_history_nodes(const HistoryNode& root, const HistoryIndex& index);
}  // namespace creator_contract
