#include "time_adapter.hpp"
#include "wrapped_time.hpp"

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {

PreparedCubic prepare_cubic_interval(const CubicInterval& interval,
                                    IntervalProgress progress) noexcept {
  const auto& input = interval;
  const double left_time = static_cast<double>(input.left_time);
  const double right_time = static_cast<double>(input.right_time);
  const double elapsed = static_cast<double>(wrapped_difference(progress.query_time, progress.left_time));
  const double duration = static_cast<double>(wrapped_difference(progress.right_time, progress.left_time));
  return {{{{{static_cast<float>(left_time), static_cast<float>(input.left_value)},
              {static_cast<float>(input.left_outgoing.time + left_time),
               static_cast<float>(input.left_outgoing.value + input.left_value)},
              {static_cast<float>(input.right_incoming.time + right_time),
               static_cast<float>(input.right_incoming.value + input.right_value)},
              {static_cast<float>(right_time), static_cast<float>(input.right_value)}}}},
          static_cast<float>(elapsed / duration)};
}

}  // namespace editor_contract
