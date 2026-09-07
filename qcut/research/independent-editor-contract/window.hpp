#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>

namespace editor_contract {

struct KeyframeWindow { std::int64_t start; std::int64_t end; };

struct WindowSelection {
  std::int64_t midpoint;
  std::optional<std::size_t> selected;
  std::optional<std::size_t> previous;
  std::optional<std::size_t> next;
  bool operator==(const WindowSelection&) const = default;
};

// Indices refer to the original list, before any caller-requested removal.
WindowSelection select_keyframe_window(std::span<const std::int64_t> times,
                                      KeyframeWindow window);

}  // namespace editor_contract
