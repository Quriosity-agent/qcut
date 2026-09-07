#include "transform_plan_fixtures.hpp"
#include "transform_plan_native_support.hpp"

#include <unistd.h>

#include <bit>
#include <cstdio>
#include <iostream>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;

struct Totals {
  std::size_t matrix_cases = 0;
  std::size_t rejected_cases = 0;
  std::size_t matrix_values = 0;
  std::size_t closed_form_differences = 0;
  std::size_t pixel_cases = 0;
  std::size_t pixel_bytes = 0;
  std::size_t nonzero_bytes = 0;
  std::size_t fractional_alpha = 0;
  std::uint64_t matrix_hash = 14695981039346656037ULL;
  std::uint64_t portable_hash = 14695981039346656037ULL;
  std::uint64_t pixel_hash = 14695981039346656037ULL;

  void compare(const TransformPlan& own, const TransformPlan& actual) {
    for (const auto& pair : {std::pair{own.source_to_destination, actual.source_to_destination},
                             std::pair{own.destination_to_source, actual.destination_to_source}}) {
      for (std::size_t index = 0; index < 6; ++index) {
        if (std::bit_cast<std::uint32_t>(pair.first[index]) !=
            std::bit_cast<std::uint32_t>(pair.second[index])) {
          std::ostringstream error;
          error << "Matrix differs: case=" << matrix_cases << " index=" << index
                << " own=" << std::hexfloat << pair.first[index] << " native=" << pair.second[index];
          throw std::runtime_error(error.str());
        }
        ++matrix_values;
      }
    }
    plan_fixtures::hash_plan(matrix_hash, actual);
    ++matrix_cases;
  }
};

void matrix_cases(const Oracle& oracle, Totals& totals) {
  NativeImageTransform native(oracle);
  const auto requests = plan_fixtures::anchors(30000);
  for (std::size_t index = 0; index < requests.size(); ++index) {
    auto request = requests[index];
    TransformPlan own;
    const bool accepted = plan_anchor_resize(request, own);
    const auto actual = native.resize(request);
    require(request.source_points == requests[index].source_points &&
                request.destination_points == requests[index].destination_points,
            "Native transform changed input anchor storage");
    if (index < 2048) {
      plan_fixtures::hash_word(totals.portable_hash, accepted ? 1U : 0U);
      if (accepted) plan_fixtures::hash_plan(totals.portable_hash, actual);
    }
    if (!accepted) {
      ++totals.rejected_cases;
      for (float value : actual.source_to_destination) require(value == 0, "Rejected native solve changed");
      require(!std::isfinite(actual.destination_to_source[0]) &&
                  !std::isfinite(actual.destination_to_source[4]), "Rejected native inverse changed");
      continue;
    }
    totals.compare(own, actual);
    const auto& source = request.source_points;
    const auto& destination = request.destination_points;
    const float sx = (destination[2] - destination[0]) / (source[2] - source[0]);
    const float sy = (destination[3] - destination[1]) / (source[3] - source[1]);
    const std::array closed_form{sx, 0.0F, destination[0] - sx * source[0],
                                 0.0F, sy, destination[1] - sy * source[1]};
    for (std::size_t component = 0; component < 6; ++component) {
      totals.closed_form_differences += std::bit_cast<std::uint32_t>(closed_form[component]) !=
          std::bit_cast<std::uint32_t>(actual.source_to_destination[component]);
    }
  }
  for (std::size_t index : {0U, 4U, 170U, 1000U, 12001U}) {
    NativeImageTransform fresh(oracle);
    const auto fresh_result = fresh.resize(requests[index]);
    const auto reused_result = native.resize(requests[index]);
    totals.compare(reused_result, fresh_result);
  }
}

