#include "resample.hpp"
#include "test_support.hpp"

#include <cmath>
#include <iostream>
#include <limits>

namespace {
using editor_contract::resample_linear;
using editor_test::require;

void test_intervals_and_outside_policy() {
  const std::vector<double> times{0, 10, 20};
  const std::vector<std::vector<double>> values{{0, 10}, {100, -10}, {200, 20}};
  const std::vector<double> queries{-1, 0, 2.5, 10, 15, 20, 21};
  require(resample_linear(times, values, queries, false) ==
      std::vector<std::vector<double>>{{0, 0}, {0, 10}, {25, 5}, {100, -10}, {150, 5}, {200, 20}, {0, 0}},
      "Closed-interval interpolation or zero-fill differs");
  require(resample_linear(times, values, {-1, 21}, true) ==
      std::vector<std::vector<double>>{{0, 10}, {200, 20}}, "Outside endpoint hold differs");
  require(resample_linear({10}, {{7, -2}}, {9, 10, 11}, false) ==
      std::vector<std::vector<double>>(3, {0, 0}), "Singleton without hold must be zero");
  require(resample_linear({10}, {{7, -2}}, {9, 10, 11}, true) ==
      std::vector<std::vector<double>>(3, {7, -2}), "Singleton hold differs");
}

void test_duplicates_ieee_and_query_order() {
  const auto leading = resample_linear({0, 0, 1}, {{2}, {4}, {8}}, {0, 0.5}, true);
  require(std::isnan(leading[0][0]) && leading[1][0] == 6, "Leading duplicates must retain zero division");
  const std::vector<double> times{0, 1, 1, 2};
  const std::vector<std::vector<double>> values{{0}, {10}, {30}, {40}};
  require(resample_linear(times, values, {1, 1.5, 0.5, 1}, false) ==
      std::vector<std::vector<double>>{{10}, {35}, {5}, {10}}, "First closed pair or query independence differs");
  const auto nan = std::numeric_limits<double>::quiet_NaN();
  const auto inf = std::numeric_limits<double>::infinity();
  require(resample_linear({0, 1}, {{2}, {3}}, {nan}, true)[0][0] == 0,
          "NaN query must fall through to zero-fill");
  require(resample_linear({0, 1}, {{2}, {3}}, {-inf, inf}, true) ==
      std::vector<std::vector<double>>{{2}, {3}}, "Infinite query endpoint hold differs");
  require(std::isnan(resample_linear({0, 1}, {{2}, {inf}}, {0}, false)[0][0]),
          "Exact endpoint must not bypass the native arithmetic");
  const double largest = std::numeric_limits<double>::max();
  require(std::isinf(resample_linear({0, 1}, {{-largest}, {largest}}, {.5}, false)[0][0]),
          "Overflowing value delta was silently repaired");
  const auto zero = resample_linear({0, 1}, {{-0.0}, {0.0}}, {0}, false)[0][0];
  require(!std::signbit(zero), "Interpolated signed zero arithmetic differs");
}

void test_independent_validation() {
  const auto rejects = [](const auto& times, const auto& values) {
    try { static_cast<void>(resample_linear(times, values, {0}, false)); }
    catch (const std::exception&) { return true; }
    return false;
  };
  using Rows = std::vector<std::vector<double>>;
  require(rejects(std::vector<double>{}, Rows{}), "Empty series accepted");
  require(rejects(std::vector<double>{0, 1}, Rows{{1}}), "Mismatched row count accepted");
  require(rejects(std::vector<double>{0, 1}, Rows{{1}, {1, 2}}), "Ragged rows accepted");
  require(rejects(std::vector<double>{1, 0}, Rows{{1}, {2}}), "Descending times accepted");
  require(rejects(std::vector<double>{NAN}, Rows{{1}}), "NaN time accepted");
  require(rejects(std::vector<double>{INFINITY}, Rows{{1}}), "Infinite time accepted");
  require(resample_linear({0, 1}, {{}, {}}, {0, .5, 1}, false).size() == 3,
          "Zero-dimensional rows are valid");
  require(resample_linear({0}, {{1}}, {}, false).empty(), "Empty query should yield no rows");
  bool bounded = false;
  try { static_cast<void>(resample_linear({0}, {std::vector<double>(1025)},
                                        std::vector<double>(1025), true)); }
  catch (const std::length_error&) { bounded = true; }
  require(bounded, "Output budget was not checked before allocation");
  bounded = false;
  try { static_cast<void>(resample_linear(std::vector<double>(4097), Rows(4097),
                                        std::vector<double>(4097), true)); }
  catch (const std::length_error&) { bounded = true; }
  require(bounded, "Zero-dimensional series bypassed the work budget");
}
}  // namespace

int main() {
  try {
    test_intervals_and_outside_policy();
    test_duplicates_ieee_and_query_order();
    test_independent_validation();
    std::cout << "3 resampling groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
