#include "requests.hpp"
#include "test_support.hpp"

#include <array>
#include <limits>

using namespace creator_contract;

int main() {
  Checks checks;
  checks.require(global_filter_service == "GlobalFilterService" && UpdateFilter::method == "updateGlobalFilter" &&
      ResetFilter::method == "resetGlobalFilter", "constructor service and method identifiers");
  const Selection selection{{{"a", .5}, {"z", .5}}};
  Combo output;
  struct Fixture { double raw; std::int64_t detail; };
  for (const auto& fixture : std::array{Fixture{.235, 24}, Fixture{-.235, -24}, Fixture{.004, 0},
           Fixture{.005, 1}, Fixture{-.005, -1}, Fixture{1.23456, 123},
           Fixture{21474836.47, 2147483647}, Fixture{-21474836.48, -2147483648}}) {
    for (const auto operation : {Operation::accept_click, Operation::accept_shortcut}) {
      checks.require(build_combo({selection, operation, fixture.raw, 17}, output), "supported accept");
      checks.require(output.dispatch_flag && output.editor_mode == 1 && output.observed_policy == 2 &&
                         output.request_id == -1 && output.session_id == 17 && output.tag == "Filter_Segment_Base_Action", "dispatch constants");
      checks.require(output.actions.size() == 2 && output.telemetry.size() == 2, "per selected ID request and telemetry");
      for (std::size_t index = 0; index < 2; ++index) {
        const auto& request = std::get<UpdateFilter>(output.actions[index]);
        checks.require(request.segment_id == (index == 0 ? "a" : "z") && !request.observed_flag_0x128, "request key and observed option");
        checks.same_bits(request.raw_intensity, fixture.raw, "telemetry rounding never changes raw request");
        checks.require(output.telemetry[index].control_detail == fixture.detail &&
                           output.telemetry[index].action == (operation == Operation::accept_click ? "click" : "shortkey"), "telemetry integer and action");
      }
    }
  }
  const double infinity = std::numeric_limits<double>::infinity();
  const double nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000000123});
  for (double raw : {-.0, -12.25, 100.0, infinity, -infinity, nan, std::numeric_limits<double>::max()}) {
    checks.require(build_combo({selection, Operation::update, raw, -7}, output), "update copies raw value without clamp");
    checks.require(!output.dispatch_flag && output.telemetry.empty(), "live update emits no telemetry");
    checks.same_bits(std::get<UpdateFilter>(output.actions[0]).raw_intensity, raw, "raw update bit preservation");
  }
  checks.require(build_combo({selection, Operation::reset, nan, 0}, output), "reset ignores intensity");
  checks.require(output.dispatch_flag && output.telemetry.empty() &&
      std::get<ResetFilter>(output.actions[0]).segment_id == "a" &&
      std::get<ResetFilter>(output.actions[1]).segment_id == "z", "reset carries IDs, no invented value");
  const Combo sentinel = output;
  for (double invalid : {infinity, -infinity, nan, 21474836.48, -21474836.49, std::numeric_limits<double>::max()}) {
    std::int64_t integer = 876;
    checks.require(!telemetry_integer({invalid}, integer) && integer == 876, "unsupported telemetry preserves output");
    checks.require(!build_combo({selection, Operation::accept_click, invalid, 0}, output) && output == sentinel,
                   "unsupported accept rejects atomically");
  }
  checks.require(!build_combo({selection, static_cast<Operation>(999), .1, 0}, output) && output == sentinel, "unknown operation rejects atomically");
  for (const auto operation : {Operation::update, Operation::accept_click, Operation::accept_shortcut, Operation::reset}) {
    checks.require(build_combo({{}, operation, nan, 0}, output), "empty wrapper still dispatches, no telemetry evaluation");
    checks.require(output.actions.empty() && output.telemetry.empty() && output.dispatch_flag == (operation != Operation::update), "empty combo remains observable");
  }
  return checks.finish();
}
