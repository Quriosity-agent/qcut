#include "resolved_property.hpp"

#include <stdexcept>

namespace editor_contract::property_detail {
void validate_interval(const NonlinearPropertyInterval& interval, std::int64_t query) {
  if (interval.left.values.empty() || interval.left.values.size() != interval.right.values.size()) {
    throw std::invalid_argument("Nonlinear property values require the same nonempty shape");
  }
  if (interval.left.values.size() > (1U << 20)) throw std::length_error("Property shape exceeds the independent budget");
  if ((interval.left.curve_type == 0 && interval.right.curve_type == 0) || query <= interval.left.time || query >= interval.right.time) {
    throw std::invalid_argument("This branch requires a nonzero curve and a strictly interior raw midpoint");
  }
}

std::vector<double> evaluate_records(const NonlinearPropertyInterval& interval,
    const ControlTimeRecord& first, const ControlTimeRecord& last,
    std::int64_t mapped_left, std::int64_t query) {
  if (first.time > last.time) throw std::invalid_argument("Descending resolved records are outside the verified domain");
  if (query > last.time) return {interval.right.values.begin(), interval.right.values.end()};
  const bool before_or_at_first = query <= first.time;
  const auto& selected_right = before_or_at_first ? first : last;
  const auto right_values = before_or_at_first ? interval.left.values : interval.right.values;
  // The first-record branch retains the original mapped left bound even when both records are the same.
  const IntervalProgress progress{before_or_at_first ? mapped_left : first.time, selected_right.time, query};
  std::vector<double> result(interval.left.values.size());
  for (std::size_t i = 0; i < result.size(); ++i) {
    const auto prepared = prepare_cubic_interval({first.time, selected_right.time,
        interval.left.values[i], right_values[i], first.right, selected_right.left}, progress);
    result[i] = static_cast<double>(evaluate_cubic(prepared.curve, prepared.progress));
  }
  return result;
}
}  // namespace editor_contract::property_detail
