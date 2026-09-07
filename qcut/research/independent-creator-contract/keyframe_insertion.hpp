#pragma once

#include "common_keyframes.hpp"

#include <optional>
#include <span>

namespace creator_contract {

struct FilterKeyframePayload {
  std::uint64_t fields = 5;
  std::int64_t timeline_time = 0;
  std::vector<double> values;
};

FilterKeyframePayload filter_insertion_payload(std::int64_t timeline_time, double intensity);
std::vector<double> resize_numeric_keyframe_values(std::span<const double> requested,
                                                  std::size_t existing_size);

// Caller supplies an already resolved keyframe time. Only the observed fields=5 path is accepted.
bool apply_filter_keyframe_payload(CommonKeyframe& frame, const FilterKeyframePayload& payload,
                                   std::int64_t resolved_time);
std::shared_ptr<CommonKeyframe> make_filter_keyframe(std::string id, std::int64_t time,
                                                   double intensity);

struct OrderedInsertion {
  std::size_t index;
  std::size_t clock_write_events;
};

struct EnsuredGroup {
  std::shared_ptr<CommonKeyframeGroup> group;
  bool created;
  std::size_t clock_write_events;
};
// Empty material matches by property alone. The existing array tracking flag also controls insertion.
EnsuredGroup ensure_common_keyframe_group(CommonKeyframeArray& array, std::string property,
                                          std::string material_id);
OrderedInsertion insert_keyframe_ordered(CommonKeyframeGroup& group,
                                        const std::shared_ptr<CommonKeyframe>& frame);

struct ResolvedInsertion {
  bool inserted;
  std::size_t index;
  bool values_replaced;
  std::size_t clock_write_events;
};

// Resolves a collision within wrapped(time +/- 1000); IDs for new nodes are supplied by the host.
ResolvedInsertion add_filter_keyframe_at_resolved_time(CommonKeyframeGroup& group,
    const FilterKeyframePayload& payload, std::int64_t resolved_time, std::string new_id);

}  // namespace creator_contract
