#include "linear_property.hpp"
#include "test_support.hpp"

#include <array>
#include <cmath>
#include <iostream>

int main() {
  using namespace editor_contract;
  using editor_test::require;
  try {
    const ConstantSpeedSegment segment{{100000, 2000000}, {5000000, 1000000}, 2, 731};
    const std::array<double, 3> left{2, -3, 0}, right{10, 5, 1};
    const LinearPropertyInterval interval{100000, 2100000, left, right};
    require(evaluate_linear_property_interval(segment, interval, 600000) == std::vector<double>{4, -1, .25},
            "Linear property ignored mapped interval progress");
    const auto snapped = evaluate_linear_property_interval(segment, interval, 100999);
    require(snapped == std::vector<double>(left.begin(), left.end()), "Raw interior query missed near-start mapped snap");
    const std::array<double, 1> precise_left{9007199254740992.0}, precise_right{9007199254740994.0};
    const auto precision = evaluate_linear_property_interval(segment,
        {100000, 2100000, precise_left, precise_right}, 1700000);
    require(precision[0] == 9007199254740994.0, "Double property was narrowed to float");
    const std::array<double, 1> unfused_left{.1}, unfused_right{.9};
    const auto unfused = evaluate_linear_property_interval({{0, 19000}, {0, 19000}, 1},
        {1000, 18000, unfused_left, unfused_right}, 5000);
    require(unfused[0] == 0x1.2727272727272p-2, "Native non-fused property arithmetic changed");
    require(unfused[0] != std::fma(.9 - .1, 4.0 / 17.0, .1), "Fused countermodel no longer distinguishes this fixture");
    const std::array<double, 2> special_left{-0.0, INFINITY}, special_right{-0.0, INFINITY};
    const auto special = evaluate_linear_property_interval(segment,
        {100000, 2100000, special_left, special_right}, 1100000);
    require(!std::signbit(special[0]) && std::isnan(special[1]), "Linear arithmetic was replaced by endpoint identity shortcut");
    for (const auto query : {100000LL, 2100000LL, 99999LL, 2100001LL}) {
      bool rejected = false;
      try { static_cast<void>(evaluate_linear_property_interval(segment, interval, query)); }
      catch (const std::invalid_argument&) { rejected = true; }
      require(rejected, "Exact-hit/outside raw query was silently evaluated by the wrong branch");
    }
    bool rejected = false;
    try { static_cast<void>(evaluate_linear_property_interval(segment, {100000, 2100000, {}, right}, 1100000)); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Empty shape accepted");
    rejected = false;
    try { static_cast<void>(evaluate_linear_property_interval(segment, {100000, 2100000, left, precise_right}, 1100000)); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Mismatched shape accepted");
    const std::vector<double> excessive((1U << 20) + 1, 0);
    rejected = false;
    try { static_cast<void>(evaluate_linear_property_interval(segment,
        {100000, 2100000, excessive, excessive}, 1100000)); }
    catch (const std::length_error&) { rejected = true; }
    require(rejected, "Independent scalar budget was not enforced");
    rejected = false;
    try { static_cast<void>(evaluate_linear_property_interval({{0, 10}, {0, 10}, 1}, {0, 10, left, right}, 5)); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Degenerate mapped interval accepted");
    std::cout << "Linear property branch tests passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
