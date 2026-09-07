#include "keyframe_controls.hpp"
#include "mutation.hpp"

#include "../independent-editor-contract/wrapped_time.hpp"

#include <stdexcept>

namespace creator_contract {
namespace {
using detail::mark_changed;

void assign_coordinate(double& destination, double value,
                       editor_contract::MutationState& mutation) noexcept {
  if (destination == value) return;
  destination = value;
  mark_changed(mutation);
}

void repair_side(CommonKeyframe& frame, std::shared_ptr<KeyframeControl>& control,
                 std::int64_t distance, bool right_side) {
  if (frame.curve_type == 0) return;
  if (!control) {
    control = std::make_shared<KeyframeControl>();
    mark_changed(frame.mutation);
  }
  const double span = static_cast<double>(distance);
  if (control->x == 0.0) {
    assign_coordinate(control->x, span * 0.4 + 0.0, control->mutation);
    assign_coordinate(control->y, 0.0, control->mutation);
    return;
  }
  // ARM64 b.lt takes unordered on the right side; b.hi does on the left.
  const bool preserve = right_side ? !(control->x >= span) : !(control->x <= span);
  if (!preserve) assign_coordinate(control->x, span, control->mutation);
}
}  // namespace

void repair_control_pair(CommonKeyframe* left, CommonKeyframe* right) {
  if (!left || !right) return;
  repair_side(*left, left->right_control,
              editor_contract::wrapped_difference(right->time_offset, left->time_offset), true);
  repair_side(*right, right->left_control,
              editor_contract::wrapped_difference(left->time_offset, right->time_offset), false);
}

void repair_controls_around(CommonKeyframeGroup& group, std::string_view id) {
  for (const auto& frame : group.keyframes) {
    if (!frame) throw std::invalid_argument("Null frame is outside the neighborhood repair domain");
  }
  for (std::size_t i = 0; i < group.keyframes.size(); ++i) {
    if (group.keyframes[i]->id != id) continue;
    auto* selected = group.keyframes[i].get();
    auto* previous = i == 0 ? nullptr : group.keyframes[i - 1].get();
    auto* next = i + 1 == group.keyframes.size() ? nullptr : group.keyframes[i + 1].get();
    repair_control_pair(previous, selected);
    repair_control_pair(selected, next);
    return;
  }
}

}  // namespace creator_contract
