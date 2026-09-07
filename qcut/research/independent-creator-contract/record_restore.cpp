#include "record_restore.hpp"
#include "record_graph.hpp"

#include "mutation.hpp"

#include <stdexcept>
#include <unordered_set>
#include <utility>

#if defined(__FAST_MATH__) || (defined(_M_FP_FAST) && _M_FP_FAST)
#error "Record restoration requires IEEE floating-point comparisons"
#endif

namespace creator_contract {
namespace {
void validate(const RecordFrame& frame, const RecordGraphPointIndex& graph_points = {}) {
  if ((frame.has_graph && !frame.graph) || !frame.left || !frame.right || !frame.values) {
    throw std::invalid_argument("Restoration requires typed graph data, values and both controls");
  }
  if (frame.graph) validate_graph_record(*frame.graph, graph_points);
}

void validate(const RecordFrameList& list, const RecordGraphPointIndex& graph_points = {}) {
  for (const auto& frame : list.active) {
    if (!frame) throw std::invalid_argument("Null active record frame");
    validate(*frame, graph_points);
  }
}

template <typename Value>
void restore_value(Value& destination, const Value& source, editor_contract::MutationState& state) {
  if (destination == source) return;
  destination = source;
  detail::mark_changed(state);
}
}  // namespace

void restore_point_from(RecordPoint& destination, const RecordPoint* source) {
  if (!source) return;
  destination.id = source->id;
  restore_value(destination.x, source->x, destination.mutation);
  restore_value(destination.y, source->y, destination.mutation);
}

std::shared_ptr<RecordPoint> restore_point_copy(const RecordPoint& source) {
  auto copy = std::make_shared<RecordPoint>(source);
  detail::mark_changed(copy->mutation);
  return copy;
}

void restore_frame_from(RecordFrame& destination, const RecordFrame* source,
                        const RecordGraphPointIndex& graph_points) {
  if (!source) return;
  validate(destination);
  validate(*source, graph_points);
  destination.id = source->id;
  restore_value(destination.curve_type, source->curve_type, destination.mutation);
  restore_value(destination.time_offset, source->time_offset, destination.mutation);
  restore_point_from(*destination.left, source->left.get());
  restore_point_from(*destination.right, source->right.get());
  if (*destination.values != *source->values) {
    destination.values = std::make_shared<std::vector<double>>(*source->values);
    detail::mark_changed(destination.mutation);
  }
  restore_value(destination.string_value, source->string_value, destination.mutation);
  if (destination.graph && source->graph) {
    restore_graph_from(*destination.graph, source->graph.get(), graph_points);
  } else if (source->graph) {
    destination.graph = restore_graph_copy(*source->graph, graph_points);
    destination.graph->mutation.tracking = 0;
    detail::mark_changed(destination.graph->mutation);
    detail::mark_changed(destination.mutation);
  } else if (destination.graph) {
    destination.graph.reset();
    detail::mark_changed(destination.mutation);
  }
  destination.has_graph = static_cast<bool>(destination.graph);
}

std::shared_ptr<RecordFrame> restore_frame_copy(const RecordFrame& source,
                                               const RecordGraphPointIndex& graph_points) {
  validate(source, graph_points);
  auto copy = std::make_shared<RecordFrame>(source);
  copy->left = restore_point_copy(*source.left);
  copy->right = restore_point_copy(*source.right);
  if (source.graph) copy->graph = restore_graph_copy(*source.graph, graph_points);
  detail::mark_changed(copy->mutation);
  return copy;
}

std::size_t restore_frame_list(RecordFrameList& destination, const RecordFrameList& source,
                             const RecordFrameIndex& existing, const RecordGraphPointIndex& graph_points) {
  validate(destination);
  validate(source, graph_points);
  for (const auto& frame : source.active) {
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) validate(*found->second, graph_points);
  }

  return detail::reconcile_record_list(destination, source, existing,
      [&](RecordFrame& live, const RecordFrame* history) { restore_frame_from(live, history, graph_points); },
      [&](const RecordFrame& history) { return restore_frame_copy(history, graph_points); });
}

std::size_t restore_group_from(RecordGroup& destination, const RecordGroup* source,
                             const RecordFrameIndex& existing, const RecordGraphPointIndex& graph_points) {
  if (!source) return 0;
  validate(destination.frames);
  validate(source->frames, graph_points);
  for (const auto& frame : source->frames.active) {
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) validate(*found->second, graph_points);
  }
  destination.id = source->id;
  restore_value(destination.material_id, source->material_id, destination.mutation);
  restore_value(destination.property, source->property, destination.mutation);
  return restore_frame_list(destination.frames, source->frames, existing, graph_points);
}

std::shared_ptr<RecordGroup> restore_group_copy(const RecordGroup& source,
                                               const RecordFrameIndex& existing,
                                               const RecordGraphPointIndex& graph_points) {
  validate(source.frames, graph_points);
  for (const auto& frame : source.frames.active) {
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) validate(*found->second, graph_points);
  }
  auto copy = std::make_shared<RecordGroup>(source);
  copy->frames = detail::copy_record_list(source.frames, existing,
      [&](RecordFrame& live, const RecordFrame* history) { restore_frame_from(live, history, graph_points); },
      [&](const RecordFrame& history) { return restore_frame_copy(history, graph_points); });
  detail::mark_changed(copy->mutation);
  return copy;
}

}  // namespace creator_contract
