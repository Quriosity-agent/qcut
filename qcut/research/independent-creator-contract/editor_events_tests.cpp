#include "editor_events.hpp"
#include "test_support.hpp"

#include <limits>

using namespace creator_contract;

int main() {
  Checks check;
  for (const bool request_enabled : {false, true}) {
    for (const bool auto_enabled : {false, true}) {
      for (const bool material_present : {false, true}) {
        ResolvedFilterState filter;
        if (material_present) filter.material = editor_contract::MaterialValue{0.2, {1, 0, 0}};
        auto key = std::make_shared<CommonKeyframe>(CommonKeyframe{"id", {0.2, 9.0}, true, {1, 0, 0}});
        CommonKeyframeGroup group{"KFTypeFilter", {key}, {1, 0, 0}};
        const auto result = update_resolved_filter(filter, &group, {0.37, request_enabled, auto_enabled, "id"});
        check.require(result.material_setter_called == material_present, "material pointer guard");
        if (material_present) check.same_bits(filter.material->value, 0.37, "material write precedes keyframe gating");
        const bool enabled = request_enabled || auto_enabled;
        check.require(result.keyframe_result == (enabled ? KeyframeUpdateResult::updated_existing : KeyframeUpdateResult::disabled), "request or auto enables existing keyframe");
        check.require(result.values_replaced == enabled, "replacement status");
        check.require(key->values == (enabled ? std::vector{0.37} : std::vector{0.2, 9.0}), "entire raw scalar vector replacement");
        check.require(key->has_graph == !enabled, "graph cleared only in existing target branch");
        check.require(group.mutation == editor_contract::MutationState{1, 0, 0}, "group flags not directly dirtied");
      }
    }
  }
  ResolvedFilterState filter{editor_contract::MaterialValue{-0.0, {1, 0, 0}}, {}};
  auto key = std::make_shared<CommonKeyframe>(CommonKeyframe{"id", {-0.0}, false, {1, 0, 0}});
  CommonKeyframeGroup group{"KFTypeFilter", {key}, {}};
  const auto equal = update_resolved_filter(filter, &group, {0.0, true, false, "id"});
  check.require(equal.keyframe_result == KeyframeUpdateResult::updated_existing && !equal.values_replaced, "handler returns success even equal scalar");
  check.same_bits(key->values[0], -0.0, "keyframe old sign preserved");
  check.same_bits(filter.material->value, -0.0, "material old sign preserved");
  check.require(key->mutation == editor_contract::MutationState{1, 2, 1} && filter.material->mutation.changed == 0, "graph clear dirties keyframe despite both value setters equal");
  for (const std::string& id : {std::string{}, std::string{"unknown"}}) {
    const auto result = update_resolved_filter(filter, &group, {2.5, true, false, id});
    check.require(result.keyframe_result == KeyframeUpdateResult::capture_lookup_required, "empty or missing ID falls back to capture lookup");
    check.same_bits(filter.material->value, 2.5, "unsupported remainder does not hide prior material effect");
    check.same_bits(key->values[0], -0.0, "unresolved branch does not invent keyframe");
  }
  check.require(update_resolved_filter(filter, nullptr, {0.6, true, true, "id"}).keyframe_result == KeyframeUpdateResult::missing_group, "auto does not bypass missing group");
  CommonKeyframeGroup empty;
  empty.property = "KFTypeFilter";
  check.require(update_resolved_filter(filter, &empty, {0.7, true, false, "id"}).keyframe_result == KeyframeUpdateResult::empty_group, "empty group without auto blocks keyframes");
  check.require(update_resolved_filter(filter, &empty, {0.8, false, true, "id"}).keyframe_result == KeyframeUpdateResult::capture_lookup_required, "auto permits empty group into capture branch");
  CommonKeyframeGroup wrong;
  wrong.property = "KFTypeAlpha";
  bool wrong_rejected = false;
  try { static_cast<void>(update_resolved_filter(filter, &wrong, {0.1, true, false, "id"})); }
  catch (const std::invalid_argument&) { wrong_rejected = true; }
  check.require(wrong_rejected, "wrong resolved property rejected by QCut boundary");
  check.same_bits(filter.material->value, 0.8, "wrong group leaves material unchanged");
  const auto nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000004567});
  update_resolved_filter(filter, &group, {nan, true, false, "id"});
  check.same_bits(filter.material->value, nan, "raw NaN material request");
  check.same_bits(key->values[0], nan, "raw NaN keyframe request");
  for (const bool material_present : {false, true}) {
    for (const double initial : {1.0, -0.0, -2.0, nan, std::numeric_limits<double>::infinity()}) {
      ResolvedFilterState reset;
      if (material_present) reset.material = editor_contract::MaterialValue{initial, {1, 0, 0}};
      auto a = std::make_shared<CommonKeyframeGroup>();
      auto b = std::make_shared<CommonKeyframeGroup>();
      a->property = "KFTypeFilter";
      b->property = "unrelated";
      a->keyframes.push_back(key);
      reset.common_keyframes.active = {a, b, a};
      const auto result = reset_resolved_filter(reset);
      check.require(result.material_setter_called == material_present && result.common_groups_removed == 3 && result.clock_write_events == 3, "reset effects from direct handler");
      if (material_present) {
        check.same_bits(reset.material->value, 1.0, "handler literal reset value");
        check.require(reset.material->mutation.changed == (initial == 1.0 ? 0 : 1), "reset setter equality controls dirty");
      }
      check.require(reset.common_keyframes.retained == std::vector{a, b, a}, "reset retains all common properties and aliases");
      check.require(a->keyframes[0] == key && key->values.size() == 1, "reset detaches groups rather than erasing contained keyframes");
      check.require(reset_resolved_filter(reset).clock_write_events == 0, "second reset has no group removals");
    }
  }
  ResolvedFilterState malformed{editor_contract::MaterialValue{0.2, {1, 0, 0}}, {{nullptr}, {}, false, {}}};
  bool rejected = false;
  try { static_cast<void>(reset_resolved_filter(malformed)); }
  catch (const std::invalid_argument&) { rejected = true; }
  check.require(rejected, "QCut malformed reset policy fails closed");
  check.same_bits(malformed.material->value, 0.2, "malformed reset does not partially change material");
  return check.finish();
}
