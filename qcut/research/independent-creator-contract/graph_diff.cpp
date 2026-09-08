#include "graph_diff.hpp"

#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "Graph diff requires IEEE comparisons, including NaN and signed zero"
#endif

namespace creator_contract {
namespace {
void validate(const GraphDiffRequest& request) {
  validate_graph_tree_index(request.before); validate_graph_tree_index(request.after);
  validate_graph_tree_index(request.replacements); validate_graph_tree_index(request.shared);
}
template <class T> void replace_owner(std::shared_ptr<T>& child, const GraphDiffRequest& request) {
  if (!request.replace_shared) return;
  const auto shared = graph_tree_find<T>(request.shared, child->id);
  if (shared != child) {
    request.shared.try_emplace(child->id, std::monostate{});
    return;
  }
  if (!request.replacements.contains(child->id)) return;
  const auto replacement = graph_tree_find<T>(request.replacements, child->id);
  if (!replacement) throw std::invalid_argument("A selected replacement must have the expected nonnull type");
  child = replacement;
  request.replaced = true;
}
template <class T> void apply(T& current, const T& before, const T& after) {
  if (before != after) current = after;
}
void coordinate(RecordPoint& current, const GraphDiffRequest& request) {
  const auto before = graph_tree_find<RecordPoint>(request.before, current.id);
  const auto after = graph_tree_find<RecordPoint>(request.after, current.id);
  if (!before || !after) return;
  apply(current.id, before->id, after->id);
  apply(current.x, before->x, after->x); apply(current.y, before->y, after->y);
}
void point(RecordGraphPoint& current, const GraphDiffRequest& request) {
  const auto before = graph_tree_find<RecordGraphPoint>(request.before, current.id);
  const auto after = graph_tree_find<RecordGraphPoint>(request.after, current.id);
  if (!before || !after) return;
  apply(current.id, before->id, after->id); apply(current.type, before->type, after->type);
  replace_owner(current.point, request);
  coordinate(*current.point, request);
}
void array(GraphPointArray& current, const GraphDiffRequest& request) {
  for (const auto& child : current.nodes.active) point(*child, request);
}
void preflight(const GraphDiffRequest& request) {
  validate(request);
  if (!request.replace_shared) return;
  // Validate by stable map key as well as current IDs: earlier visits may rename aliased children.
  for (const auto& [id, entry] : request.shared) {
    if (!request.replacements.contains(id)) continue;
    auto check = [&]<class T>() {
      const auto value = std::get_if<std::shared_ptr<T>>(&entry);
      if (value && *value && !graph_tree_find<T>(request.replacements, id)) {
        throw std::invalid_argument("Shared replacement entries require matching nonnull types");
      }
    };
    check.template operator()<RecordPoint>();
    check.template operator()<GraphPointArray>();
  }
}

}
void restore_coordinate_diff(RecordPoint& current, const GraphDiffRequest& request) {
  preflight(request); coordinate(current, request);
}
void restore_graph_point_diff(RecordGraphPoint& current, const GraphDiffRequest& request) {
  if (!current.point) throw std::invalid_argument("Graph diff requires a coordinate");
  preflight(request);
  point(current, request);
}
void restore_graph_array_diff(GraphPointArray& current, const GraphDiffRequest& request) {
  preflight(request); validate_graph_array(current); array(current, request);
}
void restore_graph_tree_diff(GraphRecordTree& current, const GraphDiffRequest& request) {
  validate_graph_tree(current); preflight(request);
  const auto before = graph_tree_find<GraphRecordTree>(request.before, current.id);
  const auto after = graph_tree_find<GraphRecordTree>(request.after, current.id);
  if (!before || !after) return;
  apply(current.id, before->id, after->id);
  apply(current.resource_id, before->resource_id, after->resource_id);
  apply(current.resource_name, before->resource_name, after->resource_name);
  apply(current.source_platform, before->source_platform, after->source_platform);
  replace_owner(current.points, request); array(*current.points, request);
}
}  // namespace creator_contract
