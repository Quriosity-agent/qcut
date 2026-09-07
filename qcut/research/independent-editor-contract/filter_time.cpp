#include "filter_time.hpp"

#include <bit>

namespace editor_contract {
namespace {

std::int64_t wrapped_add(std::int64_t left, std::int64_t right) noexcept {
  return std::bit_cast<std::int64_t>(static_cast<std::uint64_t>(left) +
                                     static_cast<std::uint64_t>(right));
}

std::int64_t wrapped_difference(std::int64_t end, std::int64_t start) noexcept {
  return std::bit_cast<std::int64_t>(static_cast<std::uint64_t>(end) -
                                     static_cast<std::uint64_t>(start));
}

}  // namespace

FilterInsertTimes filter_insert_times(const FilterInsertRequest& request) noexcept {
  const auto duration = wrapped_difference(request.sequence.out, request.sequence.in);
  const bool relative_trim = request.amazing_filter_cast_succeeded &&
                             request.amazing_subtype == 3;
  const auto local_start = relative_trim ? 0 : request.sequence.in;
  // The output endpoint uses the original local start, before the input clamp.
  const TimeEndpoints trim{local_start < 0 ? 0 : local_start,
                           wrapped_add(local_start, duration)};
  return {{request.sequence.in, wrapped_add(request.sequence.in, duration)},
          trim, duration};
}

}  // namespace editor_contract
