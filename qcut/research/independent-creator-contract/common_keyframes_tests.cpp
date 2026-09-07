#include "common_keyframes.hpp"
#include "test_support.hpp"

#include <limits>

using namespace creator_contract;

int main() {
  Checks check;
  const auto nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000000042});
  for (const double value : {0.0, -0.0, 0.37, -4.0, 100.0,
                            std::numeric_limits<double>::infinity(), nan}) {
    const auto values = filter_keyframe_values(value);
    check.require(values.size() == 1, "one scalar per filter keyframe");
    check.same_bits(values[0], value, "raw value bits preserved");
  }
  auto first = std::make_shared<CommonKeyframe>();
  first->id = "duplicate";
  auto second = std::make_shared<CommonKeyframe>(*first);
  CommonKeyframeGroup group{"KFTypeFilter", {nullptr, first, second}, {}};
  check.require(find_keyframe_by_id(group, "duplicate") == first.get(), "first nonnull duplicate wins");
  check.require(find_keyframe_by_id(group, "missing") == nullptr, "missing ID");
  first->id = std::string("a\0b", 3);
  check.require(find_keyframe_by_id(group, std::string_view("a\0b", 3)) == first.get(), "embedded NUL comparison uses length");
  check.require(find_keyframe_by_id(group, "a") == nullptr, "not a C string prefix");
  first->id.clear();
  check.require(find_keyframe_by_id(group, "") == first.get(), "standalone empty ID lookup");

  for (const std::uint8_t tracking : {std::uint8_t{0}, std::uint8_t{1}, std::uint8_t{255}}) {
    for (const std::uint32_t state : {0U, 1U, 2U, 3U, UINT32_MAX}) {
      CommonKeyframe key{"k", {-0.0, 0.5}, false, {tracking, state, 9}};
      const auto before = key.mutation;
      check.require(!assign_keyframe_values(key, {0.0, 0.5}), "numeric equal values do not replace storage");
      check.same_bits(key.values[0], -0.0, "numeric equality preserves old zero sign");
      check.require(key.mutation == before, "equal values do not dirty");
      check.require(assign_keyframe_values(key, {0.1}), "length change replaces values");
      check.require(key.mutation == editor_contract::MutationState{tracking, tracking != 0 && state == 0 ? 2U : state, 1}, "replacement mutation flags");
      key.mutation = before;
      clear_keyframe_graph(key);
      check.require(!key.has_graph, "null graph remains null");
      check.require(key.mutation.changed == 1, "clearing already-null graph still dirties");
      check.require(key.mutation.state_code == (tracking != 0 && state == 0 ? 2U : state), "graph clear code");
      key.values = {nan};
      key.mutation = before;
      check.require(assign_keyframe_values(key, {nan}), "same NaN payload is unequal");
      check.same_bits(key.values[0], nan, "NaN payload stored without normalization");
    }
  }
  CommonKeyframe empty;
  check.require(!assign_keyframe_values(empty, {}), "empty vector equal");

  for (const bool tracks_children : {false, true}) {
    for (const std::uint8_t tracking : {std::uint8_t{0}, std::uint8_t{1}}) {
      for (const std::uint32_t state : {0U, 1U, 2U, 3U, UINT32_MAX}) {
        auto a = std::make_shared<CommonKeyframeGroup>();
        a->property = "KFTypeFilter";
        a->mutation = {tracking, state, 9};
        auto b = std::make_shared<CommonKeyframeGroup>();
        b->property = "KFTypeAlpha";
        b->mutation = {0, 7, 8};
        CommonKeyframeArray array{{a, b, a}, {b}, tracks_children, {tracking, state, 9}};
        check.require(clear_common_keyframes(array) == 3, "clock event per active entry including duplicate");
        check.require(array.active.empty(), "all common groups removed regardless property");
        check.require(array.retained == std::vector{b, a, b, a}, "retained prefix plus ordered aliases");
        check.require(a->mutation.state_code == (tracks_children && tracking != 0 ? 3U : state), "child removal code overwrites any tracked code");
        check.require(a->mutation.changed == 9 && b->mutation == editor_contract::MutationState{0, 7, 8}, "child changed byte and untracked child preserved");
        check.require(array.mutation == editor_contract::MutationState{tracking, tracking != 0 && state == 0 ? 2U : state, 1}, "array dirty flags");
        const auto after = array.mutation;
        check.require(clear_common_keyframes(array) == 0 && array.mutation == after && array.retained.size() == 4, "repeated empty clear is inert");
      }
    }
  }
  CommonKeyframeArray malformed{{nullptr}, {}, true, {1, 0, 7}};
  bool rejected = false;
  try { static_cast<void>(clear_common_keyframes(malformed)); }
  catch (const std::invalid_argument&) { rejected = true; }
  check.require(rejected && malformed.active.size() == 1 && malformed.retained.empty() && malformed.mutation.changed == 7, "malformed group rejected before writes");
  return check.finish();
}
