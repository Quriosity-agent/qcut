#include "native_keyframes.hpp"
#include "native_output.hpp"
#include "test_support.hpp"
#include "window.hpp"
#include "wrapped_time.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cstring>
#include <iostream>
#include <limits>

namespace {

using editor_probe::KeyframeHandle;
using editor_probe::KeyframeList;
using editor_test::require;
using editor_contract::KeyframeWindow;
using NativeFind = KeyframeHandle (*)(KeyframeHandle, std::int64_t, std::int64_t,
                                     bool, KeyframeHandle*, KeyframeHandle*);
using NativeProperty = std::vector<double> (*)(KeyframeHandle, KeyframeHandle,
    const editor_probe::KeyframeTypeKey&, std::int64_t, std::int64_t);

struct GuardedHandle {
  std::uint64_t before = 0x9f123456abcdef01ULL;
  KeyframeHandle value;
  std::uint64_t after = 0x1fedcba6543210f9ULL;
  void check() const {
    require(before == 0x9f123456abcdef01ULL && after == 0x1fedcba6543210f9ULL,
            "Native neighbor output overran its shared_ptr slot");
  }
};

std::optional<std::size_t> index_of(const KeyframeHandle& handle, const KeyframeList& frames) {
  if (!handle) return {};
  const auto found = std::find(frames.begin(), frames.end(), handle);
  require(found != frames.end(), "Native finder returned a foreign object");
  return static_cast<std::size_t>(found - frames.begin());
}

std::uint64_t random_bits(std::uint64_t& state) {
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return state;
}

NSDictionary* compare_windows(const editor_probe::Library& library) {
  const editor_probe::KeyframeFactories factory(library);
  const auto native_find = editor_probe::entry<NativeFind>(library, 0x340b6a8);
  const auto native_property = editor_probe::entry<NativeProperty>(library, 0x33f35f4);
  std::uint64_t random = 0x1974eac38719b3ULL;
  std::uint64_t cases = 0, hits = 0, removals = 0, endpoint_values = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  std::size_t native_objects = 0;
  for (std::size_t series = 0; series < 192; ++series) {
    std::vector<std::int64_t> times;
    KeyframeList frames;
    std::vector<double> values;
    const auto count = series % 19;
    for (std::size_t i = 0; i < count; ++i) {
      std::int64_t time;
      if (series % 3 == 0) time = static_cast<std::int64_t>(random_bits(random) % 31) - 15;
      else time = std::bit_cast<std::int64_t>(editor_test::kTimeBits[random_bits(random) % editor_test::kTimeBits.size()]);
      times.push_back(time);
    }
    if (series % 2 == 0) std::sort(times.begin(), times.end());
    const auto group = factory.group();
    ++native_objects;
    for (std::size_t i = 0; i < count; ++i) {
      const double value = std::bit_cast<double>(editor_test::kDoubleBits[(series + i) % editor_test::kDoubleBits.size()]);
      frames.push_back(factory.frame(times[i], value));
      values.push_back(value);
      ++native_objects;
      require(factory.time(frames.back()) == times[i], "Native frame factory changed int64 time");
    }
    factory.set_list(group, frames);
    require(factory.list(group) == frames, "Native list setter sorted or changed frame identity");
    std::vector<KeyframeWindow> windows{{0, 0}, {-1, 1}, {1, -1}, {-2, -1},
        {INT64_MIN, INT64_MIN}, {INT64_MAX, INT64_MAX}, {INT64_MIN, INT64_MAX}};
    for (const auto time : times) {
      windows.push_back({time, time});
      windows.push_back({editor_contract::wrapped_difference(time, 1000), editor_contract::wrapped_sum(time, 1000)});
    }
    for (std::size_t i = 0; i < 8; ++i) {
      windows.push_back({std::bit_cast<std::int64_t>(random_bits(random)),
                         std::bit_cast<std::int64_t>(random_bits(random))});
    }
    for (int order = 0; order < 2; ++order) {
      for (const auto window : windows) {
        const auto expected = editor_contract::select_keyframe_window(times, window);
        for (const bool remove : {false, true}) {
          for (unsigned outputs = 0; outputs < 4; ++outputs) {
            factory.set_list(group, frames);
            GuardedHandle previous, next;
            if (!frames.empty()) previous.value = next.value = frames.front();
            const auto selected = native_find(group, window.start, window.end, remove,
                outputs & 1 ? &previous.value : nullptr, outputs & 2 ? &next.value : nullptr);
            previous.check(); next.check();
            const auto actual_index = index_of(selected, frames);
            if (actual_index != expected.selected ||
                ((outputs & 1) && index_of(previous.value, frames) != expected.previous) ||
                ((outputs & 2) && index_of(next.value, frames) != expected.next)) {
              throw std::runtime_error("Window mismatch series=" + std::to_string(series) +
                  " start=" + std::to_string(window.start) + " end=" + std::to_string(window.end));
            }
            auto remaining = frames;
            if (remove && expected.selected) {
              remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(*expected.selected));
              ++removals;
            }
            require(factory.list(group) == remaining, "Native removal altered another frame or reordered the list");
            if (!remove && expected.selected) {
              const auto output = native_property({}, group, factory.type_key(), window.start, window.end);
              require(output.size() == 1 && std::memcmp(output.data(), &values[*expected.selected], sizeof(double)) == 0,
                      "Exact property-window hit changed the stored double bits");
              ++endpoint_values;
            }
            ++cases;
            if (selected) ++hits;
            const std::array<std::uint64_t, 4> summary{
                static_cast<std::uint64_t>(expected.midpoint),
                actual_index ? *actual_index : UINT64_MAX,
                expected.previous ? *expected.previous : UINT64_MAX,
                expected.next ? *expected.next : UINT64_MAX};
            for (const auto item : summary) {
              for (unsigned byte = 0; byte < 8; ++byte) {
                fingerprint ^= (item >> (byte * 8)) & 255;
                fingerprint *= 1099511628211ULL;
              }
            }
          }
        }
      }
      std::reverse(windows.begin(), windows.end());
    }
  }
  // A missing group is a distinct ABI path: unlike an empty list, outputs remain untouched.
  GuardedHandle previous, next;
  previous.value = factory.frame(1, 1);
  next.value = factory.frame(2, 2);
  const auto old_previous = previous.value, old_next = next.value;
  require(!native_find({}, 0, 0, false, &previous.value, &next.value) &&
          previous.value == old_previous && next.value == old_next, "Null-group output behavior changed");
  previous.check(); next.check();
  return @{@"cases": @(cases), @"selected": @(hits), @"removals": @(removals),
           @"exactPropertyDoubleCopies": @(endpoint_values), @"sdkObjectsCreated": @(native_objects + 2),
           @"fnv1a": @(fingerprint), @"mismatches": @0, @"nullGroupPreservesNeighborOutputs": @YES};
}

NSDictionary* verify_missing_segment_time(const editor_probe::Library& library) {
  using Time = std::int64_t (*)(KeyframeHandle, std::int64_t);
  for (const auto address : {0x340737cULL, 0x340824cULL}) {
    const auto native = editor_probe::entry<Time>(library, address);
    for (const auto bits : editor_test::kTimeBits) {
      require(native({}, std::bit_cast<std::int64_t>(bits)) == -1,
              "Missing Segment is not the verified -1 sentinel");
    }
  }
  return @{@"cases": @(editor_test::kTimeBits.size() * 2), @"sentinel": @(-1),
           @"doesNotVerifyRealSegmentTimeConversion": @YES};
}

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::runtime_error("Usage: editor-window-probe /absolute/libvideoeditor.dylib");
      NSDictionary* result;
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        result = @{@"sha256": library.sha256, @"uuid": library.uuid,
                   @"windows": compare_windows(library), @"missingSegmentTime": verify_missing_segment_time(library),
                   @"timeAdapterEvidence": @"static instructions; not complete native Segment timing"};
      }
      NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
      require(json != nil, "Cannot serialize window evidence");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
      return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
