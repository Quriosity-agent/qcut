#pragma once

#include <vector>

namespace editor_contract {

// This is the merge/resampling primitive, not the editor's seek state machine.
std::vector<std::vector<double>> resample_linear(
    const std::vector<double>& times,
    const std::vector<std::vector<double>>& values,
    const std::vector<double>& queries, bool hold_outside);

}  // namespace editor_contract
