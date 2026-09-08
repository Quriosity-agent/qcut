#include "graph_diff.hpp"
#include "test_support.hpp"

#include <algorithm>
#include <limits>

namespace {
using namespace creator_contract;
std::shared_ptr<RecordGraphPoint> point(const std::string& id, double x = .25) {
  return std::make_shared<RecordGraphPoint>(RecordGraphPoint{id, 1,
      std::make_shared<RecordPoint>(RecordPoint{id + "-xy", x, .75, {1, 3, 0}}), {1, 2, 0}});
}
std::shared_ptr<GraphRecordTree> tree() {
  auto result = std::make_shared<GraphRecordTree>();
  result->id = "graph"; result->resource_id = "resource"; result->resource_name = "name";
  result->mutation = {1, 3, 0};
  result->points = std::make_shared<GraphPointArray>(); result->points->id = "array";
  result->points->nodes.active = {point("a"), point("b")};
  return result;
}
GraphTreeIndex index(const std::shared_ptr<GraphRecordTree>& value) {
  GraphTreeIndex result{{value->id, value}, {value->points->id, value->points}};
  for (const auto& child : value->points->nodes.active) {
    result[child->id] = child; result[child->point->id] = child->point;
  }
  return result;
}
void stash_checks(Checks& checks) {
  const auto current = tree(), previous = tree();
  auto history = index(previous);
  bool changed = false;
  checks.require(!stash_graph_tree(*current, history, changed) && !changed, "Clean tree has no replacement");
  current->resource_id = "new";
  current->mutation.tracking = 0;
  auto value = stash_graph_tree(*current, history, changed);
  checks.require(value && changed && value->resource_id == "new", "Metadata difference creates snapshot");
  checks.require(value->points == previous->points, "Unchanged array shares historical owner");
  checks.require(value->mutation.tracking == 1 && value->mutation.state_code == 3, "Snapshot retains historical tracking");
  checks.require(value->id == previous->id && value->resource_name == "name", "Unchanged historical metadata survives");
  changed = false; current->resource_id = previous->resource_id;
  current->points->nodes.active[0]->point->x = 900;
  checks.require(!stash_graph_tree(*current, history, changed), "Clean coordinate gate is dirty based, not value comparison");
  current->points->nodes.active[0]->point->mutation.changed = 1;
  value = stash_graph_tree(*current, history, changed);
  checks.require(value && value->points != previous->points && changed, "Dirty leaf reconstructs ancestors");
  checks.require(value->points->nodes.active[0] != current->points->nodes.active[0], "Dirty leaf snapshot is a new owner");
  checks.require(value->points->nodes.active[1] == previous->points->nodes.active[1], "Clean sibling retains historical owner");
  checks.require(value->points->clock == current->points->clock, "Array stash shares current clock owner");
  current->points->suppress_change_flag = true; changed = false;
  value = stash_graph_tree(*current, history, changed);
  checks.require(value && !changed, "Suppression returns a snapshot without changed output");
  current->points->nodes.active[0]->point->mutation.changed = 0;
  std::reverse(current->points->nodes.active.begin(), current->points->nodes.active.end());
  checks.require(!stash_graph_array(*current->points, history, changed), "Clean reordering alone does not create array stash");
  current->points->nodes.retained = {current->points->nodes.active[0]};
  current->points->transient = {123, std::numeric_limits<std::uint64_t>::max()};
  auto array = stash_graph_array(*current->points, history, changed);
  checks.require(array && !changed && array->nodes.retained == current->points->nodes.retained, "Retained-only snapshot shares retained identities");
  checks.require(array->transient == std::array<std::uint64_t, 2>{}, "Array shallow snapshot resets transient words");
  current->points->suppress_change_flag = false;
  checks.require(stash_graph_array(*current->points, history, changed) && changed, "Retained data contributes to unsuppressed changed output");
  changed = false;
  value = stash_graph_tree(*current, {}, changed);
  checks.require(value && changed && value->points->clock != current->points->clock, "Missing graph history takes full deep branch with new clock owner");
  checks.require(value->points->nodes.retained[0] != current->points->nodes.retained[0], "Deep branch copies retained children");
  checks.require(value->points->nodes.active[0] != value->points->nodes.retained[0], "Repeated deep-copy occurrences do not preserve source alias");
  checks.require(value->points->nodes.mutation.tracking == 0, "Deep array starts untracked");
  GraphPointArray empty; empty.id = "empty"; changed = false;
  checks.require(!stash_graph_array(empty, {}, changed) && !changed, "Missing empty array history still produces no snapshot");
}

void diff_checks(Checks& checks) {
  const auto current = tree(), before = tree(), after = tree(), replacement = tree();
  auto prior = index(before), next = index(after), replacements = index(replacement), shared = index(current);
  bool changed = false, enabled = false;
  GraphDiffRequest request{prior, next, replacements, shared, changed, enabled};
  current->resource_name = "live divergence"; after->resource_id = "target";
  current->points->nodes.active[0]->point->x = 700;
  after->points->nodes.active[0]->point->y = .875;
  const auto state = current->mutation, leaf_state = current->points->nodes.active[0]->point->mutation;
  restore_graph_tree_diff(*current, request);
  checks.require(current->resource_id == "target", "Diff applies changed metadata");
  checks.require(current->resource_name == "live divergence", "Diff preserves live data for equal baseline/target fields");
  checks.require(current->points->nodes.active[0]->point->x == 700 && current->points->nodes.active[0]->point->y == .875, "Coordinate diff selects only changed components");
  checks.require(current->mutation == state && current->points->nodes.active[0]->point->mutation == leaf_state && !changed, "Scalar diff neither marks dirty nor signals owner replacement");
  auto old_array = current->points;
  enabled = true;
  restore_graph_tree_diff(*current, request);
  checks.require(current->points == replacement->points && changed, "Shared identity gate replaces the array owner");
  checks.require(old_array != current->points && old_array->nodes.active[0]->point->x == 700, "Rehoming leaves old tree alive and untouched");
  changed = false; shared.clear();
  restore_graph_tree_diff(*current, request);
  checks.require(shared.contains("array") && std::holds_alternative<std::monostate>(shared.at("array")), "Missing shared lookup inserts null entry");
  checks.require(!changed, "Missing shared identity skips replacement");
  auto& leaf = *current->points->nodes.active[0]->point;
  prior[leaf.id] = std::make_shared<RecordPoint>(RecordPoint{leaf.id, 0.0, 1.0, {}});
  next[leaf.id] = std::make_shared<RecordPoint>(RecordPoint{leaf.id, -0.0, 1.0, {}});
  leaf.x = 17;
  restore_coordinate_diff(leaf, request);
  checks.require(leaf.x == 17, "Signed-zero baseline equality preserves live value");
  auto target = std::get<std::shared_ptr<RecordPoint>>(next.at(leaf.id));
  target->x = std::bit_cast<double>(std::uint64_t{0x7ff8000000003456});
  restore_coordinate_diff(leaf, request);
  checks.same_bits(leaf.x, target->x, "NaN inequality applies exact target payload");
  const auto previous_id = leaf.id;
  target->id = "new-coordinate-id";
  restore_coordinate_diff(leaf, request);
  checks.require(leaf.id == target->id, "Diff copies ID when baseline and target IDs differ");
  checks.require(next.contains(previous_id) && !next.contains(target->id), "Scalar diff does not rekey caller maps");
  auto missing_before = prior.extract(current->id);
  current->resource_id = "preserved";
  restore_graph_tree_diff(*current, request);
  checks.require(current->resource_id == "preserved", "Missing parent prevents descendant traversal");
  prior.insert(std::move(missing_before));
  prior[current->id] = std::monostate{};
  restore_graph_tree_diff(*current, request);
  checks.require(current->resource_id == "preserved", "Null typed parent is a no-op");
}

void rejection_checks(Checks& checks) {
  const auto current = tree(), before = tree(), after = tree();
  auto prior = index(before), next = index(after), replacements = GraphTreeIndex{}, shared = index(current);
  bool changed = false, enabled = true;
  GraphDiffRequest request{prior, next, replacements, shared, changed, enabled};
  replacements["array"] = std::monostate{};
  after->resource_id = "must not write";
  bool rejected = false;
  try { restore_graph_tree_diff(*current, request); } catch (const std::invalid_argument&) { rejected = true; }
  checks.require(rejected && current->resource_id == "resource" && !changed, "Null selected array rejected before scalar mutation");
  replacements.clear();
  replacements["a-xy"] = point("wrong type"); rejected = false;
  try { restore_graph_tree_diff(*current, request); } catch (const std::invalid_argument&) { rejected = true; }
  checks.require(rejected && current->resource_id == "resource", "Malformed selected nested replacement preflight is atomic");
  auto bad = tree(); bad->points->nodes.active[0]->point.reset(); rejected = false;
  try { stash_graph_tree(*bad, {}, changed); } catch (const std::invalid_argument&) { rejected = true; }
  checks.require(rejected && !changed, "Invalid source leaf does not change output flag");
  bad = tree(); bad->points->clock.reset(); rejected = false;
  try { stash_graph_tree(*bad, {}, changed); } catch (const std::invalid_argument&) { rejected = true; }
  checks.require(rejected, "Missing clock ownership rejected");
}
}
int main() {
  try { Checks checks; stash_checks(checks); diff_checks(checks); rejection_checks(checks); return checks.finish(); }
  catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
