#include "temporal_crop_fixtures.hpp"
#include "transform_plan.hpp"

#include <cfenv>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace lens_contract;
namespace fixtures = lens_contract::temporal_fixtures;
std::size_t checks = 0;
void expect(bool condition, const char* message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}

void lifecycle() {
  TemporalCropSmoother smoother;
  const auto initial = fixtures::words(smoother.state());
  expect(smoother.state().first_frame && smoother.state().processed_frames == 0, "Initial lifecycle");
  const TemporalCropRequest first{{10, 12, 100, 60}, 320, 180};
  expect(smoother.process(first), "First frame rejected");
  expect(smoother.state().output == first.rectangle, "First frame must retain the exact rectangle");
  expect(smoother.state().center_x == 59.5F && smoother.state().center_y == 41.5F &&
         smoother.state().horizontal_extent == 99.0F, "Inclusive source endpoints");
  expect(smoother.process({{13, 19, 99, 61}, 320, 180}), "Second frame rejected");
  expect(smoother.state().output == CropRectangle{10, 13, 98, 60}, "Native second-frame golden");
  expect(smoother.state().center_x == 60.25F && smoother.state().center_y == 43.75F &&
         std::bit_cast<std::uint32_t>(smoother.state().horizontal_extent) ==
             std::bit_cast<std::uint32_t>(98.7F), "History retains fractions despite integer output");
  smoother.reset();
  expect(fixtures::words(smoother.state()) == initial, "Reset must restore all parameters and history");
  expect(smoother.process(first) && smoother.state().output == first.rectangle, "Reset first-frame behavior");

  TemporalCropSmoother repeated;
  expect(repeated.process(first) && repeated.process(first), "Repeated input rejected");
  expect(repeated.state().output == CropRectangle{10, 11, 99, 59}, "Repeated frame is not an identity shortcut");
  expect(repeated.state().horizontal_extent == 99.0F, "Repeated extent history");
}

void parameters_and_history() {
  TemporalCropSmoother smoother;
  const TemporalCropRequest first{{10, 20, 100, 80}, 640, 360, 0.3F, 0.2F};
  expect(smoother.process(first), "Parameter first frame");
  expect(smoother.process({{20, 30, 101, 81}, 640, 360, -1.0F, 0.9F}), "Joint retention branch one");
  expect(smoother.state().history_limit == 0.3F && smoother.state().motion_fraction == 0.2F,
         "A negative history limit retains both parameters");
  expect(smoother.process({{30, 40, 102, 82}, 640, 360, 0.9F, -0.1F}), "Joint retention branch two");
  expect(smoother.state().history_limit == 0.3F && smoother.state().motion_fraction == 0.2F,
         "A negative motion fraction retains both parameters");
  expect(smoother.process({{40, 50, 103, 83}, 640, 360, 0.9F, 0.0F}), "Zero motion update");
  const auto locked = smoother.state();
  expect(smoother.process({{140, 150, 53, 183}, 640, 360}), "Locked history input");
  expect(smoother.state().center_x == locked.center_x && smoother.state().center_y == locked.center_y &&
         smoother.state().horizontal_extent == locked.horizontal_extent,
         "Zero motion fraction locks floating history");
  expect(smoother.state().output.height != locked.output.height,
         "Current aspect ratio still changes the output under locked history");

  TemporalCropSmoother horizontal;
  TemporalCropSmoother vertical;
  expect(horizontal.process(first) && vertical.process(first), "Axis seed");
  expect(horizontal.process({{210, 20, 100, 80}, 640, 360, 0.0F, 0.01F}), "Horizontal jump");
  expect(vertical.process({{10, 220, 100, 80}, 640, 360, 0.0F, 0.01F}), "Vertical jump");
  expect(horizontal.state().center_x < 70.0F && vertical.state().center_y == 259.5F,
         "Motion budget depends on horizontal center distance, not vector length");
}

void actual_constraint() {
  const CropBounds outside{-1000.0F, 5000.0F, -999.0F, 5000.0F};
  expect(observed_crop_constraint(320, 180, outside), "Native chained comparison is not geometry containment");
  expect(!observed_crop_constraint(1, 1, {0.0F, 0.0F, 0.0F, 0.0F}), "Single-pixel predicate boundary");
  expect(observed_crop_constraint(1, 1, {-2.0F, -2.0F, -2.0F, -2.0F}), "Boolean zero passes dimension one");
  expect(!observed_crop_constraint(0, 180, outside), "Zero dimension predicate");
  TemporalCropSmoother smoother;
  expect(smoother.process({{400, 200, 100, 60}, 320, 180}), "Outside first frame");
  expect(smoother.state().output.x == 400, "First frame does not clamp source rectangle");
  expect(smoother.process({{410, 210, 100, 60}, 320, 180}), "Outside later frame");
  expect(smoother.state().output.width < 0 && smoother.state().output.height < 0,
         "One-sided output clamp can preserve negative extents");
}

