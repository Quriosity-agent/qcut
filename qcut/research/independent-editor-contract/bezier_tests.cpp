#include "bezier.hpp"
#include "test_support.hpp"

#include <bit>
#include <cmath>
#include <iostream>

namespace {
using editor_contract::CubicCurve;
using editor_contract::evaluate_cubic;
using editor_test::require;

void test_native_samples() {
  struct Sample { std::array<std::uint32_t, 9> input; std::uint32_t output; };
  // Numeric oracle results from the actual VEUtils virtual slot, not its similar free function.
  constexpr std::array<Sample, 24> samples{{
      {{{0x40088000U, 0x00000000U, 0x40088000U, 0xc0cb0000U, 0x40088000U, 0xc0710000U, 0x40088000U, 0x419f8000U, 0x00000000U}}, 0x00000000U},
      {{{0xc0d5c000U, 0xc1cd6000U, 0xc1350000U, 0x3f940000U, 0xc1570000U, 0xc10fc000U, 0x40798000U, 0x41f9c000U, 0x3f366666U}}, 0x41c1bed6U},
      {{{0x40110000U, 0xc1340000U, 0xc0cc4000U, 0x406e0000U, 0x409c0000U, 0x418c4000U, 0x40c20000U, 0xc149c000U, 0x3e820c4aU}}, 0x4062d261U},
      {{{0xc1474000U, 0xc1f00000U, 0xc0df4000U, 0x40470000U, 0x40b00000U, 0x3fe80000U, 0x40300000U, 0xc0d70000U, 0x80000001U}}, 0xc1f00000U},
      {{{0x410c6000U, 0xc1df2000U, 0xc1242000U, 0x40f90000U, 0xc0d14000U, 0x40dc0000U, 0xc10de000U, 0xc1e1e000U, 0x3df97247U}}, 0xc1becc13U},
      {{{0x415cc000U, 0xc18f4000U, 0xc15b6000U, 0x411d0000U, 0x415d4000U, 0x41520000U, 0xc1798000U, 0x41690000U, 0x3f34d014U}}, 0x415e287eU},
      {{{0xc0ce4000U, 0x41b26000U, 0x413ec000U, 0xc0bd8000U, 0xc15ea000U, 0x40360000U, 0x3f460000U, 0x41926000U, 0x3f7ffff0U}}, 0x41926000U},
      {{{0x40430000U, 0xc13d4000U, 0xc14f8000U, 0x419ae000U, 0x409e4000U, 0x41d50000U, 0xc1100000U, 0xc1b38000U, 0x3f4a511aU}}, 0xc14cef04U},
      {{{0x3f1e0000U, 0xc124c000U, 0x4162c000U, 0xc1ea8000U, 0xc12fc000U, 0x41f36000U, 0x3f1e0000U, 0x40510000U, 0x3f1c91d1U}}, 0x40510000U},
      {{{0x40abc000U, 0xc1e0a000U, 0x41554000U, 0xc12bc000U, 0x40f18000U, 0xc1a84000U, 0xc0120000U, 0xc1a9a000U, 0xbf800000U}}, 0xc1e0a000U},
      {{{0xc03f8000U, 0x41bea000U, 0xc0ca0000U, 0x41e64000U, 0x410bc000U, 0xc0b70000U, 0xc09ec000U, 0x41144000U, 0x3eda36e3U}}, 0x41012e5fU},
      {{{0xc0c90000U, 0xc1174000U, 0xc0c90000U, 0x41bf2000U, 0xc1568000U, 0xc1150000U, 0x40710000U, 0x40100000U, 0x3e857a78U}}, 0xbe7b4413U},
      {{{0xc169e000U, 0xbf500000U, 0xc171a000U, 0x41a06000U, 0x414dc000U, 0x41f24000U, 0xc0b3c000U, 0xc06c0000U, 0xff800000U}}, 0xbf500000U},
      {{{0xc174a000U, 0x4108c000U, 0xc1354000U, 0x41cd4000U, 0xc1050000U, 0xc1470000U, 0xc1050000U, 0x419a2000U, 0x3e8c7e28U}}, 0x41517d22U},
      {{{0xc11dc000U, 0xc0820000U, 0x408c0000U, 0x41c40000U, 0x414f2000U, 0xc1e00000U, 0xc1252000U, 0xc1aa2000U, 0x3ea0ebeeU}}, 0xc1aad53aU},
      {{{0xc1626000U, 0x41a34000U, 0x3f460000U, 0xc1a58000U, 0x40578000U, 0xc1ea6000U, 0xc1202000U, 0x40490000U, 0xff7fffffU}}, 0x41a34000U},
      {{{0x41044000U, 0x410a4000U, 0xc1614000U, 0xc1688000U, 0x41228000U, 0xc1aac000U, 0x41044000U, 0xc0d68000U, 0x3e80ded3U}}, 0xc0d68000U},
      {{{0xc0150000U, 0xc1af4000U, 0x4100c000U, 0x80000000U, 0x411a4000U, 0xc17c4000U, 0x40a8c000U, 0xc10f8000U, 0x3f2a43feU}}, 0xc14fd26dU},
      {{{0xc1166000U, 0xc0d88000U, 0x4165e000U, 0xc1d7c000U, 0x416ec000U, 0xc11fc000U, 0xbfe30000U, 0xc1b4c000U, 0x00000001U}}, 0xc0d88000U},
      {{{0xbfcf0000U, 0xc0848000U, 0xc143e000U, 0x41cfc000U, 0xc178c000U, 0x41da4000U, 0x41536000U, 0x40f20000U, 0x3ea84b5eU}}, 0x4165ead0U},
      {{{0x40c5c000U, 0xc17f4000U, 0xc14d0000U, 0x41dd2000U, 0xc11fe000U, 0x41a12000U, 0xc1662000U, 0xc1c30000U, 0x3ed7dbf5U}}, 0x405cf6a6U},
      {{{0xbf780000U, 0x414dc000U, 0x4124a000U, 0x41c12000U, 0x40ccc000U, 0x418b2000U, 0x3edc0000U, 0x417b0000U, 0x358637bdU}}, 0x414dc022U},
      {{{0x40a3c000U, 0x41828000U, 0x40a3c000U, 0xc1b66000U, 0x4150e000U, 0xc1e9c000U, 0xc1198000U, 0xc08b8000U, 0x3f5c7e28U}}, 0xc0d356bfU},
      {{{0xc144e000U, 0x413c0000U, 0xc1214000U, 0xc0d88000U, 0xc1496000U, 0xc1cf4000U, 0x411f4000U, 0x4125c000U, 0x3f544674U}}, 0x408df208U},
  }};
  for (const auto& sample : samples) {
    CubicCurve curve{};
    for (std::size_t i = 0; i < 4; ++i) {
      curve.points[i] = {std::bit_cast<float>(sample.input[i * 2]),
                         std::bit_cast<float>(sample.input[i * 2 + 1])};
    }
    const auto actual = evaluate_cubic(curve, std::bit_cast<float>(sample.input[8]));
    require(std::bit_cast<std::uint32_t>(actual) == sample.output, "Native cubic sample bits differ");
  }
}

void test_interval_fraction_and_endpoints() {
  const CubicCurve symmetric{{{{10, 0}, {12, 0}, {18, 1}, {20, 1}}}};
  require(evaluate_cubic(symmetric, .5F) == .5F, "Query is normalized, not absolute time");
  for (const float progress : {-INFINITY, -1.F, -0.F, 0.F, 0.0000005F}) {
    require(evaluate_cubic(symmetric, progress) == 0, "Lower endpoint tolerance differs");
  }
  for (const float progress : {0.9999995F, 1.F, 2.F, INFINITY}) {
    require(evaluate_cubic(symmetric, progress) == 1, "Upper endpoint tolerance differs");
  }
  const float quarter = evaluate_cubic(symmetric, .25F);
  require(quarter > .1F && quarter < .25F, "Curve unexpectedly became linear");
  require(evaluate_cubic(symmetric, .75F) > .75F, "Curve easing direction differs");
  require(evaluate_cubic(symmetric, .25F) == quarter, "Evaluation depends on previous query order");
}

void test_ieee_and_unclamped_values() {
  const CubicCurve constant{{{{0, 3}, {.25F, 3}, {.75F, 3}, {1, 3}}}};
  require(evaluate_cubic(constant, .5F) == 3, "Curve values were clamped to UI range");
  const CubicCurve overshoot{{{{0, 0}, {.25F, 4}, {.75F, 4}, {1, 1}}}};
  require(evaluate_cubic(overshoot, .5F) > 1, "Control-point overshoot was removed");
  auto invalid_value = constant;
  invalid_value.points[1].value = INFINITY;
  require(std::isnan(evaluate_cubic(invalid_value, 0)), "Endpoint improperly skipped IEEE y arithmetic");
  auto coincident = constant;
  for (auto& point : coincident.points) point.time = 0;
  require(std::isfinite(evaluate_cubic(coincident, .5F)), "Coincident x controls must terminate");
  require(std::isfinite(evaluate_cubic(constant, NAN)), "NaN query must terminate in bounded search");
}
}  // namespace

int main() {
  try {
    test_native_samples();
    test_interval_fraction_and_endpoints();
    test_ieee_and_unclamped_values();
    std::cout << "3 cubic evaluation groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
