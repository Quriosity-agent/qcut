#pragma once

#include "requests.hpp"

#include <optional>

namespace creator_contract {

struct ModelState {
  bool wrapper_available;
  bool batch_selection;
  bool has_keyframes;
  bool removal_started;
  bool operator==(const ModelState&) const = default;
};

struct ModelRequest {
  ModelState state;
  Operation operation;
};

struct ModelPlan {
  ModelState state;
  bool clear_all_frames = false;
  bool clear_all_frames_argument = false;
  bool requires_keyframe_confirmation = false;
  std::optional<Operation> wrapper_operation;
  bool operator==(const ModelPlan&) const = default;
};

// Describes calls only. It does not execute keyframe changes or dialog callbacks.
bool plan_model_action(const ModelRequest& request, ModelPlan& output) noexcept;

}  // namespace creator_contract
