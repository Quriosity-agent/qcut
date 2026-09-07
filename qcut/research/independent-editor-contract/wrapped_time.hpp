#pragma once

#include <bit>
#include <cstdint>

namespace editor_contract {

inline std::int64_t wrapped_sum(std::int64_t left, std::int64_t right) noexcept {
  return std::bit_cast<std::int64_t>(static_cast<std::uint64_t>(left) +
                                     static_cast<std::uint64_t>(right));
}

inline std::int64_t wrapped_difference(std::int64_t end, std::int64_t start) noexcept {
  return std::bit_cast<std::int64_t>(static_cast<std::uint64_t>(end) -
                                     static_cast<std::uint64_t>(start));
}

inline std::int64_t wrapped_midpoint(std::int64_t start, std::int64_t end) noexcept {
  // Overflow occurs before the signed division; std::midpoint would change this.
  return wrapped_sum(start, end) / 2;
}

inline std::int64_t wrapped_distance(std::int64_t time, std::int64_t midpoint) noexcept {
  const auto difference = wrapped_difference(time, midpoint);
  return difference < 0 ? wrapped_difference(0, difference) : difference;
}

}  // namespace editor_contract
