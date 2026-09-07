#pragma once

#include "nonlinear_property.hpp"

namespace editor_contract::property_detail {
void validate_interval(const NonlinearPropertyInterval& interval, std::int64_t query);
std::vector<double> evaluate_records(const NonlinearPropertyInterval& interval,
    const ControlTimeRecord& first, const ControlTimeRecord& last,
    std::int64_t mapped_left, std::int64_t query);
}  // namespace editor_contract::property_detail
