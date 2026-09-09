#include "record_stash.hpp"
#include "test_support.hpp"

#include <limits>

namespace {
using namespace creator_contract;
using editor_contract::MutationState;
std::shared_ptr<RecordGraphPoint> point(std::string id, double x = .5) {
  return std::make_shared<RecordGraphPoint>(RecordGraphPoint{std::move(id), 0,
      std::make_shared<RecordPoint>(RecordPoint{"coordinate", x, 1, {1, 0, 0}}), {1, 0, 0}});
}
RecordFrame frame(std::shared_ptr<RecordGraph> graph = {}) {
  RecordFrame result;
  result.id = "f";
  result.left = std::make_shared<RecordPoint>();
  result.right = std::make_shared<RecordPoint>();
  result.values = std::make_shared<std::vector<double>>();
  result.mutation = {1, 0, 0};
  result.graph = std::move(graph);
  result.has_graph = static_cast<bool>(result.graph);
  return result;
}
template <class Action> void reject(Checks& checks, Action action) {
  bool caught = false;
  try { action(); } catch (const std::invalid_argument&) { caught = true; }
  checks.require(caught, "Malformed graph must be rejected");
}

void copy_and_reconcile(Checks& checks) {
  auto a = point("a", -0.0), b = point("b");
  auto source = std::make_shared<RecordGraph>();
  source->id = "graph"; source->mutation = {1, 0, 0};
  source->points = {{a, a}, {b}, {1, 0, 0}, true};
  auto copied = restore_graph_copy(*source);
  checks.require(copied != source && copied->id == source->id, "Graph copy requires new identity and preserved ID");
  checks.require(copied->points.active[0] != copied->points.active[1], "Unmapped duplicate IDs must split");
  checks.require(copied->points.active[0]->point != a->point && copied->points.active[0]->point != copied->points.active[1]->point,
                 "Coordinates must independently copy even with source aliases");
  checks.require(copied->points.retained == source->points.retained, "Retained entries must remain shared");
  checks.require(copied->mutation == MutationState{1, 2, 1}, "Graph copy must mark itself");
  checks.require(copied->points.active[0]->mutation == MutationState{1, 1, 1}, "Missing map entry uses insertion code");
  checks.require(copied->points.mutation == MutationState{1, 0, 0}, "Tracked copy preserves list state");
  auto null_mapped = restore_graph_copy(*source, {{"a", nullptr}});
  checks.require(null_mapped->points.active[0]->mutation == MutationState{1, 2, 1}, "Null entry must bypass insertion code");
  checks.same_bits(null_mapped->points.active[0]->point->x, -0.0, "Copy preserves negative zero bits");
  auto live = point("a", .25);
  const auto coordinate = live->point;
  auto mapped = restore_graph_copy(*source, {{"a", live}});
  checks.require(mapped->points.active == std::vector{live, live}, "Mapped copies share live node");
  checks.require(live->point == coordinate, "Mapped restore preserves live coordinate");
  checks.same_bits(coordinate->x, -0.0, "Live coordinate numeric value failed to restore");
  RecordGraph destination;
  destination.id = "destination";
  destination.points = {{b, b}, {a}, {1, 0, 0}, true};
  const auto clocks = restore_graph_from(destination, source.get(), {{"a", live}});
  checks.require(clocks == 3, "Duplicate new IDs require separate clock writes plus final write");
  checks.require(destination.points.retained == std::vector{a, b, b}, "Removal preserves retained order and aliases");
  checks.require(destination.id == "graph" && destination.points.active == std::vector{live, live}, "Reconcile failed");
  checks.require(restore_graph_from(destination, nullptr) == 0, "Null graph source must be a no-op");
}

void frame_and_group(Checks& checks) {
  auto graph = std::make_shared<RecordGraph>();
  graph->mutation = {1, 0, 0}; graph->points.active = {point("p")};
  auto from = frame(graph), to = frame();
  restore_frame_from(to, &from);
  checks.require(to.graph && to.graph != graph && to.graph->mutation == MutationState{0, 2, 1}, "Null-to-graph creates untracked marked copy");
  checks.require(to.mutation == MutationState{1, 2, 1}, "Graph attachment marks frame");
  auto external = to.graph;
  to.mutation = {1, 0, 0};
  graph->resource_id = "changed";
  restore_frame_from(to, &from);
  checks.require(to.graph == external && to.graph->resource_id == "changed", "Both-present graph must restore in place");
  checks.require(to.mutation == MutationState{1, 0, 0}, "Nested graph edits must not mark parent frame");
  auto empty = frame();
  std::weak_ptr<RecordGraph> weak = to.graph;
  restore_frame_from(to, &empty);
  checks.require(!to.graph && to.mutation == MutationState{1, 2, 1}, "Graph removal marks frame");
  checks.require(!weak.expired(), "External graph owner must survive removal");
  external.reset();
  checks.require(weak.expired(), "Final graph owner release must destroy subtree");
  RecordGroup group;
  auto f = std::make_shared<RecordFrame>(from);
  group.frames = {{f, f}, {f}, {1, 0, 0}, true};
  auto copy = restore_group_copy(group);
  checks.require(copy->frames.active[0] != copy->frames.active[1], "Group copy splits unmapped frame aliases");
  checks.require(copy->frames.active[0]->values == f->values, "Frame value allocation remains shared");
  checks.require(copy->frames.active[0]->graph != f->graph, "Frame graph must independently copy");
  checks.require(copy->frames.retained == std::vector{f}, "Group retained stays shallow");
}

void stash_selection(Checks& checks) {
  auto live = point("p", -0.0), prior = point("p", .75);
  prior->mutation = {0, 3, 0};
  RecordStashIndex history{{{"p", prior}}, {{"coordinate", prior->point}}};
  bool changed = false;
  checks.require(!stash_graph_point(*live, history, changed) && !changed, "Clean equal-type node suppresses even differing coordinate payload");
  live->type = 2;
  auto result = stash_graph_point(*live, history, changed);
  checks.require(result && changed && result->point == prior->point, "Type change preserves historical coordinate owner");
  checks.require(result->mutation == MutationState{0, 0, 0}, "Stash inherits prior tracking but current state/changed");
  checks.require(result->type == 2, "Stash type comes from current node");
  live->point->mutation.changed = 1;
  result = stash_graph_point(*live, history, changed);
  checks.require(result->point != prior->point && result->point != live->point, "Changed coordinate requires fresh snapshot");
  checks.same_bits(result->point->x, -0.0, "Stash coordinate copies signed zero bits");
  checks.require(result->point->mutation == live->point->mutation, "Stash must not introduce restore dirty state");
  changed = true;
  live->mutation = {}; live->point->mutation = {}; live->type = prior->type;
  checks.require(!stash_graph_point(*live, history, changed) && changed, "Null snapshot must not clear cumulative changed flag");
  changed = false;
  result = stash_graph_point(*live, {}, changed);
  checks.require(result && changed && result->point != live->point, "Missing history produces full independent graph-point snapshot");
  checks.require(result->mutation == live->mutation && result->point->mutation == live->point->mutation, "Fallback deep copy preserves mutation without marking");
  live->point->x = std::numeric_limits<double>::quiet_NaN();
  changed = false;
  checks.require(!stash_point(*live->point, history, changed) && !changed, "Clean point selection uses dirty state, not NaN comparison");
}

void invalid(Checks& checks) {
  RecordGraph graph;
  graph.id = "safe";
  auto source = graph;
  source.id = "bad";
  source.points.active = {point("good"), nullptr};
  reject(checks, [&] { restore_graph_from(graph, &source); });
  checks.require(graph.id == "safe" && graph.points.active.empty(), "Malformed later node must reject before any mutation");
  source.points.active = {point("p")};
  auto bad = point("p"); bad->point.reset();
  reject(checks, [&] { restore_graph_from(graph, &source, {{"p", bad}}); });
  reject(checks, [&] { (void)restore_graph_copy(source, {{"p", bad}}); });
  reject(checks, [&] { (void)restore_graph_point_copy(*bad); });
  bool flag = false;
  reject(checks, [&] { (void)stash_graph_point(*bad, {}, flag); });
  checks.require(!flag, "Rejected stash must not change flag");
  source.points.retained = {nullptr, bad};
  checks.require(restore_graph_copy(source)->points.retained == source.points.retained, "Retained-only entries are not recursively inspected");
}
}  // namespace
int main() {
  try { Checks checks; copy_and_reconcile(checks); frame_and_group(checks); stash_selection(checks); invalid(checks); return checks.finish(); }
  catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
