#include "model_gate.hpp"
#include "test_support.hpp"

#include <array>

using namespace creator_contract;

int main() {
  Checks checks;
  struct Fixture { ModelState state; bool clear; bool removal; bool confirm_accept; };
  const std::array fixtures{
      Fixture{{false, false, false, false}, false, false, false},
      Fixture{{false, true, true, false}, false, false, false},
      Fixture{{false, true, true, true}, false, true, false},
      Fixture{{true, false, false, false}, false, false, false},
      Fixture{{true, false, true, false}, false, false, false},
      Fixture{{true, false, true, true}, false, true, false},
      Fixture{{true, true, false, false}, false, false, false},
      Fixture{{true, true, false, true}, false, true, true},
      Fixture{{true, true, true, false}, true, true, true},
      Fixture{{true, true, true, true}, false, true, true}};
  for (const auto& fixture : fixtures) {
    for (const auto operation : {Operation::update, Operation::accept_click, Operation::accept_shortcut}) {
      ModelPlan plan{};
      checks.require(plan_model_action({fixture.state, operation}, plan), "valid model action");
      checks.require(plan.clear_all_frames == fixture.clear && !plan.clear_all_frames_argument, "clearAllFrames(false) gate");
      checks.require(plan.state.removal_started == fixture.removal, "removal flag transition");
      checks.require(plan.requires_keyframe_confirmation == (operation != Operation::update && fixture.confirm_accept), "accept confirmation gate");
      checks.require(plan.wrapper_operation.has_value() == (fixture.state.wrapper_available && !plan.requires_keyframe_confirmation), "no premature accept while waiting for callback");
      if (plan.wrapper_operation) checks.require(*plan.wrapper_operation == operation, "operation preserved");
    }
    ModelPlan reset{};
    checks.require(plan_model_action({fixture.state, Operation::reset}, reset), "reset gate");
    checks.require(reset.state == fixture.state && !reset.clear_all_frames && !reset.requires_keyframe_confirmation &&
                       reset.wrapper_operation.has_value() == fixture.state.wrapper_available, "reset directly delegates, no keyframe or default guess");
  }
  ModelPlan sentinel{{true, true, true, true}, true, true, true, Operation::reset};
  const auto before = sentinel;
  checks.require(!plan_model_action({{}, static_cast<Operation>(-1)}, sentinel) && sentinel == before, "unknown operation preserves output");
  ModelPlan first{};
  checks.require(plan_model_action({{true, true, true, false}, Operation::update}, first), "begin batch edit");
  ModelPlan second{};
  checks.require(plan_model_action({first.state, Operation::update}, second) && !second.clear_all_frames, "repeat update does not clear twice");
  return checks.finish();
}
