#include "record_restore.hpp"
#include "test_support.hpp"

#include <limits>

namespace {
using namespace creator_contract;
using editor_contract::MutationState;
std::shared_ptr<RecordFrame> frame(std::string id, double value = .5) {
  auto result = std::make_shared<RecordFrame>();
  result->id = std::move(id);
  result->left = std::make_shared<RecordPoint>(RecordPoint{"left", 0, 0, {1, 0, 0}});
  result->right = std::make_shared<RecordPoint>(RecordPoint{"right", 1, 1, {1, 0, 0}});
  result->values = std::make_shared<std::vector<double>>(std::initializer_list<double>{value});
  result->mutation = {1, 0, 0};
  return result;
}

template <typename Action>
void rejected(Checks& checks, Action action) {
  bool caught = false;
  try { action(); } catch (const std::invalid_argument&) { caught = true; }
  checks.require(caught, "Invalid graph/null input was accepted");
}

void point_rules(Checks& checks) {
  for (std::uint8_t track : {std::uint8_t{0}, std::uint8_t{1}}) {
    for (std::uint32_t code : {0U, 1U, 2U, 3U}) {
      RecordPoint original{"old", -0.0, .5, {track, code, 0}};
      RecordPoint source{"new", +0.0, .5, {1, 3, 1}};
      restore_point_from(original, &source);
      checks.require(original.id == "new", "ID must restore independently of tracking");
      checks.same_bits(original.x, -0.0, "Equal zero must retain destination bits");
      checks.require(original.mutation == MutationState{track, code, 0}, "ID-only restore must not mark dirty");
      source.y = .6;
      restore_point_from(original, &source);
      checks.require(original.mutation == MutationState{track, track && code == 0 ? 2U : code, 1},
                     "Restore must preserve tracking and nonzero state code");
      checks.same_bits(original.y, .6, "Point payload failed to restore");
    }
  }
  const double nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000004321});
  RecordPoint p{"", nan, std::numeric_limits<double>::infinity(), {1, 0, 0}};
  restore_point_from(p, &p);
  checks.require(p.mutation == MutationState{1, 2, 1}, "Self NaN restore must mark dirty");
  checks.same_bits(p.x, nan, "NaN payload must be preserved");
  restore_point_from(p, nullptr);
  checks.require(p.mutation == MutationState{1, 2, 1}, "Null point source must be a no-op");
}

void frame_rules(Checks& checks) {
  auto source = frame("history", .75);
  source->left = source->right;
  source->string_value = std::string("a\0b", 3);
  source->time_offset = std::numeric_limits<std::int64_t>::min();
  source->curve_type = std::numeric_limits<std::int32_t>::max();
  auto copy = restore_frame_copy(*source);
  checks.require(copy != source && copy->left != source->left && copy->right != source->right,
                 "Restore copy must allocate frame and controls");
  checks.require(copy->left != copy->right, "Copy must split even aliased source controls");
  checks.require(copy->values == source->values, "Restore copy must share the value allocation");
  checks.require(copy->mutation == MutationState{1, 2, 1} && copy->left->mutation == MutationState{1, 2, 1},
                 "Copies must mark their own state dirty");
  (*source->values)[0] = .9;
  checks.same_bits((*copy->values)[0], .9, "Shared value storage must remain observable");
  auto destination = frame("live", -.25);
  const auto left = destination->left;
  const auto right = destination->right;
  restore_frame_from(*destination, source.get());
  checks.require(destination->left == left && destination->right == right, "In-place restore must preserve controls");
  checks.require(destination->values != source->values, "Changed values must replace rather than share source allocation");
  checks.require(destination->id == source->id && destination->time_offset == source->time_offset &&
      destination->curve_type == source->curve_type && destination->string_value == source->string_value,
      "Complete frame payload failed to restore");
  checks.same_bits((*destination->values)[0], .9, "Numeric values failed to restore");
  auto zeros = frame("z", -0.0);
  auto positive = frame("p", +0.0);
  const auto old_values = zeros->values;
  restore_frame_from(*zeros, positive.get());
  checks.require(zeros->values == old_values, "Equal numeric vector must preserve old allocation");
  checks.same_bits((*zeros->values)[0], -0.0, "Equal numeric vector must preserve zero bits");
  (*zeros->values)[0] = std::numeric_limits<double>::quiet_NaN();
  const auto before_self_nan = zeros->values;
  restore_frame_from(*zeros, zeros.get());
  checks.require(zeros->values != before_self_nan, "NaN self-restore must allocate a new vector");
  checks.require(source->mutation == MutationState{1, 0, 0}, "Copy must not dirty source state");
}

