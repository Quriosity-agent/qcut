#pragma once

#include "graph.hpp"

namespace editor_contract::graph_detail {
std::vector<double> evaluate_records(std::span<const GraphRecord> records,
    std::span<const double> right_values, std::int64_t mapped_left, std::int64_t query);
}  // namespace editor_contract::graph_detail
