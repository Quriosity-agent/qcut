#include "selection.hpp"

#include <algorithm>
#include <cmath>

namespace creator_contract {

Selection select_filters(const SelectionRequest& request) {
  Selection selection;
  if (!request.query_utils_available) return selection;
  for (const auto& candidate : request.candidates) {
    if (candidate.is_filter_segment) {
      selection.values.try_emplace(candidate.id, candidate.timeline_value);
    }
  }
  return selection;
}

bool same_display_bucket(const ComparisonRequest& request) noexcept {
  // The wrapper special-cases the raw first infinity, including opposite signs.
  if (std::isinf(request.first) && std::isinf(request.current)) return true;
  const double first_bucket = std::round(request.first / 0.01);
  const double current_bucket = std::round(request.current / 0.01);
  const double distance = std::abs(first_bucket - current_bucket) * 1.0e12;
  const double magnitude = std::min(std::abs(first_bucket), std::abs(current_bucket));
  return distance <= magnitude;
}

AggregateValue aggregate_value(const Selection& selection) noexcept {
  if (selection.values.empty()) return {ValueKind::empty, 0.0};
  auto cursor = selection.values.begin();
  const double first = cursor->second.value_or(0.0);
  if (selection.values.size() == 1) return {ValueKind::single, first};
  for (++cursor; cursor != selection.values.end(); ++cursor) {
    if (!same_display_bucket({first, cursor->second.value_or(0.0)})) {
      return {ValueKind::mixed, -1.0};
    }
  }
  return {ValueKind::uniform, first};
}

}  // namespace creator_contract
