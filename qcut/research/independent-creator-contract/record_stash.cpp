#include "record_stash.hpp"

#include <stdexcept>

namespace creator_contract {
std::shared_ptr<RecordPoint> stash_point(const RecordPoint& current,
                                        const RecordStashIndex& history, bool& changed) {
  const auto found = history.coordinates.find(current.id);
  if (found != history.coordinates.end() && found->second && !current.mutation.changed) return {};
  changed = true;
  return std::make_shared<RecordPoint>(current);
}

std::shared_ptr<RecordGraphPoint> stash_graph_point(const RecordGraphPoint& current,
                                                   const RecordStashIndex& history, bool& changed) {
  if (!current.point) throw std::invalid_argument("Stash graph point requires a coordinate object");
  const auto found = history.graph_points.find(current.id);
  if (found == history.graph_points.end() || !found->second) {
    auto result = std::make_shared<RecordGraphPoint>(current);
    result->point = std::make_shared<RecordPoint>(*current.point);
    changed = true;
    return result;
  }
  const auto& previous = *found->second;
  if (!previous.point) throw std::invalid_argument("Historical graph point requires a coordinate object");
  auto shallow_history = [&] {
    auto result = std::make_shared<RecordGraphPoint>(previous);
    result->mutation.state_code = current.mutation.state_code;
    result->mutation.changed = current.mutation.changed;
    return result;
  };
  std::shared_ptr<RecordGraphPoint> result;
  if (current.mutation.changed || current.type != previous.type) {
    result = shallow_history();
    result->type = current.type;
    changed = true;
  }
  if (auto point = stash_point(*current.point, history, changed)) {
    if (!result) result = shallow_history();
    result->point = std::move(point);
  }
  return result;
}
}  // namespace creator_contract
