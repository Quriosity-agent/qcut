#pragma once

#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace qcut_live {

inline void validateMakeupGeometry(const std::array<float, 212>& source,
                                   const std::array<float, 212>& destination,
                                   int width, int height) {
  static_assert(sizeof(float) == sizeof(std::uint32_t) &&
                std::numeric_limits<float>::is_iec559 &&
                std::numeric_limits<float>::digits == 24 &&
                std::numeric_limits<float>::max_exponent == 128);
  if (width < 1 || width > 4096 || height < 1 || height > 4096)
    throw std::runtime_error("makeup geometry dimensions must be in [1, 4096]");

  const float floatWidth = static_cast<float>(width);
  const float floatHeight = static_cast<float>(height);
  for (std::size_t index = 0; index < source.size(); index += 2) {
    const float x = source[index];
    const float y = source[index + 1];
    if (!std::isfinite(x) || !std::isfinite(y) ||
        x < 0.0f || x > 1.0f || y < 0.0f || y > 1.0f)
      throw std::runtime_error("makeup geometry source must be finite and normalized");
    if (!std::isfinite(destination[index]) || !std::isfinite(destination[index + 1]))
      throw std::runtime_error("makeup geometry destination must be finite");

    // Volatile stores round to float32 and prevent multiply/subtract contraction.
    volatile float scaledX = x * floatWidth;
    volatile float scaledY = y * floatHeight;
    volatile float flippedY = floatHeight - scaledY;
    const float expectedX = scaledX;
    const float expectedY = flippedY;
    if (std::bit_cast<std::uint32_t>(destination[index]) !=
            std::bit_cast<std::uint32_t>(expectedX) ||
        std::bit_cast<std::uint32_t>(destination[index + 1]) !=
            std::bit_cast<std::uint32_t>(expectedY))
      throw std::runtime_error("makeup geometry destination bits disagree");
  }
}

}
