#include "keyframe.hpp"

#include <cmath>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE signed-zero and NaN classification semantics"
#endif

namespace editor_contract {

KeyframeMetadata filter_keyframe_metadata(const FilterKeyframeInput& input) noexcept {
  const bool modern_codes = input.code_mode != 0;
  const std::uint64_t intensity_a = modern_codes ? 0x80000000ULL : 0x2000ULL;
  const std::uint64_t intensity_b = modern_codes ? 0x100000000ULL : 0x4000ULL;
  const std::uint64_t adjustment = modern_codes ? 0x1000000000ULL : 0x10000ULL;
  std::string_view property = "intensity";
  if (input.property_code == intensity_a || input.property_code == intensity_b) {
    property = "Intensity";
  }
  if (input.property_code == adjustment) property = "effects_adjust_intensity";
  const auto value = std::isfinite(input.intensity)
                         ? std::optional<double>{input.intensity}
                         : std::nullopt;
  return {property, value};
}

FilterKeyframeTransfer transfer_filter_keyframe(const FilterKeyframeInput& input) noexcept {
  return {2, input.time_offset, input.intensity, filter_keyframe_metadata(input)};
}

}  // namespace editor_contract
