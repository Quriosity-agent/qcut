#include "keyframe_controls.hpp"
#include "keyframe_insertion.hpp"
#include "test_support.hpp"

#include <limits>

using namespace creator_contract;

int main() {
  try {
    Checks checks;
    auto left = make_filter_keyframe("left", 1000, 1.0);
    auto right = make_filter_keyframe("right", 11000, 2.0);
    left->curve_type = 1;
    right->curve_type = 2;
    left->right_control.reset();
    right->left_control.reset();
    repair_control_pair(left.get(), right.get());
    checks.same_bits(left->right_control->x, 4000.0, "Default outgoing handle uses positive 40% of span");
    checks.same_bits(right->left_control->x, -4000.0, "Default incoming handle uses negative 40% of span");
    checks.same_bits(left->right_control->y, 0.0, "Default outgoing y is zero");
    checks.same_bits(right->left_control->y, 0.0, "Default incoming y is zero");

    for (double x : {-20000.0, -10000.0, -1.0, 1.0, 10000.0, 20000.0}) {
      left->right_control->x = x;
      left->right_control->y = 7;
      right->left_control->x = x;
      right->left_control->y = 8;
      repair_control_pair(left.get(), right.get());
      checks.same_bits(left->right_control->x, x < 10000 ? x : 10000,
                       "Outgoing nonzero x only clamps its upper side");
      checks.same_bits(right->left_control->x, x > -10000 ? x : -10000,
                       "Incoming nonzero x only clamps its lower side");
      checks.same_bits(left->right_control->y, 7, "Nonzero outgoing x preserves y");
      checks.same_bits(right->left_control->y, 8, "Nonzero incoming x preserves y");
    }
    const auto nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000004567});
    left->right_control->x = nan;
    right->left_control->x = nan;
    repair_control_pair(left.get(), right.get());
    checks.same_bits(left->right_control->x, nan, "Unordered outgoing x is preserved");
    checks.same_bits(right->left_control->x, nan, "Unordered incoming x is preserved");
    left->right_control->x = -0.0;
    right->left_control->x = -0.0;
    repair_control_pair(left.get(), right.get());
    checks.same_bits(left->right_control->x, 4000, "Signed zero takes default-handle branch");
    checks.same_bits(right->left_control->x, -4000, "Incoming signed zero takes default branch");
    checks.same_bits(left->right_control->y, 0, "Default branch resets existing y");

    left->curve_type = 0;
    left->right_control.reset();
    repair_control_pair(left.get(), right.get());
    checks.require(!left->right_control, "Curve zero does not create missing control");
    repair_control_pair(nullptr, right.get());
    checks.require(!left->right_control, "Null endpoint is a no-op");

    left->curve_type = 1;
    left->time_offset = std::numeric_limits<std::int64_t>::max();
    right->time_offset = std::numeric_limits<std::int64_t>::min();
    right->left_control->x = 0;
    repair_control_pair(left.get(), right.get());
    checks.same_bits(left->right_control->x, 0.4, "Signed span wraps to plus one before conversion");
    checks.same_bits(right->left_control->x, -0.4, "Reverse wrapped span is minus one");
    return checks.finish();
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
