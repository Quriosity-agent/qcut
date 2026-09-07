#pragma once

#include <cstdint>

namespace editor_contract {

struct TimeEndpoints {
  std::int64_t in = 0;
  std::int64_t out = 0;
  bool operator==(const TimeEndpoints&) const = default;
};

struct FilterInsertRequest {
  TimeEndpoints sequence;
  bool amazing_filter_cast_succeeded = false;
  std::int32_t amazing_subtype = 0;
};

struct FilterInsertTimes {
  TimeEndpoints sequence;
  TimeEndpoints trim;
  std::int64_t duration = 0;
  bool operator==(const FilterInsertTimes&) const = default;
};

// Opaque integer time units; no assumption about frames, ticks or microseconds.
FilterInsertTimes filter_insert_times(const FilterInsertRequest& request) noexcept;

}  // namespace editor_contract
