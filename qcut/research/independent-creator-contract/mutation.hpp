#pragma once

#include "../independent-editor-contract/value_state.hpp"

namespace creator_contract::detail {
inline void mark_changed(editor_contract::MutationState& state) noexcept {
  if (state.tracking != 0 && state.state_code == 0) state.state_code = 2;
  state.changed = 1;
}
}  // namespace creator_contract::detail
