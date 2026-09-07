#include "dialog_callbacks.hpp"

namespace creator_contract {

bool plan_dialog_callback(const CallbackRequest& request, CallbackPlan& output) noexcept {
  if (request.callback != DialogCallback::first && request.callback != DialogCallback::second) {
    return false;
  }
  CallbackPlan plan{request.removal_started, request.cached_value, false, false, 0, std::nullopt};
  if (!request.model_alive) {
    output = plan;
    return true;
  }
  plan.removal_started = false;
  if (request.callback == DialogCallback::first) {
    if (request.wrapper_available) {
      plan.wrapper_operation = request.captured_shortcut ? Operation::accept_shortcut : Operation::accept_click;
    }
    output = plan;
    return true;
  }
  plan.dismiss_record = request.is_in_preview_mode;
  const double value = request.wrapper_available ? request.current_wrapper_value : 0.0;
  plan.value_changed_signals = 1;
  if (request.cached_value != value) {
    plan.cached_value = value;
    ++plan.value_changed_signals;
  }
  output = plan;
  return true;
}

}  // namespace creator_contract
