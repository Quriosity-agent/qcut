#include "resample.hpp"

#include <cmath>
#include <stdexcept>
#include <utility>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

void validate_series(const std::vector<double>& times,
                     const std::vector<std::vector<double>>& values,
                     std::size_t query_count) {
  constexpr std::size_t limit = 1U << 20;
  constexpr std::size_t scan_limit = 1U << 24;
  if (times.empty() || times.size() != values.size() || times.size() > limit ||
      query_count > limit) {
    throw std::invalid_argument("Expected a nonempty bounded time/value series");
  }
  const auto dimensions = values.front().size();
  if (dimensions > limit || (query_count && dimensions > limit / query_count) ||
      (dimensions && times.size() > limit / dimensions) ||
      (query_count && times.size() > scan_limit / query_count)) {
    throw std::length_error("Resampling exceeds the independent output/input budget");
  }
  for (std::size_t i = 0; i < times.size(); ++i) {
    if (!std::isfinite(times[i]) || (i && times[i] < times[i - 1]) ||
        values[i].size() != dimensions) {
      throw std::invalid_argument("Expected finite nondecreasing times and rectangular values");
    }
  }
}

}  // namespace

std::vector<std::vector<double>> resample_linear(
    const std::vector<double>& times,
    const std::vector<std::vector<double>>& values,
    const std::vector<double>& queries, bool hold_outside) {
  validate_series(times, values, queries.size());
  std::vector<std::vector<double>> result;
  result.reserve(queries.size());
  for (const auto query : queries) {
    std::vector<double> row(values.front().size(), 0.0);
    if (times.size() < 2 || !(times.front() <= query && query <= times.back())) {
      if (hold_outside && query <= times.front()) row = values.front();
      else if (hold_outside && query >= times.back()) row = values.back();
    } else {
      for (std::size_t i = 0; i + 1 < times.size(); ++i) {
        if (!(times[i] <= query && query <= times[i + 1])) continue;
        // The first closed interval wins, including a zero-length duplicate pair.
        const double position = (query - times[i]) / (times[i + 1] - times[i]);
        for (std::size_t channel = 0; channel < row.size(); ++channel) {
          const double change = values[i + 1][channel] - values[i][channel];
          const double increment = change * position;
          row[channel] = values[i][channel] + increment;
        }
        break;
      }
    }
    result.push_back(std::move(row));
  }
  return result;
}

}  // namespace editor_contract
