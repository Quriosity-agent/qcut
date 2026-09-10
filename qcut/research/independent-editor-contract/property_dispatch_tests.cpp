#include "property_dispatch_fixtures.hpp"

#include <cmath>
#include <iostream>
#include <limits>

namespace {
using namespace editor_contract;
using editor_test::require;

PropertyDispatchResult evaluate(const editor_test::DispatchFixture& fixture, KeyframeWindow window,
                               std::string_view property = "qcut-window-probe", bool caption = false) {
  const auto frames = fixture.view();
  return dispatch_property_values({fixture.segment, frames, window, property, caption});
}

void branch_map() {
  editor_test::DispatchFixture fixture;
  fixture.segment = editor_test::dispatch_segment(0);
  fixture.frames = {{2000, {1, -1}, 0, {}, {}}, {9000, {2, -2}, 0, {}, {}}, {17000, {4, -4}, 0, {}, {}}};
  const auto hit = evaluate(fixture, {9000, 9000});
  require(hit.branch == PropertyDispatchBranch::ExactHit && hit.values == std::vector<double>{2, -2},
          "A closed window over one keyframe copies that keyframe verbatim");
  const auto below = evaluate(fixture, {-100000, -99000});
  require(below.branch == PropertyDispatchBranch::NextCopy && below.values == std::vector<double>{1, -1},
          "A midpoint under every keyframe copies the only neighbor");
  const auto above = evaluate(fixture, {900000, 910000});
  require(above.branch == PropertyDispatchBranch::PreviousCopy && above.values == std::vector<double>{4, -4},
          "A midpoint over every keyframe copies the only neighbor");
  // Mapped times are 4,300 and 8,300 for a 2x segment; the midpoint maps to 6,300 of 4,000 units.
  const auto linear = evaluate(fixture, {13000, 13000});
  require(linear.branch == PropertyDispatchBranch::Linear && linear.values[0] == 3 && linear.values[1] == -3,
          "Zero curve codes interpolate between the two neighbors");
  fixture.frames[1].curve_type = 5;
  const auto curved = evaluate(fixture, {13000, 13000});
  require(curved.branch == PropertyDispatchBranch::Curved && curved.values[0] != 3,
          "One nonzero curve code routes to the record and cubic path");
  fixture.frames[1].curve_type = 0;
  fixture.frames[2].values = {4};
  const auto ragged = evaluate(fixture, {13000, 13000});
  require(ragged.branch == PropertyDispatchBranch::SegmentDefault && ragged.values.empty(),
          "Neighbors with different shapes take the unmodeled Segment-type chain");
}

void clamped_branches() {
  // A target range far shorter than the speed ratio makes the endpoint snap map times downward.
  editor_test::DispatchFixture high;
  high.segment = editor_test::dispatch_segment(1);
  high.frames = {{31000, {11, -3}, 0, {}, {}}, {40500, {22, 7}, 0, {}, {}}};
  const auto clamped_next = evaluate(high, {33000, 33000});
  require(clamped_next.branch == PropertyDispatchBranch::ClampedNext &&
          clamped_next.values == std::vector<double>{22, 7}, "A mapped query above the right neighbor copies it");
  editor_test::DispatchFixture low;
  low.segment = editor_test::dispatch_segment(2);
  low.frames = {{40500, {11, -3}, 0, {}, {}}, {50000, {22, 7}, 0, {}, {}}};
  const auto clamped_previous = evaluate(low, {45000, 45000});
  require(clamped_previous.branch == PropertyDispatchBranch::ClampedPrevious &&
          clamped_previous.values == std::vector<double>{11, -3}, "A mapped query below the left neighbor copies it");
  require(evaluate(low, {40500, 40500}).branch == PropertyDispatchBranch::ExactHit,
          "The clamp fixture still resolves its own exact hits");
}

void copy_semantics() {
  editor_test::DispatchFixture fixture;
  fixture.segment = editor_test::dispatch_segment(0);
  const double payload = std::bit_cast<double>(0x7ff8000000001234ULL);
  fixture.frames = {{2000, {-0.0, payload}, 0, {}, {}},
                    {9000, {std::numeric_limits<double>::infinity(), -0.0}, 0, {}, {}}};
  const auto hit = evaluate(fixture, {2000, 2000});
  require(std::bit_cast<std::uint64_t>(hit.values[0]) == 0x8000000000000000ULL &&
          std::bit_cast<std::uint64_t>(hit.values[1]) == 0x7ff8000000001234ULL,
          "Exact-hit copies retain signed zero and NaN payload bits");
  // Progress zero still adds; the sum of a negative zero and a positive zero is positive.
  editor_test::DispatchFixture snapped;
  snapped.segment = editor_test::dispatch_segment(0);
  snapped.frames = {{1200, {-0.0}, 0, {}, {}}, {1500, {-0.0}, 0, {}, {}}, {20000, {8}, 0, {}, {}}};
  const auto boundary = evaluate(snapped, {1600, 1600});
  require(boundary.branch == PropertyDispatchBranch::Linear &&
          std::bit_cast<std::uint64_t>(boundary.values[0]) == 0,
          "An equal mapped left bound stays on the arithmetic path");
  const auto degenerate = evaluate(snapped, {1350, 1350});
  require(degenerate.branch == PropertyDispatchBranch::Linear && std::isnan(degenerate.values[0]),
          "Equal mapped bounds divide zero by zero instead of being rejected");
  // A copied but empty vector is exactly what the native logger reports before the fallback.
  editor_test::DispatchFixture empty;
  empty.segment = editor_test::dispatch_segment(0);
  empty.frames = {{2000, {}, 0, {}, {}}, {9000, {1}, 0, {}, {}}};
  require(evaluate(empty, {2000, 2000}).branch == PropertyDispatchBranch::SegmentDefault,
          "An empty exact hit falls back instead of returning an empty result");
  require(evaluate(empty, {-100000, -99000}).branch == PropertyDispatchBranch::SegmentDefault,
          "An empty single-neighbor copy falls back as well");
  require(evaluate(empty, {9000, 9000}).values == std::vector<double>{1},
          "A nonempty exact hit in the same group still returns");
}

void captured_goldens() {
  struct Golden { std::size_t shape, config; KeyframeWindow window; PropertyDispatchBranch branch;
                  std::vector<std::uint64_t> bits; };
  const std::vector<Golden> goldens{
      {0, 16, {17000, 17000}, PropertyDispatchBranch::ExactHit, {0x4008000000000000ULL}},
      {0, 16, {-100000, -99000}, PropertyDispatchBranch::NextCopy, {0x3ff0000000000000ULL}},
      {0, 16, {900000, 910000}, PropertyDispatchBranch::PreviousCopy, {0x4014000000000000ULL}},
      {0, 16, {13000, 13000}, PropertyDispatchBranch::Linear, {0x4004000000000000ULL}},
      {0, 18, {13000, 13000}, PropertyDispatchBranch::Curved,
       {0x3fb6ef8f20000000ULL, 0x3fb6ef8f20000000ULL, 0x3fb6ef8f20000000ULL}},
      {1, 4, {10004, 10004}, PropertyDispatchBranch::Linear, {0x3fd2727272727272ULL, 0x0000000000000001ULL}},
      {1, 4, {10001, 10001}, PropertyDispatchBranch::Linear, {0x3fc2d2d2d2d2d2d3ULL, 0x0000000000000001ULL}},
      {2, 4, {33000, 33000}, PropertyDispatchBranch::ClampedNext,
       {0x8000000000000001ULL, 0x000fffffffffffffULL, 0x0010000000000000ULL}},
      {3, 4, {45000, 45000}, PropertyDispatchBranch::ClampedPrevious,
       {0x8000000000000001ULL, 0x000fffffffffffffULL, 0x0010000000000000ULL, 0x7fefffffffffffffULL}},
      {4, 8, {1600, 1600}, PropertyDispatchBranch::Linear, {0x0000000000000000ULL}},
      {4, 8, {1350, 1350}, PropertyDispatchBranch::Linear, {0x7ff8000000000000ULL}},
      {5, 8, {40100, 40100}, PropertyDispatchBranch::Linear,
       {0x0000000000000000ULL, 0x0000000000000000ULL}},
      {10, 4, {1250, 1250}, PropertyDispatchBranch::Linear,
       {0x7ff8000000000000ULL, 0x7ff8000000001234ULL, 0xfff8000000000001ULL}},
      {9, 9, {INT64_MAX, INT64_MAX}, PropertyDispatchBranch::Curved,
       {0xffffffffe0000000ULL, 0x3fe0000000000000ULL, 0x3fe0000000000000ULL}},
      {6, 7, {1, -1}, PropertyDispatchBranch::Curved,
       {0x3fb99999a0000000ULL, 0x3fe3333340000000ULL}}};
  for (const auto& golden : goldens) {
    const auto fixture = editor_test::dispatch_fixture(golden.shape, golden.config);
    const auto actual = evaluate(fixture, golden.window);
    require(actual.branch == golden.branch, "Native golden branch differs");
    require(actual.values.size() == golden.bits.size(), "Native golden shape differs");
    for (std::size_t i = 0; i < actual.values.size(); ++i) {
      const auto expected = std::bit_cast<double>(golden.bits[i]);
      if (std::isnan(expected)) { require(std::isnan(actual.values[i]), "Native golden NaN classification differs"); }
      else { require(std::bit_cast<std::uint64_t>(actual.values[i]) == golden.bits[i], "Native golden bits differ"); }
    }
  }
}

void native_corpus() {
  std::uint64_t fingerprint = editor_test::kFnvStart, calls = 0, values = 0, nan = 0;
  std::array<std::uint64_t, 8> branches{};
  for (std::size_t shape = 0; shape < editor_test::kDispatchShapes; ++shape) {
    for (std::size_t config = 0; config < editor_test::kDispatchConfigs; ++config) {
      const auto fixture = editor_test::dispatch_fixture(shape, config);
      const auto frames = fixture.view();
      for (const auto window : editor_test::dispatch_windows(fixture)) {
        const auto actual = dispatch_property_values({fixture.segment, frames, window, "qcut-window-probe", false});
        ++branches[static_cast<std::size_t>(actual.branch)];
        editor_test::hash_integer(fingerprint, static_cast<std::uint64_t>(actual.branch), 1);
        for (const auto value : actual.values) {
          const bool is_nan = std::isnan(value);
          editor_test::hash_integer(fingerprint, is_nan ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
          ++values; if (is_nan) ++nan;
        }
        ++calls;
      }
    }
  }
  require(fingerprint == 1171570040708058013ULL, "Property dispatch corpus differs");
  require(calls == 7944 && values == 19816 && nan == 1558, "Property dispatch corpus coverage changed");
  require(branches[0] == 160 && branches[1] == 2352 && branches[2] == 2340 && branches[3] == 1532 &&
          branches[4] == 107 && branches[5] == 53 && branches[6] == 495 && branches[7] == 905,
          "Property dispatch branch histogram changed");
  std::cout << "Native corpus " << calls << " calls / " << values << " values / " << nan << " NaNs\n";
}

template <class Function> void rejects(Function function) {
  try { function(); } catch (const std::invalid_argument&) { return; } catch (const std::length_error&) { return; }
  throw std::runtime_error("Unsupported property dispatch domain was not rejected");
}

void invalid_inputs() {
  auto fixture = editor_test::dispatch_fixture(0, 16);
  auto frames = fixture.view();
  auto evaluate_window = [&] { return dispatch_property_values({fixture.segment, frames, {13000, 13000},
      "qcut-window-probe", false}); };
  require(evaluate_window().branch == PropertyDispatchBranch::Linear, "The baseline fixture stays inside the domain");
  frames[2].has_graph = true;
  rejects(evaluate_window);
  frames = fixture.view();
  const auto segment = fixture.segment;
  fixture.segment.speed = 0; rejects(evaluate_window);
  fixture.segment = segment; fixture.segment.speed = std::numeric_limits<double>::quiet_NaN(); rejects(evaluate_window);
  fixture.segment = segment; fixture.segment.source.duration = -1; rejects(evaluate_window);
  fixture.segment = segment; fixture.segment.target.duration = -1; rejects(evaluate_window);
  fixture.segment = segment;
  // Caption color dispatch is recognized and refused, never guessed.
  for (const auto property : {"KFTypeTextColor", "KFTypeBorderColor", "KFTypeShadowColor", "KFTypeBackgroundColor"}) {
    rejects([&] { return dispatch_property_values({fixture.segment, frames, {13000, 13000}, property, true}); });
    require(dispatch_property_values({fixture.segment, frames, {13000, 13000}, property, false}).branch ==
            PropertyDispatchBranch::Linear, "The Caption gate needs the predicate, not only the property name");
  }
  require(dispatch_property_values({fixture.segment, frames, {13000, 13000}, "KFTypeTextColour", true}).branch ==
          PropertyDispatchBranch::Linear, "The Caption gate compares the whole property name");
  require(dispatch_property_values({fixture.segment, frames, {17000, 17000}, "KFTypeTextColor", true}).branch ==
          PropertyDispatchBranch::ExactHit, "The Caption gate is behind the neighbor arithmetic path");
  // Equal empty neighbor shapes pass the native size test; their result was not traced, so refuse it.
  const std::vector<DispatchKeyframe> both_empty{{{2000, {}, 0, {}, {}}, false}, {{9000, {}, 0, {}, {}}, false}};
  rejects([&] { return dispatch_property_values({fixture.segment, both_empty, {6000, 6000}, "p", false}); });
  const std::vector<double> oversized(1U << 20, 1);
  const std::vector<DispatchKeyframe> wide{{{2000, oversized, 0, {}, {}}, false},
                                           {{9000, oversized, 0, {}, {}}, false}};
  require(dispatch_property_values({fixture.segment, wide, {6000, 6000}, "p", false}).values.size() == (1U << 20),
          "The largest supported shape still evaluates");
  const std::vector<double> too_wide((1U << 20) + 1, 1);
  const std::vector<DispatchKeyframe> huge{{{2000, too_wide, 0, {}, {}}, false}};
  rejects([&] { return dispatch_property_values({fixture.segment, huge, {6000, 6000}, "p", false}); });
}

void empty_group() {
  const auto segment = editor_test::dispatch_segment(0);
  const auto result = dispatch_property_values({segment, {}, {13000, 13000}, "qcut-window-probe", false});
  require(result.branch == PropertyDispatchBranch::SegmentDefault && result.values.empty(),
          "An empty group reports the unmodeled Segment-type chain");
  const std::vector<DispatchKeyframe> single{{{9000, std::span<const double>{}, 0, {}, {}}, false}};
  require(dispatch_property_values({segment, single, {13000, 13000}, "p", false}).branch ==
          PropertyDispatchBranch::SegmentDefault, "A single empty keyframe also falls back");
}

}  // namespace

int main() {
  try {
    branch_map(); clamped_branches(); copy_semantics(); captured_goldens();
    native_corpus(); invalid_inputs(); empty_group();
    std::cout << "7 property dispatch groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
