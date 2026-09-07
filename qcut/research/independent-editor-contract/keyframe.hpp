#pragma once

#include <cstdint>
#include <optional>
#include <string_view>

namespace editor_contract {

struct FilterKeyframeInput {
  std::int64_t time_offset = 0;
  std::uint64_t property_code = 0;
  double intensity = 0;
  std::uint32_t code_mode = 0;
};

struct KeyframeMetadata {
  std::string_view property;
  // The native JSON serializer emits null for a nonfinite double.
  std::optional<double> value;
};

struct FilterKeyframeTransfer {
  std::uint32_t type_code = 2;
  std::int64_t time_offset = 0;
  double intensity = 0;
  KeyframeMetadata metadata;
};

KeyframeMetadata filter_keyframe_metadata(const FilterKeyframeInput& input) noexcept;
FilterKeyframeTransfer transfer_filter_keyframe(const FilterKeyframeInput& input) noexcept;

}  // namespace editor_contract
