#pragma once

#include "nonlinear_property.hpp"
#include "window.hpp"

#include <string_view>

namespace editor_contract {

// One entry of an already selected keyframe group. Graph-backed frames stay outside this unit.
struct DispatchKeyframe {
  CurvePropertyKeyframe frame;
  bool has_graph = false;
};

struct PropertyDispatchInput {
  ConstantSpeedSegment segment;
  std::span<const DispatchKeyframe> keyframes;
  KeyframeWindow window;
  // The requested KeyframeTypeKey property member and the Caption predicate gate the color path.
  std::string_view property;
  bool caption_text = false;
};

enum class PropertyDispatchBranch {
  SegmentDefault, ExactHit, NextCopy, PreviousCopy, ClampedPrevious, ClampedNext, Linear, Curved
};

struct PropertyDispatchResult {
  PropertyDispatchBranch branch = PropertyDispatchBranch::SegmentDefault;
  std::vector<double> values;
};

// A single Video segment with positive constant speed, graph-free keyframes and a raw int64 window.
// SegmentDefault names the native Segment-type getter chain; this unit reports it without values.
PropertyDispatchResult dispatch_property_values(const PropertyDispatchInput& input);

}  // namespace editor_contract
