#include "model_gate.hpp"

namespace creator_contract {

bool plan_model_action(const ModelRequest& request, ModelPlan& output) noexcept {
  switch (request.operation) {
    case Operation::update:
    case Operation::accept_click:
    case Operation::accept_shortcut:
    case Operation::reset:
      break;
    default:
      return false;
  }
  ModelPlan plan{request.state, false, false, false, std::nullopt};
  if (!request.state.wrapper_available) {
    output = plan;
    return true;
  }
  if (request.operation == Operation::reset) {
    plan.wrapper_operation = Operation::reset;
    output = plan;
    return true;
  }
  if (request.state.batch_selection && request.state.has_keyframes &&
      !request.state.removal_started) {
    plan.clear_all_frames = true;
    plan.state.removal_started = true;
  }
  if (request.operation != Operation::update && request.state.batch_selection &&
      plan.state.removal_started) {
    plan.requires_keyframe_confirmation = true;
  } else {
    plan.wrapper_operation = request.operation;
  }
  output = plan;
  return true;
}

}  // namespace creator_contract
