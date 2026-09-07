#pragma once

#include "common_keyframes.hpp"

namespace creator_contract {

// Null endpoints and curve type zero leave the corresponding side untouched.
void repair_control_pair(CommonKeyframe* left, CommonKeyframe* right);
void repair_controls_around(CommonKeyframeGroup& group, std::string_view id);

}  // namespace creator_contract
