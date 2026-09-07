#include "record_restore.hpp"

#include "mutation.hpp"

#include <stdexcept>
#include <unordered_set>
#include <utility>

#if defined(__FAST_MATH__) || (defined(_M_FP_FAST) && _M_FP_FAST)
#error "Record restoration requires IEEE floating-point comparisons"
#endif

namespace creator_contract {
namespace {
void validate(const RecordFrame& frame) {
  if (frame.has_graph || !frame.left || !frame.right || !frame.values) {
    throw std::invalid_argument("Restoration requires a graph-free frame with values and both controls");
  }
}

void validate(const RecordFrameList& list) {
  for (const auto& frame : list.active) {
    if (!frame) throw std::invalid_argument("Null active record frame");
    validate(*frame);
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

void restore_frame_from(RecordFrame& destination, const RecordFrame* source) {
  if (!source) return;
  validate(destination);
  validate(*source);
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
}

std::shared_ptr<RecordFrame> restore_frame_copy(const RecordFrame& source) {
  validate(source);
  auto copy = std::make_shared<RecordFrame>(source);
  copy->left = restore_point_copy(*source.left);
  copy->right = restore_point_copy(*source.right);
  detail::mark_changed(copy->mutation);
  return copy;
}

std::size_t restore_frame_list(RecordFrameList& destination, const RecordFrameList& source,
                             const RecordFrameIndex& existing) {
  validate(destination);
  validate(source);
  for (const auto& frame : source.active) {
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) validate(*found->second);
  }

  std::vector<std::shared_ptr<RecordFrame>> restored;
  restored.reserve(source.active.size());
  std::unordered_set<std::string> requested_ids;
  for (const auto& frame : source.active) {
    requested_ids.insert(frame->id);
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) {
      restore_frame_from(*found->second, frame.get());
      restored.push_back(found->second);
    } else {
      restored.push_back(restore_frame_copy(*frame));
    }
  }

  std::unordered_set<std::string> previously_present;
  for (const auto& frame : destination.active) {
    if (requested_ids.contains(frame->id)) previously_present.insert(frame->id);
    else destination.retained.push_back(frame);
  }

  std::size_t clock_writes = 1;
  for (const auto& frame : restored) {
    if (previously_present.contains(frame->id)) continue;
    frame->mutation.tracking = static_cast<std::uint8_t>(destination.track_children);
    if (destination.track_children) frame->mutation.state_code = 1;
    else {
      detail::mark_changed(frame->mutation);
      detail::mark_changed(destination.mutation);
    }
    ++clock_writes;
    detail::mark_changed(frame->mutation);
  }
  if (source.active.size() != destination.active.size()) detail::mark_changed(destination.mutation);
  destination.active = std::move(restored);
  return clock_writes;
}

std::size_t restore_group_from(RecordGroup& destination, const RecordGroup* source,
                             const RecordFrameIndex& existing) {
  if (!source) return 0;
  validate(destination.frames);
  validate(source->frames);
  for (const auto& frame : source->frames.active) {
    const auto found = existing.find(frame->id);
    if (found != existing.end() && found->second) validate(*found->second);
  }
  destination.id = source->id;
  restore_value(destination.material_id, source->material_id, destination.mutation);
  restore_value(destination.property, source->property, destination.mutation);
  return restore_frame_list(destination.frames, source->frames, existing);
}

}  // namespace creator_contract
