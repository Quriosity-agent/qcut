#include "window.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

namespace editor_contract {

WindowSelection select_keyframe_window(std::span<const std::int64_t> times,
                                      KeyframeWindow window) {
  if (times.size() > (1U << 20)) throw std::length_error("Keyframe selection exceeds the independent budget");
  WindowSelection result{wrapped_midpoint(window.start, window.end), {}, {}, {}};
  if (times.empty()) return result;
  std::size_t closest = 0;
  auto distance = wrapped_distance(times.front(), result.midpoint);
  for (std::size_t i = 1; i < times.size(); ++i) {
    const auto candidate = wrapped_distance(times[i], result.midpoint);
    // The native search ends at its first tie or increase; it does not sort first.
    if (candidate >= distance) break;
    closest = i;
    distance = candidate;
  }
  const auto time = times[closest];
  if (window.start <= time && time <= window.end) {
    result.selected = closest;
    if (closest > 0) result.previous = closest - 1;
    if (closest + 1 < times.size()) result.next = closest + 1;
    return result;
  }
  if (result.midpoint < time) {
    result.next = closest;
    if (closest > 0 && times[closest - 1] <= result.midpoint) result.previous = closest - 1;
    return result;
  }
  result.previous = closest;
  if (closest + 1 < times.size() && times[closest + 1] >= result.midpoint) result.next = closest + 1;
  return result;
}

}  // namespace editor_contract