void golden_domain() {
  std::uint64_t hash = 14695981039346656037ULL;
  TemporalCropSmoother smoother;
  fixtures::hash_state(hash, smoother.state());
  for (std::uint32_t seed = 0; seed < 16; ++seed) {
    smoother.reset();
    fixtures::hash_state(hash, smoother.state());
    for (const auto& request : fixtures::sequence(seed, 256)) {
      expect(smoother.process(request), "Native fingerprint fixture rejected");
      fixtures::hash_state(hash, smoother.state());
    }
  }
  expect(hash == 0xfdf6f80b5071677aULL, "Pinned native 4096-frame state fingerprint");
  hash = 14695981039346656037ULL;
  for (const auto& request : fixtures::interpolations(32768)) {
    CropBounds bounds{};
    expect(interpolate_temporal_crop(request, bounds), "Interpolation fixture rejected");
    fixtures::hash_bounds(hash, bounds);
  }
  expect(hash == 0x3cd3c49e4cf689aaULL, "Pinned native interpolation fingerprint");
}

void reject_without_mutation() {
  TemporalCropSmoother smoother;
  const TemporalCropRequest valid{{1, 2, 100, 80}, 320, 180};
  expect(smoother.process(valid), "Rejection seed");
  const auto before = fixtures::words(smoother.state());
  std::vector<TemporalCropRequest> invalid;
  for (int width : {0, 1, -1, 32769, std::numeric_limits<int>::max()}) {
    auto request = valid;
    request.rectangle.width = width;
    invalid.push_back(request);
  }
  for (float parameter : {std::numeric_limits<float>::quiet_NaN(),
                          std::numeric_limits<float>::infinity(), 1.01F}) {
    auto request = valid;
    request.history_limit = parameter;
    request.motion_fraction = 0.1F;
    invalid.push_back(request);
  }
  auto request = valid;
  request.frame_width = 0;
  invalid.push_back(request);
  request = valid;
  request.rectangle.x = -32769;
  invalid.push_back(request);
  for (const auto& input : invalid) {
    expect(!smoother.process(input), "Invalid request accepted");
    expect(fixtures::words(smoother.state()) == before, "Invalid request changed state");
  }
  CropBounds bounds{9.0F, 8.0F, 7.0F, 6.0F};
  const auto saved = bounds;
  expect(!interpolate_temporal_crop({0.5F, 0, 0, 10, 0, 0, 10, 32769.0F}, bounds) && bounds == saved,
         "Interpolation bound rejection must preserve output");
  const int previous_rounding = std::fegetround();
  expect(std::fesetround(FE_DOWNWARD) == 0, "Set rounding mode");
  const bool rejected = !smoother.process(valid);
  const bool unchanged = fixtures::words(smoother.state()) == before;
  const int restored = std::fesetround(previous_rounding);
  expect(restored == 0 && rejected && unchanged, "Unsupported rounding must fail closed");
}

void owned_warp_composition() {
  std::vector<std::uint8_t> pixels(32U * 24U * 4U, 255);
  for (std::size_t pixel = 0; pixel < 32U * 24U; ++pixel) {
    pixels[pixel * 4U] = static_cast<std::uint8_t>(pixel % 256U);
  }
  TemporalCropSmoother smoother;
  expect(smoother.process({{4, 3, 20, 16}, 32, 24}) &&
         smoother.process({{5, 4, 20, 16}, 32, 24}), "Warp sequence rejected");
  const auto box = smoother.state().output;
  AffineWarpResult output;
  expect(warp_crop_rgba({pixels, 32, 24, 32U * 4U},
      {static_cast<float>(box.x), static_cast<float>(box.y), static_cast<float>(box.width),
       static_cast<float>(box.height), 16, 12}, output), "Recovered temporal output must feed owned crop warp");
  expect(output.rgba.size() == 16U * 12U * 4U, "Composed output dimensions");
}
}  // namespace

int main() {
  try {
    lifecycle(); parameters_and_history(); actual_constraint(); golden_domain();
    reject_without_mutation(); owned_warp_composition();
    std::cout << "temporal crop: " << checks << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
