#include "filter_time.hpp"
#include "wrapped_time.hpp"

namespace editor_contract {

FilterInsertTimes filter_insert_times(const FilterInsertRequest& request) noexcept {
  const auto duration = wrapped_difference(request.sequence.out, request.sequence.in);
  const bool relative_trim = request.amazing_filter_cast_succeeded &&
                             request.amazing_subtype == 3;
  const auto local_start = relative_trim ? 0 : request.sequence.in;
  // The output endpoint uses the original local start, before the input clamp.
  const TimeEndpoints trim{local_start < 0 ? 0 : local_start,
                           wrapped_sum(local_start, duration)};
  return {{request.sequence.in, wrapped_sum(request.sequence.in, duration)},
          trim, duration};
}

}  // namespace editor_contract
