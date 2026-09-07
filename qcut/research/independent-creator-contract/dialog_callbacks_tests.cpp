#include "dialog_callbacks.hpp"
#include "test_support.hpp"

#include <limits>

using namespace creator_contract;

int main() {
  Checks checks;
  for (bool alive : {false, true}) for (bool wrapper : {false, true}) for (bool shortcut : {false, true}) {
    CallbackPlan plan{};
    checks.require(plan_dialog_callback({DialogCallback::first, alive, wrapper, true, true, shortcut, .2, .8}, plan), "first callback");
    checks.require(plan.removal_started == !alive && plan.cached_value == .2 && !plan.dismiss_record && plan.value_changed_signals == 0, "first callback resets only removal state");
    checks.require(plan.wrapper_operation.has_value() == (alive && wrapper), "weak model and wrapper guards");
    if (plan.wrapper_operation) checks.require(*plan.wrapper_operation == (shortcut ? Operation::accept_shortcut : Operation::accept_click), "captured shortcut preserved");
  }
  const double nan = std::numeric_limits<double>::quiet_NaN();
  struct Fixture { bool wrapper; double old_value; double value; unsigned signals; double expected; };
  for (const auto& fixture : {Fixture{true, .2, .2, 1, .2}, Fixture{true, .2, .8, 2, .8},
           Fixture{true, -.0, .0, 1, -.0}, Fixture{false, .4, .8, 2, 0},
           Fixture{false, -.0, .8, 1, -.0}, Fixture{true, nan, nan, 2, nan}}) {
    for (bool preview : {false, true}) {
      CallbackPlan plan{};
      checks.require(plan_dialog_callback({DialogCallback::second, true, fixture.wrapper, true, preview, false,
                         fixture.old_value, fixture.value}, plan), "second callback");
      checks.require(!plan.removal_started && plan.dismiss_record == preview && !plan.dismiss_record_argument &&
                         !plan.wrapper_operation && plan.value_changed_signals == fixture.signals, "dismissRecord(false) and observed signal multiplicity");
      checks.same_bits(plan.cached_value, fixture.expected, "exact cached comparison including signed zero and NaN");
    }
  }
  CallbackPlan expired{};
  checks.require(plan_dialog_callback({DialogCallback::second, false, true, true, true, false, .2, .8}, expired) &&
                     expired.removal_started && expired.cached_value == .2 && !expired.dismiss_record && expired.value_changed_signals == 0, "expired weak model no-op");
  CallbackPlan sentinel{true, .2, true, true, 77, Operation::reset};
  checks.require(!plan_dialog_callback({static_cast<DialogCallback>(9), true, true, true, true, true, .3, .4}, sentinel) &&
                     sentinel.removal_started && sentinel.cached_value == .2 && sentinel.dismiss_record && sentinel.dismiss_record_argument &&
                     sentinel.value_changed_signals == 77 && sentinel.wrapper_operation == Operation::reset, "invalid callback preserves all output");
  return checks.finish();
}
