#pragma once

#include <map>
#include <optional>
#include <span>
#include <string>

namespace creator_contract {

inline constexpr double filter_default_intensity = 1.0;
inline constexpr double filter_intensity_precision = 0.001;

struct ResolvedCandidate {
  std::string id;
  bool is_filter_segment;
  std::optional<double> timeline_value;
};

struct Selection {
  std::map<std::string, std::optional<double>> values;
};

struct SelectionRequest {
  std::span<const ResolvedCandidate> candidates;
  bool query_utils_available = true;
};

// Resolution and cursor-time keyframe evaluation belong to the caller.
Selection select_filters(const SelectionRequest& request);

enum class ValueKind { empty, single, uniform, mixed };

struct AggregateValue {
  ValueKind kind;
  double value;
};

struct ComparisonRequest {
  double first;
  double current;
};

bool same_display_bucket(const ComparisonRequest& request) noexcept;
AggregateValue aggregate_value(const Selection& selection) noexcept;

}  // namespace creator_contract
