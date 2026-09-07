#include "bezier.hpp"
#include "native_library.hpp"
#include "native_output.hpp"
#include "resample.hpp"
#include "test_support.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <vector>

namespace {

using editor_test::require;
using editor_contract::CubicCurve;
using Rows = std::vector<std::vector<double>>;
using NativeResample = Rows (*)(const std::vector<double>&, const Rows&,
                               const std::vector<double>&, bool);
using NativeCubic = int (*)(void*, float, float, float, float, float, float,
                            float, float, float, float&);
using NativeFreeCubic = float (*)(float, float, float, float, float, float,
                                  float, float, float);

struct Counts {
  std::uint64_t values = 0;
  std::uint64_t nan_pairs = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  template <typename Float>
  void compare(Float actual, Float expected) {
    ++values;
    if (std::isnan(actual) && std::isnan(expected)) {
      ++nan_pairs;
      return;
    }
    if (std::memcmp(&actual, &expected, sizeof(Float)) != 0) {
      throw std::runtime_error("Native evaluation mismatch at value " + std::to_string(values) +
          ": " + std::to_string(actual) + " versus " + std::to_string(expected));
    }
    const auto* bytes = reinterpret_cast<const std::uint8_t*>(&actual);
    for (std::size_t i = 0; i < sizeof(Float); ++i) {
      fingerprint ^= bytes[i];
      fingerprint *= 1099511628211ULL;
    }
  }
  NSDictionary* json() const {
    return @{@"values": @(values), @"nonNanBitExact": @(values - nan_pairs),
             @"nanClassificationMatches": @(nan_pairs), @"mismatches": @0,
             @"fnv1a": @(fingerprint)};
  }
};

std::uint32_t next_random(std::uint32_t& state) {
  state = state * 1664525U + 1013904223U;
  return state;
}

NSDictionary* compare_resampling(const editor_probe::Library& library) {
  static_assert(sizeof(std::vector<double>) == 24 && sizeof(Rows) == 24);
  const auto native = editor_probe::entry<NativeResample>(library, 0x3414408);
  Counts counts;
  std::uint32_t random = 0x438bed12;
  std::size_t calls = 0;
  for (std::size_t series = 0; series < 256; ++series) {
    const std::size_t length = 1 + series % 17;
    const std::size_t dimensions = series % 9;
    std::vector<double> times(length);
    Rows values(length, std::vector<double>(dimensions));
    double time = -100;
    for (std::size_t i = 0; i < length; ++i) {
      time += next_random(random) % 4;
      times[i] = time;
      for (auto& value : values[i]) {
        const auto index = next_random(random) % editor_test::kDoubleBits.size();
        value = std::bit_cast<double>(editor_test::kDoubleBits[index]);
      }
    }
    std::vector<double> queries{times.front() - 1, times.back() + 1,
        -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(),
        std::numeric_limits<double>::quiet_NaN()};
    for (std::size_t i = 0; i < length; ++i) {
      queries.push_back(times[i]);
      if (i) queries.push_back(times[i - 1] + (times[i] - times[i - 1]) * 0.375);
    }
    for (const bool hold : {false, true}) {
      for (int order = 0; order < 2; ++order) {
        const auto original_times = times;
        const auto original_values = values;
        const auto original_queries = queries;
        const auto actual = native(times, values, queries, hold);
        const auto expected = editor_contract::resample_linear(times, values, queries, hold);
        ++calls;
        require(actual.size() == expected.size(), "Native resampling row count mismatch");
        for (std::size_t row = 0; row < actual.size(); ++row) {
          require(actual[row].size() == dimensions, "Native resampling channel count mismatch");
          for (std::size_t channel = 0; channel < dimensions; ++channel) {
            counts.compare(actual[row][channel], expected[row][channel]);
          }
        }
        require(std::memcmp(times.data(), original_times.data(), times.size() * sizeof(double)) == 0,
                "Native resampler mutated time inputs");
        require(std::memcmp(queries.data(), original_queries.data(), queries.size() * sizeof(double)) == 0,
                "Native resampler mutated query inputs");
        for (std::size_t row = 0; row < length; ++row) {
          if (dimensions) require(std::memcmp(values[row].data(), original_values[row].data(),
                  dimensions * sizeof(double)) == 0, "Native resampler mutated values");
        }
        std::reverse(queries.begin(), queries.end());
      }
    }
  }
  return @{@"calls": @(calls), @"comparison": counts.json()};
}

NSDictionary* compare_cubic(const editor_probe::Library& library) {
  const auto factory = editor_probe::entry<void* (*)()>(library, 0x1c3077c);
  void* utility = factory();
  require(utility != nullptr && factory() == utility, "VEUtils factory did not return a singleton");
  const void* vtable;
  std::memcpy(&vtable, utility, sizeof(vtable));
  require(vtable == library.base + 0x36aced0, "Unknown VEUtils vtable");
  NativeCubic native;
  std::memcpy(&native, static_cast<const std::uint8_t*>(vtable) + 0x168, sizeof(native));
  require(reinterpret_cast<const void*>(native) == library.base + 0x1d803e8,
          "VEUtils cubic virtual slot differs from static call chain");
  Counts counts;
  const auto other = editor_probe::entry<NativeFreeCubic>(library, 0x219ab10);
  std::size_t other_finite_differences = 0;
  NSDictionary* first_difference = nil;
  std::uint32_t random = 0xac847321;
  NSMutableArray* samples = [NSMutableArray array];
  constexpr std::array<std::uint32_t, 16> special{{0, 0x80000000, 1, 0x80000001,
      0x358637bc, 0x358637bd, 0x3f7ffff0, 0x3f7fffff, 0x3f800000,
      0xbf800000, 0x40000000, 0x7f800000, 0xff800000, 0x7fc12345,
      0x7f7fffff, 0xff7fffff}};
  for (std::size_t index = 0; index < 40000; ++index) {
    CubicCurve curve{};
    for (auto& point : curve.points) {
      point.time = static_cast<float>(static_cast<int>(next_random(random) % 4001) - 2000) / 128;
      point.value = static_cast<float>(static_cast<int>(next_random(random) % 4001) - 2000) / 64;
    }
    if (index % 8 == 0) curve.points[3].time = curve.points[0].time;
    if (index % 11 == 0) curve.points[1].time = curve.points[0].time;
    if (index % 13 == 0) curve.points[2].time = curve.points[3].time;
    const float progress = index % 3 == 0 ? std::bit_cast<float>(special[index % special.size()]) :
        static_cast<float>(next_random(random) % 10001) / 10000;
    if (index % 17 == 0) curve.points[index % 4].value = std::bit_cast<float>(special[index % special.size()]);
    std::array<std::uint32_t, 3> output{0x98765432, 0x3f800000, 0xfedcba98};
    float value = 1;
    // A genuine factory object is used; only the output reference is caller-owned.
    alignas(float) std::array<float, 3> guarded;
    std::memcpy(guarded.data(), output.data(), sizeof(output));
    const auto& p = curve.points;
    const auto status = native(utility, p[0].time, p[0].value, p[1].time, p[1].value,
        p[2].time, p[2].value, p[3].time, p[3].value, progress, guarded[1]);
    value = guarded[1];
    std::array<std::uint32_t, 3> after;
    std::memcpy(after.data(), guarded.data(), sizeof(after));
    require(status == 0 && after.front() == output.front() && after.back() == output.back(),
            "Cubic wrapper return status or output canary changed");
    counts.compare(value, editor_contract::evaluate_cubic(curve, progress));
    const auto alternative = other(p[0].time, p[0].value, p[1].time, p[1].value,
        p[2].time, p[2].value, p[3].time, p[3].value, progress);
    if (std::isfinite(value) && std::isfinite(alternative) &&
        std::bit_cast<std::uint32_t>(value) != std::bit_cast<std::uint32_t>(alternative)) {
      ++other_finite_differences;
      if (!first_difference) first_difference = @{@"caseIndex": @(index),
          @"actualWrapperBits": @(std::bit_cast<std::uint32_t>(value)),
          @"otherFreeFunctionBits": @(std::bit_cast<std::uint32_t>(alternative))};
    }
    if (index < 24) {
      NSMutableArray* arguments = [NSMutableArray array];
      for (const auto& point : p) {
        [arguments addObject:@(std::bit_cast<std::uint32_t>(point.time))];
        [arguments addObject:@(std::bit_cast<std::uint32_t>(point.value))];
      }
      [arguments addObject:@(std::bit_cast<std::uint32_t>(progress))];
      [samples addObject:@{@"inputBits": arguments, @"outputBits": @(after[1])}];
    }
  }
  return @{@"comparison": counts.json(), @"nativeSamples": samples,
           @"otherFreeFunctionFiniteDifferences": @(other_finite_differences),
           @"firstOtherDifference": first_difference ? static_cast<id>(first_difference) : [NSNull null],
           @"object": @"getVEUtils singleton", @"virtualSlot": @"0x168"};
}

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 3) throw std::runtime_error("Usage: editor-evaluation-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
      NSDictionary* result;
      {
        editor_probe::NativeOutputScope quiet;
        const auto editor = editor_probe::load_verified(argv[1]);
        const auto creator = editor_probe::load_verified(argv[2], editor_probe::kCreatorIdentity);
        result = @{@"videoeditorSha256": editor.sha256, @"videoeditorUuid": editor.uuid,
                   @"cccreatorSha256": creator.sha256, @"cccreatorUuid": creator.uuid,
                   @"resampling": compare_resampling(editor), @"cubic": compare_cubic(creator)};
      }
      NSError* error = nil;
      NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:&error];
      require(json != nil, "Cannot serialize evaluation results");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