void pixel_cases(const Oracle& oracle, Totals& totals) {
  const auto construct = oracle.offset<Construct>(image_transform_constructor, 0x3b23f4, 0x220f0c);
  const auto destroy = oracle.offset<Destroy>(image_transform_constructor, 0x3b23f4, 0x21e9ec);
  NativeImageTransform native(oracle);
  Samples random;
  for (const auto& size : {std::array{1, 1}, std::array{2, 3}, std::array{7, 5}, std::array{8, 8},
                           std::array{17, 9}, std::array{65, 37}, std::array{257, 145}}) {
    for (std::size_t padding : {0U, 7U}) {
      const auto stride = static_cast<std::size_t>(size[0]) * 4 + padding;
      GuardedBytes source(stride * static_cast<std::size_t>(size[1]));
      for (std::size_t byte = 0; byte < source.length; ++byte) {
        source.data()[byte] = static_cast<std::uint8_t>(random.next());
      }
      const auto source_before = source.storage;
      NativeMat input(construct, destroy, size[1], size[0], 24, source.data(), stride);
      for (const auto& crop : plan_fixtures::crops(size[0], size[1])) {
        // These arguments reproduce the verified caller boundary; the SDK constructs both matrices.
        const AnchorResizeRequest anchors{{crop.x, crop.y, (crop.x + crop.width) - 1,
                                            (crop.y + crop.height) - 1},
            {0, 0, static_cast<float>(crop.destination_width - 1),
             static_cast<float>(crop.destination_height - 1)}};
        const auto actual_plan = native.resize(anchors);
        TransformPlan own_plan;
        require(plan_crop_resize(crop, own_plan), "Independent crop plan rejected fixture");
        totals.compare(own_plan, actual_plan);
        const auto count = static_cast<std::size_t>(crop.destination_width) *
                           static_cast<std::size_t>(crop.destination_height);
        GuardedBytes rgba(count * 4);
        NativeMat output(construct, destroy, crop.destination_height, crop.destination_width,
                         24, rgba.data(), static_cast<std::size_t>(crop.destination_width) * 4);
        native.warp(input, output, {crop.destination_width, crop.destination_height});
        rgba.guards();
        source.guards();
        input.unchanged_storage(source.data(), size[0], size[1]);
        output.unchanged_storage(rgba.data(), crop.destination_width, crop.destination_height);
        require(source.storage == source_before, "Native crop changed input pixels or stride padding");
        AffineWarpResult own;
        require(warp_crop_rgba({{source.data(), source.length}, size[0], size[1], stride}, crop, own),
                "Independent crop pixels rejected fixture");
        require(own.rgba.size() == rgba.length, "Independent crop output length differs");
        for (std::size_t byte = 0; byte < rgba.length; ++byte) {
          if (own.rgba[byte] != rgba.data()[byte]) {
            throw std::runtime_error("Crop pixel mismatch: case=" + std::to_string(totals.pixel_cases) +
                                     " byte=" + std::to_string(byte));
          }
          totals.pixel_hash = (totals.pixel_hash ^ rgba.data()[byte]) * 1099511628211ULL;
          totals.nonzero_bytes += rgba.data()[byte] != 0;
          totals.fractional_alpha += byte % 4 == 3 && rgba.data()[byte] > 0 && rgba.data()[byte] < 255;
        }
        totals.pixel_bytes += rgba.length;
        ++totals.pixel_cases;
      }
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-transform-plan-native-oracle /absolute/path/liblens.dylib");
    const int saved_stdout = dup(STDOUT_FILENO);
    require(saved_stdout >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect vendor logs");
    Totals totals;
    {
      Oracle oracle(argv[1]);
      matrix_cases(oracle, totals);
      pixel_cases(oracle, totals);
    }
    std::fflush(stdout);
    require(dup2(saved_stdout, STDOUT_FILENO) >= 0, "Cannot restore diagnostic output");
    close(saved_stdout);
    std::cout << "{\"schema\":1,\"matrix_cases\":" << totals.matrix_cases
              << ",\"matrix_float_values\":" << totals.matrix_values
              << ",\"matrix_mismatches\":0,\"rejected_native_zero_solve_cases\":" << totals.rejected_cases
              << ",\"closed_form_float_differences\":" << totals.closed_form_differences
              << ",\"pixel_cases\":" << totals.pixel_cases << ",\"rgba_bytes\":" << totals.pixel_bytes
              << ",\"rgba_mismatches\":0,\"nonzero_bytes\":" << totals.nonzero_bytes
              << ",\"fractional_alpha_pixels\":" << totals.fractional_alpha
              << ",\"matrix_fingerprint\":\"" << std::hex << totals.matrix_hash
              << "\",\"portable_fingerprint\":\"" << totals.portable_hash
              << "\",\"rgba_fingerprint\":\"" << totals.pixel_hash << "\"}\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
