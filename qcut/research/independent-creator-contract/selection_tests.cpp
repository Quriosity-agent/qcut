#include "selection.hpp"
#include "test_support.hpp"

#include <array>
#include <cmath>
#include <limits>
#include <vector>

using namespace creator_contract;

int main() {
  Checks checks;
  const double infinity = std::numeric_limits<double>::infinity();
  const double nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000000123});
  const std::array candidates{
      ResolvedCandidate{"z", true, .239}, ResolvedCandidate{"a", false, .8},
      ResolvedCandidate{"z", true, .7}, ResolvedCandidate{"a", true, .235},
      ResolvedCandidate{"wrong-type", false, .2}, ResolvedCandidate{"missing-value", true, std::nullopt}};
  const auto selection = select_filters({candidates});
  checks.require(selection.values.size() == 3, "skip invalid and deduplicate valid IDs");
  checks.require(selection.values.begin()->first == "a", "lexicographic traversal");
  checks.same_bits(*selection.values.at("z"), .239, "first successful duplicate retains its value");
  checks.same_bits(*selection.values.at("a"), .235, "invalid first duplicate does not block insertion");
  checks.require(select_filters({candidates, false}).values.empty(), "missing query utils clears selection");
  const std::array unusual_ids{ResolvedCandidate{"", true, .2}, ResolvedCandidate{"a\0b", true, .3},
      ResolvedCandidate{std::string("a\0b", 3), true, .4}, ResolvedCandidate{std::string(1000, 'q'), true, .5}};
  checks.require(select_filters({unusual_ids}).values.size() == 4, "IDs are byte strings, no extra validation");

  const auto empty = aggregate_value({});
  checks.require(empty.kind == ValueKind::empty, "empty classification");
  checks.same_bits(empty.value, 0.0, "empty returns positive zero");
  for (double value : {-.0, .235, -1.0, nan, infinity, -infinity}) {
    const auto single = aggregate_value({{{"one", value}}});
    checks.require(single.kind == ValueKind::single, "single classification");
    checks.same_bits(single.value, value, "single preserves exact value including NaN payload");
  }
  checks.same_bits(aggregate_value({{{"one", std::nullopt}}}).value, 0.0, "missing keyframe value uses zero fallback");

  struct Pair { double a; double b; bool equal; };
  const std::array pairs{
      Pair{.231, .234, true}, Pair{.234, .236, false}, Pair{0, -.004, true},
      Pair{.005, 0, false}, Pair{-.005, 0, false},
      Pair{std::nextafter(.005, 0), 0, true}, Pair{std::nextafter(-.005, 0), 0, true},
      Pair{.235, .234, true}, Pair{.235, .236, false},
      Pair{1e10, 1e10 + .01, true}, Pair{1e10, 1e10 + .02, false},
      Pair{infinity, -infinity, true}, Pair{-infinity, infinity, true},
      Pair{infinity, 1, false}, Pair{1, infinity, false}, Pair{nan, nan, false},
      Pair{nan, 0, false}, Pair{0, nan, false}, Pair{infinity, nan, false},
      Pair{std::numeric_limits<double>::max(), std::numeric_limits<double>::max(), false}};
  for (const auto& pair : pairs) {
    checks.require(same_display_bucket({pair.a, pair.b}) == pair.equal, "static comparison golden fixture");
    const auto result = aggregate_value({{{"a", pair.a}, {"z", pair.b}}});
    checks.require(result.kind == (pair.equal ? ValueKind::uniform : ValueKind::mixed), "aggregate golden classification");
    checks.same_bits(result.value, pair.equal ? pair.a : -1.0, "uniform raw first or mixed sentinel");
  }
  const auto sorted_first = aggregate_value({{{"z", .234}, {"a", .231}, {"b", .233}}});
  checks.same_bits(sorted_first.value, .231, "first by key, not average or rounded bucket");
  const auto negative_zero = aggregate_value({{{"a", -.0}, {"b", 0.0}}});
  checks.same_bits(negative_zero.value, -.0, "uniform preserves first signed zero");
  checks.require(aggregate_value({{{"a", -1}, {"b", -1}}}).kind == ValueKind::uniform,
                 "kind distinguishes legitimate -1 from mixed sentinel");
  return checks.finish();
}
