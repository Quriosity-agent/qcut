#include "temporal_crop_fixtures.hpp"
#include "temporal_crop_native_support.hpp"
#include "transform_plan_native_support.hpp"

#include <bit>
#include <cstdio>
#include <iostream>
#include <limits>
#include <unistd.h>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;
namespace fixtures = lens_contract::temporal_fixtures;

struct Totals {
  std::size_t frames = 0;
  std::size_t states = 0;
  std::size_t interpolations = 0;
  std::size_t constraints = 0;
  std::size_t geometrical_predicate_differences = 0;
  std::size_t negative_output_rectangles = 0;
  std::size_t pixel_cases = 0;
  std::size_t pixel_bytes = 0;
  std::uint64_t state_hash = 14695981039346656037ULL;
  std::uint64_t portable_hash = 14695981039346656037ULL;
  std::uint64_t bounds_hash = 14695981039346656037ULL;
  std::uint64_t pixels_hash = 14695981039346656037ULL;

  void compare(const TemporalCropState& own, const TemporalCropState& actual,
               std::uint32_t seed, std::size_t frame, bool portable) {
    const auto expected = fixtures::words(own);
    const auto observed = fixtures::words(actual);
    for (std::size_t index = 0; index < expected.size(); ++index) {
      if (expected[index] != observed[index]) {
        throw std::runtime_error("Native state differs: sequence=" + std::to_string(seed) +
            " frame=" + std::to_string(frame) + " field=" + std::to_string(index) +
            " expected=" + std::to_string(expected[index]) + " actual=" + std::to_string(observed[index]));
      }
    }
    fixtures::hash_state(state_hash, actual);
    if (portable) fixtures::hash_state(portable_hash, actual);
    ++states;
  }
};

void compare_sequences(const Oracle& library, Totals& totals) {
  NativeTemporalCrop native(library);
  TemporalCropSmoother own;
  totals.compare(own.state(), native.state(), 0, 0, true);
  for (std::uint32_t seed = 0; seed < 256; ++seed) {
    native.reset();
    own.reset();
    totals.compare(own.state(), native.state(), seed, 0, seed < 16);
    const auto requests = fixtures::sequence(seed, 256);
    for (std::size_t frame = 0; frame < requests.size(); ++frame) {
      const auto& request = requests[frame];
      require(own.process(request), "Own smoother rejected a bounded fixture");
      native.process(request);
      const auto actual = native.state();
      totals.compare(own.state(), actual, seed, frame, seed < 16);
      totals.negative_output_rectangles += actual.output.width < 0 || actual.output.height < 0;
      ++totals.frames;
    }
  }
  require(totals.negative_output_rectangles > 0, "Missing uncorrected outside-frame evidence");
  const auto repeated = fixtures::sequence(91, 64);
  native.reset();
  own.reset();
  for (const auto& request : repeated) {
    require(own.process(request), "Reset sequence rejected");
    native.process(request);
  }
  NativeTemporalCrop fresh(library);
  for (const auto& request : repeated) fresh.process(request);
  totals.compare(fresh.state(), native.state(), 91, 64, false);
  totals.compare(own.state(), native.state(), 91, 64, false);
}

void compare_interpolation(const Oracle& library, Totals& totals) {
  NativeTemporalCrop native(library);
  for (const auto& request : fixtures::interpolations(32768)) {
    CropBounds own{};
    require(interpolate_temporal_crop(request, own), "Own interpolation rejected fixture");
    const auto actual = native.interpolate(request);
    const std::array expected{own.left, own.right, own.top, own.bottom};
    const std::array observed{actual.left, actual.right, actual.top, actual.bottom};
    for (std::size_t index = 0; index < expected.size(); ++index) {
      require(std::bit_cast<std::uint32_t>(expected[index]) == std::bit_cast<std::uint32_t>(observed[index]),
              "Native crop interpolation differs");
    }
    fixtures::hash_bounds(totals.bounds_hash, actual);
    ++totals.interpolations;
  }
}

void compare_constraint(const Oracle& library, Totals& totals) {
  const auto native = library.offset<bool (*)(int, int, float, float, float, float)>(
      smoother_constructor, 0xeaf38, 0xeb114);
  const std::array<float, 12> values{-10000.0F, -2.0F, -1.000001F, -1.0F, -0.0F,
      0.0F, 0.999F, 1.0F, 10000.0F, std::numeric_limits<float>::infinity(),
      -std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()};
  for (int width : {-1, 0, 1, 2, 320}) {
    for (int height : {-1, 0, 1, 2, 180}) {
      for (float a : values) {
        for (float b : values) {
          const CropBounds bounds{a, b, b, a};
          const bool actual = native(width, height, a, b, b, a);
          require(observed_crop_constraint(width, height, bounds) == actual,
                  "Observed native comparison-of-comparison differs");
          const bool geometrical = a >= 0.0F && b <= static_cast<float>(width) &&
              b >= 0.0F && a <= static_cast<float>(height);
          totals.geometrical_predicate_differences += actual != geometrical;
          ++totals.constraints;
        }
      }
    }
  }
  require(totals.geometrical_predicate_differences > 0, "Geometrical predicate negative control did not differ");
}

