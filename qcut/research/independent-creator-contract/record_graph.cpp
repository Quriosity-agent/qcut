#include "record_graph.hpp"

#include <stdexcept>

namespace creator_contract {
namespace {
void validate_point(const RecordGraphPoint& point) {
  if (!point.point) throw std::invalid_argument("Graph point requires a coordinate object");
}
template <class Value>
void assign_changed(Value& destination, const Value& source, editor_contract::MutationState& state) {
  if (destination == source) return;
  destination = source;
  detail::mark_changed(state);
}
}  // namespace

void validate_graph_record(const RecordGraph& graph, const RecordGraphPointIndex& existing) {
  for (const auto& point : graph.points.active) {
    if (!point) throw std::invalid_argument("Graph list contains a null active point");
    validate_point(*point);
    const auto mapped = existing.find(point->id);
    if (mapped != existing.end() && mapped->second) validate_point(*mapped->second);
  }
}

void restore_graph_point_from(RecordGraphPoint& destination, const RecordGraphPoint* source) {
  if (!source) return;
  validate_point(destination);
  validate_point(*source);
  destination.id = source->id;
  assign_changed(destination.type, source->type, destination.mutation);
  restore_point_from(*destination.point, source->point.get());
}

std::shared_ptr<RecordGraphPoint> restore_graph_point_copy(const RecordGraphPoint& source) {
  validate_point(source);
  auto result = std::make_shared<RecordGraphPoint>(source);
  result->point = restore_point_copy(*source.point);
  detail::mark_changed(result->mutation);
  return result;
}

std::size_t restore_graph_from(RecordGraph& destination, const RecordGraph* source,
                              const RecordGraphPointIndex& existing) {
  if (!source) return 0;
  validate_graph_record(destination);
  validate_graph_record(*source, existing);
  destination.id = source->id;
  assign_changed(destination.resource_id, source->resource_id, destination.mutation);
  assign_changed(destination.resource_name, source->resource_name, destination.mutation);
  assign_changed(destination.source_platform, source->source_platform, destination.mutation);
  return detail::reconcile_record_list(destination.points, source->points, existing,
                                      restore_graph_point_from, restore_graph_point_copy);
}

std::shared_ptr<RecordGraph> restore_graph_copy(const RecordGraph& source,
                                              const RecordGraphPointIndex& existing) {
  validate_graph_record(source, existing);
  auto result = std::make_shared<RecordGraph>(source);
  result->points = detail::copy_record_list(source.points, existing,
                                           restore_graph_point_from, restore_graph_point_copy);
  detail::mark_changed(result->mutation);
  return result;
}
}  // namespace creator_contract
