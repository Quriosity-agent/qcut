#pragma once

#include <cmath>
#include <cstdint>
#include <limits>

namespace editor_contract {

inline std::int64_t truncate_time(double value) noexcept {
  // ARM64 FCVTZS saturates; an out-of-range C++ floating-to-integer cast would be undefined.
  if (std::isnan(value)) return 0;
  if (value >= 0x1p63) return std::numeric_limits<std::int64_t>::max();
  if (value <= -0x1p63) return std::numeric_limits<std::int64_t>::min();
  return static_cast<std::int64_t>(value);
}

}  // namespace editor_contract
