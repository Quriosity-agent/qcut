#include "crop_selection_fixtures.hpp"
#include "transform_plan.hpp"

#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace lens_contract;
namespace fixtures = lens_contract::selection_fixtures;
std::size_t checks = 0;
void expect(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}
void thresholds_and_history() {
  const CenterFocusConfiguration configuration{0.5F, 0.5F, 0.8F, 80, 40};
  CenterFocus exact;
  CenterFocus above;
  expect(exact.initialize(configuration) && above.initialize(configuration), "Threshold init");
  const DetectionBounds at_threshold{10.0F, 5.0F, 74.0F, 38.0F};
  auto above_threshold = at_threshold;
  above_threshold[0] = std::nextafter(10.0F, 12.0F);
  expect(exact.process(at_threshold) && above.process(above_threshold), "Threshold input");
  expect(exact.state().adjusted[0] == 10.0F && exact.state().adjusted[1] == 5.0F,
         "Exact 2.5 percent boundary snaps");
  expect(above.state().adjusted[0] > 8.0F && above.state().adjusted[0] < 9.0F,
         "Just above boundary follows one fifth");
  expect(exact.state().adjusted[3] > 36.0F && exact.state().adjusted[3] < 37.0F,
         "Vertical threshold uses frame height");
  const auto selected = exact.state().previous;
  const auto incoming = exact.state().incoming;
  const auto first_output = exact.state().output;
  expect(exact.process({}), "Missing detection");
  expect(exact.state().adjusted == selected && exact.state().previous == selected &&
         exact.state().incoming == incoming, "Missing input retains adjusted detection history");
  expect(exact.state().output != first_output, "Missing detection still advances cropper and smoother");
}
void lifecycle_and_coordinates() {
  CenterFocus focus;
  expect(!focus.process({}), "Uninitialized processing must reject");
  expect(focus.initialize({0.0F, 1.0F, 0.8F, 257, 145}), "Odd dimensions init");
  expect(focus.state().previous == DetectionBounds{25.1999969482421875F, 14.0F, 230.8000030517578125F, 130.0F},
         "Integer half dimensions precede fractional crop extent");
  const DetectionBounds detection{50.0F, 40.0F, 90.0F, 70.0F};
  expect(focus.process(detection), "Lifecycle first frame");
  const auto previous = focus.state().previous;
  expect(focus.initialize({1.0F, 0.0F, 0.5F, 640, 480}), "Reinitialize");
  expect(focus.state().previous == previous && focus.smoother_state().first_frame &&
         focus.planner_state().previous_scale == 1.0F, "Reinit keeps detection but creates new children");
  expect(focus.process({}), "Reinit missing input");
  const auto child = focus.smoother_state();
  focus.reset();
  expect(!focus.state().ready && focus.state().previous == previous && focus.smoother_state() == child,
         "Reset changes scalars, not vectors or children");
  expect(!focus.process(detection), "Reset requires valid reinitialization in owned contract");
  expect(focus.initialize({0.5F, 0.5F, 0.8F, 80, 40}) && focus.process({}), "Reset then init");
  expect(focus.state().previous == DetectionBounds{8.0F, 4.0F, 72.0F, 36.0F} &&
         focus.state().output == DetectionBounds{2.0F, 1.0F, 78.0F, 39.0F}, "Native missing-first-frame golden");
  CenterFocus alternate;
  expect(alternate.initialize({0.0F, 1.0F, 0.8F, 80, 40}) && alternate.process({}), "Alternate stored anchors");
  expect(alternate.state().output == focus.state().output, "Init anchor fields are not cropper anchors");
}
void planner_edges() {
  CropPlanner planner;
  expect(planner.initialize(0.5F), "Planner init");
  CropPlannerRequest request{80, 40, {8.0F, 4.0F, 72.0F, 36.0F}, 0.5F, false};
  expect(planner.process(request) && planner.state().previous_scale == 0.95F, "Init starts scale history at one");
  planner.reset();
  expect(planner.state().previous_scale == 0.5F, "Reset uses configured scale");
  expect(planner.process(request) && planner.state().previous_scale == 0.5F, "Missing detection does not expand coverage");
  request.has_detection = true;
  expect(planner.process(request) && planner.state().previous_scale == 0.85F, "Detection coverage adds five percent");
  request.bounds = {-30.5F, -20.5F, 10.0F, 10.0F};
  expect(planner.process(request), "Outside planner input");
  expect(planner.state().output.x == -30 && planner.state().output.y == -20,
         "Reversed integer clip endpoints retain negative input origin");
  request.bounds = {40.0F, 30.0F, 10.0F, 10.0F};
  expect(planner.process(request), "Numeric cropper allows reversed endpoints");
  expect(planner.state().information[2] == -30.0F && planner.state().information[3] == -20.0F,
         "Raw cropper information stores signed extents");
}
void native_fingerprint() {
  std::uint64_t hash = 14695981039346656037ULL;
  for (std::uint32_t seed = 0; seed < 16; ++seed) {
    CenterFocus focus;
    auto config = fixtures::configuration(seed);
    expect(focus.initialize(config), "Fingerprint init");
    fixtures::Random random{seed + 0x12345678U};
    for (std::size_t frame = 0; frame < 256; ++frame) {
      if (frame == 128 || frame == 192) {
        if (frame == 192) focus.reset();
        config = fixtures::configuration(seed + 7U);
        expect(focus.initialize(config), "Fingerprint reinit");
      }
      const auto bounds = fixtures::bounds(random, config);
      const std::span<const float> input = frame % 7 == 0 ? std::span<const float>{} : std::span<const float>{bounds};
      expect(focus.process(input), "Fingerprint input");
      fixtures::hash_words(hash, fixtures::words(focus));
    }
  }
  expect(hash == 0xf51cd5b3c664660aULL, "Pinned native complete-chain fingerprint");
}
void rejected_inputs() {
  CenterFocus focus;
  const CenterFocusConfiguration config{0.5F, 0.5F, 0.8F, 320, 180};
  expect(focus.initialize(config) && focus.process({}), "Reject seed");
  const auto before = fixtures::words(focus);
  const std::array bad{
      std::vector<float>{1.0F}, std::vector<float>{1.0F, 2.0F, 3.0F},
      std::vector<float>{1.0F, 2.0F, 3.0F, 4.0F, 5.0F}, std::vector<float>{10.0F, 2.0F, 3.0F, 4.0F},
      std::vector<float>{-8193.0F, 2.0F, 3.0F, 4.0F},
      std::vector<float>{0.0F, 0.0F, std::numeric_limits<float>::infinity(), 4.0F},
      std::vector<float>{0.0F, 0.0F, 4.0F, std::numeric_limits<float>::quiet_NaN()}};
  for (const auto& input : bad) {
    expect(!focus.process(input) && fixtures::words(focus) == before, "Bad bbox must not advance any state");
  }
  for (float scale : {0.0F, 0.124F, 1.01F, std::numeric_limits<float>::quiet_NaN()}) {
    auto invalid = config;
    invalid.scale = scale;
    expect(!focus.initialize(invalid) && fixtures::words(focus) == before, "Bad config preserves all history");
  }
  for (int dimension : {0, 15, 8193, std::numeric_limits<int>::max()}) {
    auto invalid = config;
    invalid.frame_width = dimension;
    expect(!focus.initialize(invalid) && fixtures::words(focus) == before, "Invalid dimension");
  }
  const int rounding = std::fegetround();
  expect(std::fesetround(FE_UPWARD) == 0, "Set rounding");
  const bool rejected = !focus.process({}) && !focus.initialize(config);
  const bool unchanged = fixtures::words(focus) == before;
  const int restored = std::fesetround(rounding);
  expect(restored == 0 && rejected && unchanged, "Rounding rejection");
}
void pixels() {
  std::vector<std::uint8_t> source(64U * 48U * 4U);
  for (std::size_t index = 0; index < source.size(); ++index) source[index] = static_cast<std::uint8_t>((index * 13U) % 256U);
  CenterFocus focus;
  expect(focus.initialize({0.5F, 0.5F, 0.5F, 64, 48}), "Pixel init");
  expect(focus.process(DetectionBounds{20.0F, 10.0F, 40.0F, 30.0F}), "Pixel detection");
  const auto crop = focus.smoother_state().output;
  AffineWarpResult output;
  expect(warp_crop_rgba({source, 64, 48, 64U * 4U}, {static_cast<float>(crop.x), static_cast<float>(crop.y),
      static_cast<float>(crop.width), static_cast<float>(crop.height), 32, 24}, output), "Complete owned selection-to-pixels chain");
  expect(output.rgba.size() == 32U * 24U * 4U, "Pixel dimensions");
}
}  // namespace
int main() {
  try {
    thresholds_and_history(); lifecycle_and_coordinates(); planner_edges(); native_fingerprint(); rejected_inputs(); pixels();
    std::cout << "crop selection: " << checks << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
