#include "property_dispatch.hpp"
#include "resolved_property.hpp"
#include "wrapped_time.hpp"

#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

constexpr std::size_t kDispatchBudget = 1U << 20;

PropertyDispatchResult copy_branch(std::span<const double> values, PropertyDispatchBranch branch) {
  // Every copy branch converges on one shape test: an empty copy is logged and falls back instead.
  if (values.empty()) return {};
  return {branch, {values.begin(), values.end()}};
}

ControlTimeRecord resolve_record(const ConstantSpeedSegment& segment, const CurvePropertyKeyframe& frame) {
  const bool has_controls = frame.curve_type != 0;
  return resolve_constant_speed_record(segment, {frame.time,
      has_controls ? frame.incoming : ControlOffset{}, has_controls ? frame.outgoing : ControlOffset{}});
}

bool caption_color_property(std::string_view property) {
  return property == "KFTypeTextColor" || property == "KFTypeBorderColor" ||
         property == "KFTypeShadowColor" || property == "KFTypeBackgroundColor";
}

std::vector<double> evaluate_linear(std::span<const double> left, std::span<const double> right,
                                   std::int64_t numerator, std::int64_t denominator) {
  // Three separate native loops: difference, then the converted quotient product, then the sum.
  const double progress = static_cast<double>(numerator) / static_cast<double>(denominator);
  std::vector<double> result(left.size());
  for (std::size_t i = 0; i < result.size(); ++i) {
    const double difference = right[i] - left[i];
    const double scaled = progress * difference;
    result[i] = left[i] + scaled;
  }
  return result;
}

}  // namespace

PropertyDispatchResult dispatch_property_values(const PropertyDispatchInput& input) {
  const auto& frames = input.keyframes;
  if (frames.size() > kDispatchBudget) throw std::length_error("Keyframe group exceeds the independent budget");
  for (const auto& entry : frames) {
    if (entry.has_graph) throw std::invalid_argument("Graph-backed keyframes are outside this dispatch domain");
    if (entry.frame.values.size() > kDispatchBudget) throw std::length_error("Property shape exceeds the independent budget");
  }
  // A missing group and an empty list are separate native tests that share the same fallback.
  if (frames.empty()) return {};
  std::vector<std::int64_t> times(frames.size());
  for (std::size_t i = 0; i < frames.size(); ++i) times[i] = frames[i].frame.time;
  const auto selection = select_keyframe_window(times, input.window);
  if (selection.selected) {
    return copy_branch(frames[*selection.selected].frame.values, PropertyDispatchBranch::ExactHit);
  }
  // A nonempty list always yields a neighbor, so the native both-null test stays unreachable here.
  if (!selection.previous && !selection.next) return {};
  if (!selection.previous) return copy_branch(frames[*selection.next].frame.values, PropertyDispatchBranch::NextCopy);
  if (!selection.next) return copy_branch(frames[*selection.previous].frame.values, PropertyDispatchBranch::PreviousCopy);

  const auto& left = frames[*selection.previous].frame;
  const auto& right = frames[*selection.next].frame;
  if (left.values.size() != right.values.size()) return {};
  if (left.values.empty()) throw std::invalid_argument("Equal empty neighbor shapes are outside this dispatch domain");
  const auto query = keyframe_time_to_relative_sequence(input.segment, selection.midpoint);
  const auto mapped_left = keyframe_time_to_relative_sequence(input.segment, left.time);
  const auto mapped_right = keyframe_time_to_relative_sequence(input.segment, right.time);
  // Both mapped comparisons are ordinary signed tests; only the retained deltas wrap.
  if (query < mapped_left) return copy_branch(left.values, PropertyDispatchBranch::ClampedPrevious);
  if (query > mapped_right) return copy_branch(right.values, PropertyDispatchBranch::ClampedNext);
  const NonlinearPropertyInterval interval{left, right};
  if (left.curve_type != 0 || right.curve_type != 0) {
    return {PropertyDispatchBranch::Curved, property_detail::evaluate_records(interval,
        resolve_record(input.segment, left), resolve_record(input.segment, right), mapped_left, query)};
  }
  if (input.caption_text && wrapped_difference(mapped_right, mapped_left) > 0 &&
      caption_color_property(input.property)) {
    throw std::invalid_argument("Caption color property dispatch is outside this unit");
  }
  return {PropertyDispatchBranch::Linear, evaluate_linear(left.values, right.values,
      wrapped_difference(query, mapped_left), wrapped_difference(mapped_right, mapped_left))};
}

}  // namespace editor_contract
