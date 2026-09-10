#include "history_index.hpp"
#include "test_support.hpp"

#include <algorithm>
#include <string>
#include <vector>

namespace {
using namespace creator_contract;

std::shared_ptr<HistoryNode> make(HistoryNodeKind kind, std::string id) {
  auto node = std::make_shared<HistoryNode>();
  node->kind = kind;
  node->id = std::move(id);
  return node;
}
std::shared_ptr<HistoryNode> point(std::string id) { return make(HistoryNodeKind::point, std::move(id)); }
std::shared_ptr<HistoryNode> keyframe(std::string id, std::shared_ptr<HistoryNode> left,
                                      std::shared_ptr<HistoryNode> right,
                                      std::shared_ptr<HistoryNode> graph_value = {}) {
  auto node = make(HistoryNodeKind::keyframe, std::move(id));
  node->slots = {std::move(left), std::move(right), std::move(graph_value)};
  return node;
}
std::shared_ptr<HistoryNode> graph_point(std::string id, std::shared_ptr<HistoryNode> coordinate) {
  auto node = make(HistoryNodeKind::graph_point, std::move(id));
  node->slots = {std::move(coordinate)};
  return node;
}
std::shared_ptr<HistoryNode> array(HistoryNodeKind kind, std::string id,
                                   std::vector<std::shared_ptr<HistoryNode>> active) {
  auto node = make(kind, std::move(id));
  node->active = std::move(active);
  return node;
}
std::shared_ptr<HistoryNode> holder(HistoryNodeKind kind, std::string id, std::shared_ptr<HistoryNode> child) {
  auto node = make(kind, std::move(id));
  node->slots = {std::move(child)};
  return node;
}
std::shared_ptr<HistoryNode> graph(std::string id, std::vector<std::shared_ptr<HistoryNode>> points) {
  return holder(HistoryNodeKind::graph, id,
                array(HistoryNodeKind::graph_point_array, id + "-points", std::move(points)));
}
std::shared_ptr<HistoryNode> group(std::string id, std::vector<std::shared_ptr<HistoryNode>> frames) {
  return holder(HistoryNodeKind::keyframes, id,
                array(HistoryNodeKind::keyframe_array, id + "-frames", std::move(frames)));
}

const std::shared_ptr<HistoryNode>& at(const HistoryIndex& index, std::string_view key) {
  const auto found = index.find(key);
  if (found == index.end()) throw std::runtime_error("Expected history key is absent: " + std::string(key));
  return found->second;
}
bool keyed_by(const HistoryIndex& index, std::string_view key, const HistoryNode& owner) {
  const auto found = index.find(key);
  return found != index.end() && found->first.data() == owner.id.data() &&
         found->first.size() == owner.id.size();
}
std::vector<std::string> sorted_keys(const HistoryIndex& index) {
  std::vector<std::string> keys;
  keys.reserve(index.size());
  for (const auto& [key, value] : index) {
    (void)value;
    keys.emplace_back(key);
  }
  std::sort(keys.begin(), keys.end());
  return keys;
}

void spine_checks(Checks& checks) {
  const auto left = point("left"), right = point("right"), coordinate = point("coordinate");
  const auto attached = graph("graph", {graph_point("gp", coordinate)});
  const auto frame = keyframe("frame", left, right, attached);
  const auto whole = group("group", {frame});
  HistoryIndex index;
  collect_history_nodes(*whole, index);
  checks.require(index.size() == 8, "Group walk reaches every descendant exactly once");
  checks.require(index.find("group") == index.end(), "The walked root never inserts itself");
  checks.require(at(index, "group-frames") == whole->slots[0], "The group inserts its own keyframe array");
  checks.require(at(index, "frame") == frame && at(index, "left") == left, "Array elements and controls are inserted");
  checks.require(at(index, "right") == right && at(index, "graph") == attached, "The right control and graph are inserted");
  checks.require(at(index, "graph-points") == attached->slots[0], "The graph inserts its point array");
  checks.require(at(index, "gp") != nullptr && at(index, "coordinate") == coordinate, "Graph points and coordinates are inserted");

  HistoryIndex leaf;
  collect_history_nodes(*coordinate, leaf);
  checks.require(leaf.empty(), "A coordinate walk inserts nothing");

  HistoryIndex without_graph;
  const auto bare = keyframe("bare", point("bl"), point("br"));
  collect_history_nodes(*bare, without_graph);
  checks.require(without_graph.size() == 2 && without_graph.find("bare") == without_graph.end(),
                 "A null graph slot is skipped without inserting a placeholder");

  HistoryIndex from_frame;
  collect_history_nodes(*frame, from_frame);
  checks.require(sorted_keys(from_frame) ==
                     std::vector<std::string>{"coordinate", "gp", "graph", "graph-points", "left", "right"},
                 "A keyframe root reaches both controls and the whole graph subtree");
}

void duplicate_checks(Checks& checks) {
  // Two distinct objects that share an ID: only the first visited one is stored.
  const auto first = point("shared"), second = point("shared");
  const auto frame = keyframe("frame", first, second);
  HistoryIndex index;
  const auto before_first = first.use_count(), before_second = second.use_count();
  collect_history_nodes(*frame, index);
  checks.require(index.size() == 1 && at(index, "shared") == first, "The left control wins the shared key");
  checks.require(keyed_by(index, "shared", *first), "The stored key views the winning node's own ID");
  checks.require(first.use_count() == before_first + 1, "An adopted insert takes one strong reference");
  checks.require(second.use_count() == before_second, "A rejected duplicate leaves the reference count alone");

  // A duplicate that straddles the control slots and the graph subtree.
  const auto coordinate = point("shared");
  const auto attached = graph("graph", {graph_point("gp", coordinate)});
  const auto crossing = keyframe("crossing", first, point("other"), attached);
  HistoryIndex across;
  collect_history_nodes(*crossing, across);
  checks.require(at(across, "shared") == first && keyed_by(across, "shared", *first),
                 "Controls are visited before the graph, so a control wins a crossing key");

  // The same duplicate reached in the opposite order through a graph-only root.
  HistoryIndex graph_first;
  collect_history_nodes(*attached, graph_first);
  checks.require(at(graph_first, "shared") == coordinate, "Without a competing control the coordinate wins");

  // A pre-populated map keeps both its entry and its own key storage.
  const std::string seeded = "shared";
  const auto planted = point("planted");
  HistoryIndex accumulated{{std::string_view(seeded), planted}};
  collect_history_nodes(*frame, accumulated);
  checks.require(accumulated.size() == 1 && at(accumulated, "shared") == planted, "A pre-seeded entry is not overwritten");
  checks.require(accumulated.find("shared")->first.data() == seeded.data(), "A pre-seeded key keeps the caller's bytes");

  // Duplicate frames inside one array, and a repeated element.
  const auto twin = keyframe("frame", point("twin-left"), point("twin-right"));
  const auto list = group("group", {frame, twin, frame});
  HistoryIndex ordered;
  collect_history_nodes(*list, ordered);
  checks.require(at(ordered, "frame") == frame, "The first array occurrence wins the frame key");
  checks.require(ordered.find("twin-left") != ordered.end(), "A losing frame is still recursed into");
  checks.require(sorted_keys(ordered) ==
                     std::vector<std::string>{"frame", "group-frames", "shared", "twin-left", "twin-right"},
                 "Repeating one element adds no key beyond its own subtree");

  // Array order is observable only through a collision, so both arrangements are asserted.
  HistoryIndex forward, backward;
  collect_history_nodes(*group("group", {frame, twin}), forward);
  collect_history_nodes(*group("group", {twin, frame}), backward);
  checks.require(at(forward, "frame") == frame, "The leading array element wins the shared frame key");
  checks.require(at(backward, "frame") == twin, "Swapping the two elements swaps the winner");
  checks.require(at(forward, "shared") == first && at(backward, "shared") == first,
                 "The losing frame's subtree is still walked after the winner's");
  checks.require(sorted_keys(forward) == sorted_keys(backward), "Reordering changes the winner, not the key set");
}

void list_checks(Checks& checks) {
  const auto live = keyframe("live", point("live-left"), point("live-right"));
  const auto removed = keyframe("removed", point("removed-left"), point("removed-right"));
  const auto whole = group("group", {live});
  whole->slots[0]->retained = {removed, live};
  HistoryIndex index;
  collect_history_nodes(*whole, index);
  checks.require(sorted_keys(index) ==
                     std::vector<std::string>{"group-frames", "live", "live-left", "live-right"},
                 "Retained children are never visited");
  checks.require(removed.use_count() == 2, "A retained-only child takes no reference from the walk");

  const auto empty = group("empty", {});
  HistoryIndex none;
  collect_history_nodes(*empty, none);
  checks.require(none.size() == 1 && at(none, "empty-frames") == empty->slots[0],
                 "An empty array is still inserted by its owner");

  const auto points = graph("graph", {});
  HistoryIndex empty_graph;
  collect_history_nodes(*points, empty_graph);
  checks.require(empty_graph.size() == 1, "An empty graph inserts only its point array");
}

void identifier_checks(Checks& checks) {
  const std::string embedded("a\0b", 3);
  const std::string wide(200, 'w');  // long enough to leave the short-string form
  const auto blank = point(""), nul = point(embedded), heap = point(wide);
  const auto frame = keyframe("frame", blank, nul);
  const auto whole = group("group", {frame, keyframe("second", heap, point("tail"))});
  HistoryIndex index;
  collect_history_nodes(*whole, index);
  checks.require(index.find("") != index.end() && at(index, "") == blank, "An empty ID is a usable key");
  checks.require(at(index, std::string_view(embedded)) == nul, "An embedded NUL is part of the key");
  checks.require(index.find("a") == index.end(), "The key is not truncated at the first NUL");
  checks.require(at(index, wide) == heap, "A heap-allocated ID keys the same way as a short one");
  checks.require(keyed_by(index, wide, *heap), "A heap key views the node's own buffer");
  checks.require(keyed_by(index, "", *blank), "An empty key still views the node's own storage");

  // The mapped strong reference is what keeps the key bytes alive.
  auto owner = point(wide);
  HistoryIndex kept;
  collect_history_nodes(*keyframe("holder", owner, point("other")), kept);
  const auto* bytes = owner->id.data();
  const auto stored = at(kept, wide);
  owner.reset();
  checks.require(stored->id.data() == bytes && kept.find(wide) != kept.end(),
                 "The stored node outlives the parent and keeps its key valid");
}

void escape_checks(Checks& checks) {
  const auto coordinate = point("coordinate");
  const auto whole = group("group", {keyframe("frame", point("left"), point("right"),
                                              graph("graph", {graph_point("gp", coordinate)}))});
  HistoryIndex populated;
  collect_history_nodes(*whole, populated);
  const auto expected = sorted_keys(populated);
  const auto before = coordinate.use_count();

  collect_escape_history_nodes(*whole, populated);
  checks.require(sorted_keys(populated) == expected, "The escape walk inserts nothing into a populated map");
  checks.require(coordinate.use_count() == before, "The escape walk takes no reference");

  HistoryIndex empty;
  collect_escape_history_nodes(*whole, empty);
  assign_escape_history_nodes(*whole, empty);
  checks.require(empty.empty(), "Both escape hooks leave an empty map empty");
  assign_escape_history_nodes(*whole, populated);
  checks.require(sorted_keys(populated) == expected, "Assigning an escape map changes no node");
  checks.require(coordinate.use_count() == before, "Assignment takes no reference either");
}

void rejection_checks(Checks& checks) {
  const auto rejects = [&checks](const HistoryNode& node, std::string_view message) {
    HistoryIndex index;
    bool rejected = false;
    try {
      collect_history_nodes(node, index);
    } catch (const std::logic_error&) {
      rejected = true;
    }
    checks.require(rejected && index.empty(), message);
  };
  auto frame = keyframe("frame", point("left"), point("right"));
  frame->slots[0].reset();
  rejects(*frame, "A null control is rejected before any insertion");
  frame->slots[0] = point("left");
  frame->slots.pop_back();
  rejects(*frame, "A missing graph slot is rejected, unlike a present null one");
  frame->slots.push_back(point("not-a-graph"));
  rejects(*frame, "A control object in the graph slot is rejected");

  auto whole = group("group", {keyframe("frame", point("left"), point("right"))});
  whole->slots[0]->active.push_back(nullptr);
  rejects(*whole, "A null active element is rejected before any insertion");
  whole->slots[0]->active.back() = point("wrong-kind");
  rejects(*whole, "An array element of the wrong kind is rejected");
  whole->slots[0]->active.pop_back();
  whole->slots[0]->retained.push_back(nullptr);
  rejects(*whole, "A null retained element is rejected even though it is never visited");
  whole->slots[0]->retained.clear();
  whole->slots[0].reset();
  rejects(*whole, "A group without its array is rejected");

  auto leaf = point("leaf");
  leaf->slots.push_back(point("child"));
  rejects(*leaf, "A coordinate may not carry a child slot");
  leaf->slots.clear();
  leaf->active.push_back(point("child"));
  rejects(*leaf, "Only the two array levels carry node lists");

  auto malformed = graph("graph", {graph_point("gp", nullptr)});
  rejects(*malformed, "A graph point without a coordinate is rejected");
  malformed = graph("graph", {graph_point("gp", point("coordinate"))});
  malformed->slots[0]->kind = HistoryNodeKind::keyframe_array;
  rejects(*malformed, "A keyframe array under a graph is rejected");

  HistoryIndex populated;
  const auto valid = group("group", {keyframe("frame", point("left"), point("right"))});
  collect_history_nodes(*valid, populated);
  bool escaped = false;
  try {
    collect_escape_history_nodes(*leaf, populated);
  } catch (const std::logic_error&) {
    escaped = true;
  }
  checks.require(escaped && populated.size() == 4, "The escape hooks share the same preflight");
}

// Pinned from the real SDK run recorded in
// QCut-Binary-CPP-2026-09-10/creator/native-history.json ("golden" section). The default
// build loads no vendor library, so these fixtures are what keeps the contract honest here.
void golden_checks(Checks& checks) {
  {
    // golden case "frame-with-graph": one keyframe whose controls are distinct objects and
    // whose graph holds a single point; the native map held six keys and no root entry.
    const auto whole = keyframe("k", point("kl"), point("kr"), graph("g", {graph_point("p", point("c"))}));
    HistoryIndex index;
    collect_history_nodes(*whole, index);
    checks.require(sorted_keys(index) == std::vector<std::string>{"c", "g", "g-points", "kl", "kr", "p"},
                   "Golden frame-with-graph key set");
  }
  {
    // golden case "duplicate-controls": both controls carry one ID, the left one wins.
    const auto winner = point("d"), loser = point("d");
    const auto whole = keyframe("k", winner, loser);
    HistoryIndex index;
    collect_history_nodes(*whole, index);
    checks.require(index.size() == 1 && at(index, "d") == winner, "Golden duplicate-controls winner");
  }
  {
    // golden case "duplicate-across-graph": a control and a coordinate share one ID and the
    // control is visited first; the graph point and array keys are still present.
    const auto control = point("x");
    const auto whole = keyframe("k", control, point("kr"), graph("g", {graph_point("p", point("x"))}));
    HistoryIndex index;
    collect_history_nodes(*whole, index);
    checks.require(at(index, "x") == control, "Golden duplicate-across-graph winner");
    checks.require(sorted_keys(index) == std::vector<std::string>{"g", "g-points", "kr", "p", "x"},
                   "Golden duplicate-across-graph key set");
  }
  {
    // golden case "group-retained": the removed frame stayed out of the native map.
    const auto live = keyframe("live", point("ll"), point("lr"));
    const auto gone = keyframe("gone", point("gl"), point("gr"));
    const auto whole = group("g", {live});
    whole->slots[0]->retained = {gone};
    HistoryIndex index;
    collect_history_nodes(*whole, index);
    checks.require(sorted_keys(index) == std::vector<std::string>{"g-frames", "live", "ll", "lr"},
                   "Golden group-retained key set");
  }
}
}  // namespace

int main() {
  try {
    Checks checks;
    spine_checks(checks);
    duplicate_checks(checks);
    list_checks(checks);
    identifier_checks(checks);
    escape_checks(checks);
    rejection_checks(checks);
    golden_checks(checks);
    return checks.finish();
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