void compare_composed_pixels(const Oracle& library, Totals& totals) {
  const auto construct = library.offset<Construct>(image_transform_constructor, 0x3b23f4, 0x220f0c);
  const auto destroy = library.offset<Destroy>(image_transform_constructor, 0x3b23f4, 0x21e9ec);
  fixtures::Random random{0x12345678U};
  for (const auto& size : {std::array{64, 48}, std::array{257, 145}}) {
    const auto stride = static_cast<std::size_t>(size[0]) * 4U + 7U;
    GuardedBytes source(stride * static_cast<std::size_t>(size[1]));
    for (std::size_t index = 0; index < source.length; ++index) {
      source.data()[index] = static_cast<std::uint8_t>(random.next());
    }
    const auto saved = source.storage;
    NativeMat input(construct, destroy, size[1], size[0], 24, source.data(), stride);
    for (float limit : {0.7F, 0.99F}) {
      NativeTemporalCrop native(library);
      TemporalCropSmoother own;
      NativeImageTransform transform(library);
      for (int frame = 0; frame < 32; ++frame) {
        const TemporalCropRequest request{{4 + frame % 8, 3 + frame % 7,
            size[0] / 2 + frame % 3, size[1] / 2 + frame % 5},
            size[0], size[1], limit, 0.01F};
        native.process(request);
        require(own.process(request), "Composed temporal request rejected");
        const auto box = native.state().output;
        require(fixtures::words(own.state()) == fixtures::words(native.state()),
                "Composed temporal state differs");
        constexpr int width = 97;
        constexpr int height = 53;
        require(box.width >= 2 && box.height >= 2, "Composed fixture has invalid crop");
        const AnchorResizeRequest anchors{{static_cast<float>(box.x), static_cast<float>(box.y),
            static_cast<float>(box.x + box.width - 1), static_cast<float>(box.y + box.height - 1)},
            {0.0F, 0.0F, static_cast<float>(width - 1), static_cast<float>(height - 1)}};
        transform.resize(anchors);
        GuardedBytes pixels(static_cast<std::size_t>(width) * height * 4U);
        NativeMat output(construct, destroy, height, width, 24, pixels.data(), width * 4U);
        transform.warp(input, output, {width, height});
        output.unchanged_storage(pixels.data(), width, height);
        pixels.guards();
        source.guards();
        require(source.storage == saved, "Composed native warp changed input bytes or padding");
        const auto owned_box = own.state().output;
        AffineWarpResult actual;
        require(warp_crop_rgba({std::span<const std::uint8_t>(source.data(), source.length),
                size[0], size[1], stride}, {static_cast<float>(owned_box.x), static_cast<float>(owned_box.y),
                static_cast<float>(owned_box.width), static_cast<float>(owned_box.height), width, height}, actual),
                "Owned temporal/crop/warp composition rejected");
        require(actual.rgba.size() == pixels.length, "Composed output length differs");
        for (std::size_t index = 0; index < pixels.length; ++index) {
          require(actual.rgba[index] == pixels.data()[index], "Composed native pixel differs");
          totals.pixels_hash = (totals.pixels_hash ^ pixels.data()[index]) * 1099511628211ULL;
        }
        totals.pixel_bytes += pixels.length;
        ++totals.pixel_cases;
      }
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-temporal-native-oracle /absolute/path/liblens.dylib");
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect vendor logs");
    Totals totals;
    {
      const Oracle library(argv[1]);
      compare_sequences(library, totals);
      compare_interpolation(library, totals);
      compare_constraint(library, totals);
      compare_composed_pixels(library, totals);
    }
    std::fflush(stdout);
    require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
    close(saved_stdout);
    std::cout << "{\n  \"library_sha256\": \"" << expected_sha << "\",\n"
      << "  \"unit\": \"OnlineMove::RectSmoother; not VAS or Deflicker\",\n"
      << "  \"sequence_frames\": " << totals.frames << ",\n"
      << "  \"native_process_calls\": " << totals.frames + 128 + totals.pixel_cases << ",\n"
      << "  \"state_snapshots\": " << totals.states << ",\n"
      << "  \"state_words_compared\": " << totals.states * 13 << ",\n"
      << "  \"interpolations\": " << totals.interpolations << ",\n"
      << "  \"interpolation_float_words\": " << totals.interpolations * 4 << ",\n"
      << "  \"predicate_cases\": " << totals.constraints << ",\n"
      << "  \"geometrical_predicate_differences\": " << totals.geometrical_predicate_differences << ",\n"
      << "  \"negative_output_rectangles\": " << totals.negative_output_rectangles << ",\n"
      << "  \"composed_pixel_cases\": " << totals.pixel_cases << ",\n"
      << "  \"composed_rgba_bytes\": " << totals.pixel_bytes << ",\n"
      << "  \"mismatches\": 0,\n"
      << "  \"state_fnv1a64\": \"" << std::hex << totals.state_hash << "\",\n"
      << "  \"portable_fnv1a64\": \"" << totals.portable_hash << "\",\n"
      << "  \"bounds_fnv1a64\": \"" << totals.bounds_hash << "\",\n"
      << "  \"composed_pixels_fnv1a64\": \"" << totals.pixels_hash << "\"\n}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
