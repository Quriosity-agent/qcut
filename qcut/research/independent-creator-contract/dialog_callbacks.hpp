#pragma once

#include "requests.hpp"

#include <optional>

namespace creator_contract {

enum class DialogCallback { first, second };

struct CallbackRequest {
  DialogCallback callback;
  bool model_alive;
  bool wrapper_available;
  bool removal_started;
  bool is_in_preview_mode;
  bool captured_shortcut;
  double cached_value;
  double current_wrapper_value;
};

struct CallbackPlan {
  bool removal_started;
  double cached_value;
  bool dismiss_record = false;
  bool dismiss_record_argument = false;
  unsigned value_changed_signals = 0;
  std::optional<Operation> wrapper_operation;
};

// First/second refers to alertToClearKeyFrames argument order, not UI labels.
bool plan_dialog_callback(const CallbackRequest& request, CallbackPlan& output) noexcept;

}  // namespace creator_contract
