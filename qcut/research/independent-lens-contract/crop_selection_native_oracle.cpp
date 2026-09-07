#include "crop_selection_fixtures.hpp"
#include "crop_selection_native_support.hpp"
#include "transform_plan_native_support.hpp"

#include <bit>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <unistd.h>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;
namespace fixtures = lens_contract::selection_fixtures;
struct Totals {
  std::size_t frames = 0;
  std::size_t scalar_comparisons = 0;
  std::size_t missing = 0;
  std::size_t planner_frames = 0;
  std::size_t boundary_frames = 0;
  std::size_t pixel_cases = 0;
  std::size_t pixel_bytes = 0;
  std::uint64_t hash = 14695981039346656037ULL;
  std::uint64_t portable_hash = 14695981039346656037ULL;
  std::uint64_t pixel_hash = 14695981039346656037ULL;
};
void compare(Totals& totals, const CenterFocus& own, const NativeCenterFocus& native,
             const DetectionBounds& output, bool portable) {
  const auto expected = fixtures::words(own);
  auto observed = native.state();
  observed.output = output;
  const auto actual = fixtures::words(observed, native.planner_state(), native.smoother_state());
  require(expected.size() == actual.size(), "Invalid comparison layout");
  for (std::size_t field = 0; field < actual.size(); ++field) {
    require(actual[field] == expected[field], "Native crop selection differs at frame " + std::to_string(totals.frames) +
        " field " + std::to_string(field) + ": own=" + std::to_string(expected[field]) + " native=" + std::to_string(actual[field]));
  }
  totals.scalar_comparisons += actual.size();
  fixtures::hash_words(totals.hash, actual);
  if (portable) fixtures::hash_words(totals.portable_hash, actual);
}
void sequences(const Oracle& oracle, Totals& totals) {
  for (std::uint32_t seed = 0; seed < 256; ++seed) {
    NativeCenterFocus native(oracle);
    CenterFocus own;
    auto config = fixtures::configuration(seed);
    native.initialize(config);
    require(own.initialize(config), "Own init rejected");
    fixtures::Random random{seed + 0x12345678U};
    for (std::size_t frame = 0; frame < 256; ++frame) {
      if (frame == 128 || frame == 192) {
        if (frame == 192) { native.reset(); own.reset(); }
        config = fixtures::configuration(seed + 7U);
        native.initialize(config);
        require(own.initialize(config), "Own reinit rejected");
      }
      const auto bounds = fixtures::bounds(random, config);
      const bool missing = frame % 7 == 0;
      const std::span<const float> input = missing ? std::span<const float>{} : std::span<const float>{bounds};
      require(own.process(input), "Own process rejected seed=" + std::to_string(seed) + " frame=" + std::to_string(frame));
      const auto output = native.process(input);
      compare(totals, own, native, output, seed < 16);
      ++totals.frames;
      totals.missing += missing;
    }
  }
}
void boundary_sequences(const Oracle& oracle, Totals& totals) {
  const CenterFocusConfiguration config{0.5F, 0.5F, 0.8F, 80, 40};
  for (float edge : {std::nextafter(6.0F, 0.0F), 6.0F, std::nextafter(6.0F, 8.0F),
                     8.0F, std::nextafter(10.0F, 8.0F), 10.0F, std::nextafter(10.0F, 12.0F)}) {
    NativeCenterFocus native(oracle);
    CenterFocus own;
    native.initialize(config);
    require(own.initialize(config), "Threshold init rejected");
    const DetectionBounds input{edge, 5.0F, 74.0F, 37.0F};
    for (int repeat = 0; repeat < 8; ++repeat) {
      require(own.process(input), "Threshold input rejected");
      compare(totals, own, native, native.process(input), false);
      ++totals.boundary_frames;
    }
  }
  for (const auto& corner_config : {CenterFocusConfiguration{0.0F, 1.0F, 0.125F, 16, 16},
                                    CenterFocusConfiguration{1.0F, 0.0F, 1.0F, 8192, 8192},
                                    CenterFocusConfiguration{0.5F, 0.5F, 0.37F, 257, 145}, config}) {
    NativeCenterFocus native(oracle);
    CenterFocus own;
    native.initialize(corner_config);
    require(own.initialize(corner_config), "Corner init rejected");
    for (const auto& input : {DetectionBounds{-8192.0F, -8192.0F, 8192.0F, 8192.0F},
                              DetectionBounds{-8192.0F, -8192.0F, -8192.0F, -8192.0F},
                              DetectionBounds{8192.0F, 8192.0F, 8192.0F, 8192.0F},
                              DetectionBounds{-0.0F, -0.0F, 0.0F, 0.0F},
                              DetectionBounds{-8192.0F, 0.0F, 8192.0F, 0.0F},
                              DetectionBounds{0.0F, -8192.0F, 0.0F, 8192.0F}}) {
      require(own.process(input), "Corner input rejected");
      compare(totals, own, native, native.process(input), false);
      ++totals.boundary_frames;
    }
  }
  for (bool expand : {false, true}) {
    for (float scale : {0.125F, 0.5F, 0.8F, 1.0F}) {
      NativeCropPlanner native(oracle, scale, expand);
      CropPlanner own;
      require(own.initialize(scale, expand), "Cropper init rejected");
      for (int step = 0; step < 512; ++step) {
        if (step == 256) { own.reset(); native.reset(); }
        const float origin = static_cast<float>((step % 11) - 5) * 12.125F;
        CropPlannerRequest request{257, 145, {origin, -origin, origin + static_cast<float>(step % 257),
            -origin + static_cast<float>(step % 145)}, scale, step % 5 != 0};
        if (step % 17 == 0) std::swap(request.bounds[0], request.bounds[2]);
        require(own.process(request), "Cropper boundary request rejected");
        native.process(request);
        const auto expected = fixtures::words({}, own.state(), {});
        const auto actual = fixtures::words({}, native.state(), {});
        require(expected == actual, "Native cropper boundary state differs");
        totals.scalar_comparisons += 13;
        ++totals.planner_frames;
      }
    }
  }
}
void composed_pixels(const Oracle& oracle, Totals& totals) {
  const auto construct = oracle.offset<Construct>(image_transform_constructor, 0x3b23f4, 0x220f0c);
  const auto destroy = oracle.offset<Destroy>(image_transform_constructor, 0x3b23f4, 0x21e9ec);
  fixtures::Random random{0x59b9231U};
  for (const auto& size : {std::array{64, 48}, std::array{257, 145}}) {
    const auto stride = static_cast<std::size_t>(size[0]) * 4U + 7U;
    GuardedBytes source(stride * static_cast<std::size_t>(size[1]));
    for (std::size_t index = 0; index < source.length; ++index) source.data()[index] = static_cast<std::uint8_t>(random.next());
    const auto saved = source.storage;
    NativeMat input(construct, destroy, size[1], size[0], 24, source.data(), stride);
    for (float scale : {0.5F, 0.8F}) {
      NativeCenterFocus native(oracle);
      CenterFocus own;
      const CenterFocusConfiguration config{0.5F, 0.5F, scale, size[0], size[1]};
      native.initialize(config);
      require(own.initialize(config), "Pixel selection init rejected");
      NativeImageTransform transform(oracle);
      for (int frame = 0; frame < 32; ++frame) {
        const DetectionBounds box{static_cast<float>(size[0] / 4 + frame % 7), static_cast<float>(size[1] / 4 + frame % 5),
            static_cast<float>(size[0] * 3 / 4), static_cast<float>(size[1] * 3 / 4)};
        const std::span<const float> detection = frame % 4 == 0 ? std::span<const float>{} : std::span<const float>{box};
        require(own.process(detection), "Pixel selection input rejected");
        const auto actual_bounds = native.process(detection);
        compare(totals, own, native, actual_bounds, false);
        const auto crop = native.smoother_state().output;
        constexpr int width = 97;
        constexpr int height = 53;
        require(crop.width >= 2 && crop.height >= 2, "Invalid pixel crop");
        transform.resize({{static_cast<float>(crop.x), static_cast<float>(crop.y),
            static_cast<float>(crop.x + crop.width - 1), static_cast<float>(crop.y + crop.height - 1)},
            {0.0F, 0.0F, static_cast<float>(width - 1), static_cast<float>(height - 1)}});
        GuardedBytes pixels(static_cast<std::size_t>(width) * height * 4U);
        NativeMat output(construct, destroy, height, width, 24, pixels.data(), width * 4U);
        transform.warp(input, output, {width, height});
        output.unchanged_storage(pixels.data(), width, height);
        pixels.guards(); source.guards();
        require(source.storage == saved, "Native composition changed input/padding");
        const auto owned = own.smoother_state().output;
        AffineWarpResult rendered;
        require(warp_crop_rgba({std::span<const std::uint8_t>(source.data(), source.length), size[0], size[1], stride},
            {static_cast<float>(owned.x), static_cast<float>(owned.y), static_cast<float>(owned.width),
             static_cast<float>(owned.height), width, height}, rendered), "Owned selection/warp rejected");
        require(rendered.rgba.size() == pixels.length, "Composed length differs");
        for (std::size_t index = 0; index < pixels.length; ++index) {
          require(rendered.rgba[index] == pixels.data()[index], "Composed selection pixel differs");
          totals.pixel_hash = (totals.pixel_hash ^ pixels.data()[index]) * 1099511628211ULL;
        }
        ++totals.pixel_cases;
        totals.pixel_bytes += pixels.length;
      }
    }
  }
}
}  // namespace
int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-crop-selection-native-oracle /absolute/liblens.dylib");
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect vendor logs");
    Totals totals;
    {
      const Oracle oracle(argv[1]);
      sequences(oracle, totals);
      boundary_sequences(oracle, totals);
      composed_pixels(oracle, totals);
    }
    std::fflush(stdout);
    require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
    close(saved_stdout);
    std::cout << "{\"library_sha256\":\"" << expected_sha << "\",\"frames\":" << totals.frames << ",\"missing_detection_frames\":" << totals.missing
        << ",\"boundary_frames\":" << totals.boundary_frames << ",\"planner_frames\":" << totals.planner_frames
        << ",\"pixel_cases\":" << totals.pixel_cases << ",\"pixel_bytes\":" << totals.pixel_bytes
        << ",\"sdk_value_comparisons\":" << totals.scalar_comparisons - (totals.frames + totals.boundary_frames + totals.pixel_cases)
        << ",\"derived_readiness_checks\":" << totals.frames + totals.boundary_frames + totals.pixel_cases
        << ",\"scalar_comparisons\":" << totals.scalar_comparisons << ",\"mismatches\":0,\"hash\":\""
        << std::hex << totals.hash << "\",\"portable_hash\":\"" << totals.portable_hash
        << "\",\"pixel_hash\":\"" << totals.pixel_hash << "\"}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 2;
  }
}
