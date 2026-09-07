#include "requests.hpp"

#include <cmath>
#include <limits>
#include <utility>

namespace creator_contract {

bool telemetry_integer(const TelemetryRequest& request, std::int64_t& output) noexcept {
  const double rounded = std::round(request.raw_intensity * 100.0);
  if (!std::isfinite(rounded) ||
      rounded < static_cast<double>(std::numeric_limits<std::int32_t>::min()) ||
      rounded > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
    return false;
  }
  output = static_cast<std::int64_t>(static_cast<std::int32_t>(rounded));
  return true;
}

bool build_combo(const BuildRequest& request, Combo& output) {
  bool is_accept = false;
  switch (request.operation) {
    case Operation::update:
    case Operation::reset:
      break;
    case Operation::accept_click:
    case Operation::accept_shortcut:
      is_accept = true;
      break;
    default:
      return false;
  }
  std::int64_t detail = 0;
  if (is_accept && !request.selection.values.empty() &&
      !telemetry_integer({request.raw_intensity}, detail)) return false;

  Combo result;
  result.session_id = request.session_id;
  result.dispatch_flag = request.operation != Operation::update;
  result.actions.reserve(request.selection.values.size());
  if (is_accept) result.telemetry.reserve(request.selection.values.size());
  for (const auto& [id, unused_value] : request.selection.values) {
    static_cast<void>(unused_value);
    if (request.operation == Operation::reset) {
      result.actions.emplace_back(ResetFilter{id});
      continue;
    }
    result.actions.emplace_back(UpdateFilter{id, request.raw_intensity});
    if (is_accept) {
      result.telemetry.push_back({id,
          request.operation == Operation::accept_shortcut ? "shortkey" : "click", detail});
    }
  }
  output = std::move(result);
  return true;
}

}  // namespace creator_contract