void list_rules(Checks& checks) {
  auto a = frame("a"), b = frame("b"), history = frame("a", .75);
  RecordFrameList current{{a, b, b}, {}, {1, 0, 0}, true};
  RecordFrameList snapshot{{history, history}, {}, {}, false};
  RecordFrameIndex index{{"a", a}};
  const auto writes = restore_frame_list(current, snapshot, index);
  checks.require(current.active == std::vector{a, a}, "Mapped duplicate IDs must preserve live alias");
  checks.require(current.retained == std::vector{b, b}, "Removed duplicate IDs must retain their ordered references");
  checks.require(b->mutation == MutationState{1, 0, 0}, "Restoration removal must not assign deletion code 3");
  checks.require(writes == 1 && current.mutation == MutationState{1, 2, 1}, "Size change and final clock accounting failed");
  checks.require(index.size() == 1, "Restore must not extend the identity map");

  RecordFrameList missing{{}, {}, {1, 0, 0}, true};
  checks.require(restore_frame_list(missing, snapshot, {}) == 3, "Each newly introduced occurrence writes a clock");
  checks.require(missing.active[0] != missing.active[1], "Unmapped duplicate IDs require separate restore copies");
  checks.require(missing.active[0]->values == history->values && missing.active[1]->values == history->values,
                 "Unmapped copies retain source value ownership");
  checks.require(missing.active[0]->mutation == MutationState{1, 1, 1}, "Tracked new child requires insertion code 1");

  RecordFrameList replacement{{frame("old")}, {}, {1, 0, 0}, true};
  RecordFrameList one{{frame("new")}, {}, {}, false};
  checks.require(restore_frame_list(replacement, one, {}) == 2, "Same-size replacement clock count failed");
  checks.require(replacement.mutation == MutationState{1, 0, 0}, "Tracked same-size replacement does not dirty the array itself");
  RecordFrameList untracked{{frame("old")}, {}, {1, 0, 0}, false};
  restore_frame_list(untracked, one, {});
  checks.require(untracked.active[0]->mutation == MutationState{0, 2, 1}, "Child tracking changes after restore-copy marks code 2");
  checks.require(untracked.mutation == MutationState{1, 2, 1}, "Untracked insertion must dirty the array");

  auto x = frame("x"), y = frame("y");
  RecordFrameList reordered{{x, y}, {}, {1, 0, 0}, true};
  RecordFrameList reverse{{y, x}, {}, {}, false};
  checks.require(restore_frame_list(reordered, reverse, {{"x", x}, {"y", y}}) == 1, "Reordering only writes final clock");
  checks.require(reordered.active == std::vector{y, x} && reordered.mutation == MutationState{1, 0, 0},
                 "Reordering existing IDs must preserve array dirty state");
  checks.require(restore_frame_list(reordered, reordered, {{"x", x}, {"y", y}}) == 1, "Self-list restore failed");
  RecordFrameList empty;
  restore_frame_list(reordered, empty, {});
  checks.require(reordered.active.empty() && reordered.retained == std::vector{y, x}, "Empty snapshot must retain old active entries");
  std::weak_ptr<RecordFrame> weak = reordered.retained.front();
  reverse.active.clear();
  y.reset();
  checks.require(!weak.expired(), "Retained must own the removed frame");
  reordered.retained.clear();
  checks.require(weak.expired(), "Clearing the final retained reference must release the frame");
}

void invalid_rules(Checks& checks) {
  auto valid = frame("valid");
  auto bad = frame("bad");
  bad->has_graph = true;
  rejected(checks, [&] { restore_frame_from(*valid, bad.get()); });
  checks.require(valid->id == "valid" && valid->mutation == MutationState{1, 0, 0}, "Rejected frame restore changed destination");
  rejected(checks, [&] { (void)restore_frame_copy(*bad); });
  bad->has_graph = false;
  bad->right.reset();
  rejected(checks, [&] { restore_frame_from(*valid, bad.get()); });
  bad = frame("bad");
  bad->values.reset();
  rejected(checks, [&] { (void)restore_frame_copy(*bad); });
  RecordFrameList current{{valid}, {}, {1, 0, 0}, true};
  RecordFrameList invalid{{frame("new"), nullptr}, {}, {}, false};
  rejected(checks, [&] { restore_frame_list(current, invalid, {}); });
  checks.require(current.active == std::vector{valid} && current.retained.empty(), "List validation must precede mutation");
  RecordFrameList snapshot{{frame("mapped")}, {}, {}, false};
  rejected(checks, [&] { restore_frame_list(current, snapshot, {{"mapped", bad}}); });
  checks.require(current.active == std::vector{valid}, "Invalid mapped target mutated array");
  restore_frame_from(*bad, nullptr);
  checks.require(!bad->values, "Null source does not dereference invalid destination");
  RecordGroup group;
  checks.require(restore_group_from(group, nullptr, {}) == 0, "Null group source must be a no-op");
}
}  // namespace

int main() {
  try {
    Checks checks;
    point_rules(checks);
    frame_rules(checks);
    list_rules(checks);
    invalid_rules(checks);
    return checks.finish();
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
