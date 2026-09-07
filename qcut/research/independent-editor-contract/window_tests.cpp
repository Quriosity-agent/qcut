#include "window.hpp"
#include "wrapped_time.hpp"
#include "test_support.hpp"

#include <array>
#include <iostream>
#include <limits>
#include <vector>

namespace {
using editor_contract::KeyframeWindow;
using editor_contract::WindowSelection;
using editor_contract::select_keyframe_window;
using editor_test::require;

void test_windows_and_neighbors() {
  const std::array<std::int64_t, 4> times{-10, 0, 10, 20};
  require(select_keyframe_window(times, {-1, 1}) == WindowSelection{0, 1, 0, 2}, "Closed window hit differs");
  require(select_keyframe_window(times, {10, 10}) == WindowSelection{10, 2, 1, 3}, "Exact hit differs");
  require(select_keyframe_window(times, {5, 5}) == WindowSelection{5, {}, 1, 2}, "Between-keyframe neighbors differ");
  require(select_keyframe_window(times, {-20, -20}) == WindowSelection{-20, {}, {}, 0}, "Before-first neighbor differs");
  require(select_keyframe_window(times, {25, 25}) == WindowSelection{25, {}, 3, {}}, "After-last neighbor differs");
  require(select_keyframe_window(times, {10, -10}) == WindowSelection{0, {}, 1, 2}, "Reversed window was normalized");
  require(select_keyframe_window({}, {-2, -1}) == WindowSelection{-1, {}, {}, {}}, "Empty list or negative midpoint differs");
}

void test_ties_duplicates_and_early_stop() {
  const std::array<std::int64_t, 4> duplicate{0, 0, 10, 20};
  require(select_keyframe_window(duplicate, {0, 0}) == WindowSelection{0, 0, {}, 1}, "Duplicate did not preserve first hit");
  // The tie between the first two entries stops the search before the exact hit at 10.
  require(select_keyframe_window(duplicate, {10, 10}) == WindowSelection{10, {}, 0, {}}, "Duplicate tie was silently skipped");
  const std::array<std::int64_t, 3> unsorted{10, 20, 0};
  require(select_keyframe_window(unsorted, {0, 0}) == WindowSelection{0, {}, {}, 0}, "Search became a global nearest scan");
  const std::array<std::int64_t, 3> equal_distance{-10, 10, 20};
  require(select_keyframe_window(equal_distance, {-10, 10}) == WindowSelection{0, 0, {}, 1}, "Equal-distance window picked later frame");
  const std::array<std::int64_t, 5> queries{20, -20, 0, 10, 0};
  const std::array<WindowSelection, 5> expected{{{20, {}, 0, {}}, {-20, {}, {}, 0},
      {0, 0, {}, 1}, {10, {}, 0, {}}, {0, 0, {}, 1}}};
  for (std::size_t i = 0; i < queries.size(); ++i) {
    require(select_keyframe_window(duplicate, {queries[i], queries[i]}) == expected[i],
            "Forward/backward query sequence changed a known result");
  }
}

void test_wrapped_integer_boundaries() {
  using namespace editor_contract;
  constexpr auto low = std::numeric_limits<std::int64_t>::min();
  constexpr auto high = std::numeric_limits<std::int64_t>::max();
  require(wrapped_midpoint(high, high) == -1, "Overflow was avoided before averaging");
  require(wrapped_midpoint(low, low) == 0, "Minimum-time sum did not wrap");
  require(wrapped_midpoint(-2, -1) == -1, "Negative odd midpoint did not truncate toward zero");
  require(wrapped_midpoint(low, high) == 0, "Mixed signed boundary midpoint differs");
  require(wrapped_difference(low, 1) == high, "Time subtraction did not wrap");
  require(wrapped_distance(low, 0) == low, "Minimum distance was saturated or widened");
  const std::array<std::int64_t, 4> times{low, -1, 0, high};
  require(select_keyframe_window(times, {0, 0}) == WindowSelection{0, {}, 0, {}}, "Signed wrapped distance comparison differs");
  require(select_keyframe_window(times, {high, high}) == WindowSelection{-1, {}, 1, 2}, "Overflowed midpoint selection differs");
  bool rejected = false;
  try { static_cast<void>(select_keyframe_window(std::vector<std::int64_t>((1U << 20) + 1), {0, 0})); }
  catch (const std::length_error&) { rejected = true; }
  require(rejected, "Independent selection budget was not enforced");
}
}  // namespace

int main() {
  try {
    test_windows_and_neighbors();
    test_ties_duplicates_and_early_stop();
    test_wrapped_integer_boundaries();
    std::cout << "3 window-selection groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
