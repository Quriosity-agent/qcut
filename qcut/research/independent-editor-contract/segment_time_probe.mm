#include "native_segments.hpp"
#include "native_output.hpp"
#include "segment_time.hpp"
#include "linear_property.hpp"
#include "test_support.hpp"
#include "wrapped_time.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstring>
#include <iostream>

namespace {
using editor_probe::KeyframeHandle;
using editor_probe::KeyframeList;
using editor_test::require;
using namespace editor_contract;

template<class T> T read_field(const KeyframeHandle& object, std::size_t offset) {
  T result;
  std::memcpy(&result, static_cast<const std::byte*>(object.get()) + offset, sizeof(T));
  return result;
}

struct Comparisons {
  std::uint64_t integers = 0, floating = 0, nan = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  void bits(std::uint64_t value) {
    for (unsigned i = 0; i < 8; ++i) {
      fingerprint ^= (value >> (i * 8)) & 255;
      fingerprint *= 1099511628211ULL;
    }
  }
  void integer(std::int64_t actual, std::int64_t expected, const std::string& context) {
    require(actual == expected, context + " native=" + std::to_string(actual) + " independent=" + std::to_string(expected));
    ++integers;
    bits(static_cast<std::uint64_t>(actual));
  }
  void number(double actual, double expected, const std::string& context) {
    if (std::isnan(expected)) {
      require(std::isnan(actual), context + " NaN classification differs");
      ++nan;
      bits(0x7ff8000000000000ULL);
      return;
    }
    require(std::bit_cast<std::uint64_t>(actual) == std::bit_cast<std::uint64_t>(expected), context + " floating bits differ");
    ++floating;
    bits(std::bit_cast<std::uint64_t>(actual));
  }
};

void configure(const editor_probe::SegmentFactories& factory, const KeyframeHandle& video,
               const ConstantSpeedSegment& segment) {
  factory.set_source_range(video, factory.range(segment.source.start, segment.source.duration));
  factory.set_target_range(video, factory.range(segment.target.start, segment.target.duration));
  factory.set_constant_speed(video, segment.speed);
  factory.set_offset(video, segment.offset);
}

void set_control(const editor_probe::Library& library, const KeyframeHandle& frame,
                 std::uintptr_t getter, ControlOffset control) {
  const auto point = editor_probe::entry<const KeyframeHandle& (*)(void*)>(library, getter)(frame.get());
  require(point != nullptr, "Factory control point is missing");
  // Move away from zero first: equal-value setters otherwise preserve the factory's +0 bits.
  const double seed = 1;
  editor_probe::entry<void (*)(void*, const double&)>(library, 0xc8ebac)(point.get(), seed);
  editor_probe::entry<void (*)(void*, const double&)>(library, 0xc8ebfc)(point.get(), seed);
  editor_probe::entry<void (*)(void*, const double&)>(library, 0xc8ebac)(point.get(), control.time);
  editor_probe::entry<void (*)(void*, const double&)>(library, 0xc8ebfc)(point.get(), control.value);
}

NSDictionary* compare(const editor_probe::Library& library) {
  using Time = std::int64_t (*)(KeyframeHandle, std::int64_t);
  const auto to_timeline = editor_probe::entry<Time>(library, 0x340737c);
  const auto to_keyframe = editor_probe::entry<Time>(library, 0x3407dbc);
  const auto to_relative = editor_probe::entry<Time>(library, 0x340824c);
  const auto pack = editor_probe::entry<KeyframeHandle (*)(const KeyframeHandle&, bool)>(library, 0x1e91c80);
  const auto resolve_records = editor_probe::entry<void (*)(KeyframeList&, const KeyframeHandle&)>(library, 0x1e92190);
  const editor_probe::SegmentFactories segments(library);
  const editor_probe::KeyframeFactories frames(library);
  const std::array<double, 12> speeds{0x1p-1074, 1e-200, .125, .3, .75, 1, 1.2, 2, 8, 1e100, 1e200, 0x1.fffffffffffffp1023};
  const std::array<std::int64_t, 8> durations{0, 1, 999, 1000, 1001, 2000, 1000001, INT64_MAX};
  const std::array<std::int64_t, 6> starts{0, 100000, -200000, INT64_MIN, INT64_MAX, 9007199791611905LL};
  Comparisons compared;
  std::uint64_t queries = 0, records = 0;
  for (std::size_t config = 0; config < 96; ++config) {
    const auto duration_index = config / speeds.size();
    const ConstantSpeedSegment segment{{starts[(config / 16) % starts.size()], durations[duration_index]},
        {starts[(config + 1) % starts.size()], durations[(duration_index * 3 + 1) % durations.size()]},
        speeds[config % speeds.size()], starts[(config / 8 + 3) % starts.size()]};
    const auto video = segments.video();
    configure(segments, video, segment);
    std::vector<std::int64_t> times{INT64_MIN, INT64_MAX, 0, -1, 1};
    for (const auto range : {segment.source, segment.target}) {
      for (const auto delta : {-1001LL, -1000LL, -999LL, 0LL, 999LL, 1000LL, 1001LL}) {
        times.push_back(wrapped_sum(range.start, delta));
        times.push_back(wrapped_sum(wrapped_sum(range.start, range.duration), delta));
      }
    }
    for (unsigned order = 0; order < 2; ++order) {
      for (const auto time : times) {
        const auto context = " config=" + std::to_string(config) + " time=" + std::to_string(time);
        compared.integer(to_timeline(video, time), keyframe_time_to_timeline(segment, time), "timeline" + context);
        compared.integer(to_keyframe(video, time), timeline_to_keyframe_time(segment, time), "keyframe" + context);
        compared.integer(to_relative(video, time), keyframe_time_to_relative_sequence(segment, time), "relative" + context);
        ++queries;
        const auto a = editor_test::kDoubleBits[(config + records) % editor_test::kDoubleBits.size()];
        const auto b = editor_test::kDoubleBits[(config + records + 7) % editor_test::kDoubleBits.size()];
        const ControlTimeRecord input{time, {std::bit_cast<double>(a), -0.0},
                                     {std::bit_cast<double>(b), 0.37}};
        const auto frame = frames.frame(time, 0.37);
        const std::int32_t curve = 1;
        editor_probe::entry<void (*)(void*, const std::int32_t&)>(library, 0xc7df78)(frame.get(), curve);
        set_control(library, frame, 0xc7dff0, input.left);
        set_control(library, frame, 0xc7e0d4, input.right);
        const auto record = pack(frame, false);
        require(record != nullptr, "Native record factory returned no object");
        compared.integer(read_field<std::int64_t>(record, 0), time, "packed time" + context);
        KeyframeList list{record};
        resolve_records(list, video);
        require(list.size() == 1 && list.front() == record, "Time resolver replaced native record identity");
        const auto expected = resolve_constant_speed_record(segment, input);
        compared.integer(read_field<std::int64_t>(record, 0), expected.time, "record time" + context);
        compared.number(read_field<double>(record, 0x40), expected.left.time, "record left" + context);
        compared.number(read_field<double>(record, 0x48), expected.left.value, "record left value" + context);
        compared.number(read_field<double>(record, 0x50), expected.right.time, "record right" + context);
        compared.number(read_field<double>(record, 0x58), expected.right.value, "record right value" + context);
        ++records;
      }
      std::reverse(times.begin(), times.end());
    }
  }
  return @{@"configurations": @96, @"timeQueries": @(queries), @"recordCalls": @(records),
      @"integerComparisons": @(compared.integers), @"nonNanDoubleBitExact": @(compared.floating),
      @"nanClassificationMatches": @(compared.nan), @"fnv1a": @(compared.fingerprint), @"mismatches": @0};
}

NSDictionary* compare_linear_property(const editor_probe::Library& library) {
  using Property = std::vector<double> (*)(KeyframeHandle, KeyframeHandle,
      const editor_probe::KeyframeTypeKey&, std::int64_t, std::int64_t);
  const auto property = editor_probe::entry<Property>(library, 0x33f35f4);
  const auto set_values = editor_probe::entry<void (*)(void*, const std::vector<double>&)>(library, 0xc7e1c8);
  const editor_probe::SegmentFactories segments(library);
  const editor_probe::KeyframeFactories frames(library);
  Comparisons compared;
  std::uint64_t calls = 0;
  const std::array<double, 6> speeds{.125, .3, .75, 1, 1.2, 8};
  const std::array<std::size_t, 4> shapes{1, 3, 8, 17};
  for (std::size_t config = 0; config < 72; ++config) {
    const double speed = speeds[config % speeds.size()];
    const auto start = static_cast<std::int64_t>(config) * 10000 - 200000;
    const ConstantSpeedSegment segment{{start, 2000000}, {5000000 + start, static_cast<std::int64_t>(2000000 / speed)},
        speed, static_cast<std::int64_t>(config) * 731};
    const auto video = segments.video();
    configure(segments, video, segment);
    const std::int64_t left_time = start + 5000, right_time = start + 1995000;
    std::vector<double> left, right;
    for (std::size_t i = 0; i < shapes[config % shapes.size()]; ++i) {
      left.push_back(std::bit_cast<double>(editor_test::kDoubleBits[(config + i) % editor_test::kDoubleBits.size()]));
      right.push_back(std::bit_cast<double>(editor_test::kDoubleBits[(config * 7 + i + 3) % editor_test::kDoubleBits.size()]));
    }
    const auto group = frames.group();
    const auto first = frames.frame(left_time, 1), last = frames.frame(right_time, 1);
    set_values(first.get(), left);
    set_values(last.get(), right);
    frames.set_list(group, {first, last});
    for (std::int64_t step = 1; step < 17; ++step) {
      const auto query = left_time + (right_time - left_time) * step / 17;
      const auto actual = property(video, group, frames.type_key(), query, query);
      const auto expected = evaluate_linear_property_interval(segment, {left_time, right_time, left, right}, query);
      require(actual.size() == expected.size(), "Linear property output shape differs");
      for (std::size_t i = 0; i < actual.size(); ++i) {
        compared.number(actual[i], expected[i], "Linear property config=" + std::to_string(config) + " step=" + std::to_string(step));
      }
      ++calls;
    }
  }
  const ConstantSpeedSegment golden_segment{{0, 19000}, {0, 19000}, 1};
  const auto golden_video = segments.video(), golden_group = frames.group();
  configure(segments, golden_video, golden_segment);
  frames.set_list(golden_group, {frames.frame(1000, .1), frames.frame(18000, .9)});
  const auto golden = property(golden_video, golden_group, frames.type_key(), 5000, 5000);
  require(golden.size() == 1, "Unfused native counterexample shape differs");
  compared.number(golden[0], 0x1.2727272727272p-2, "Native unfused arithmetic golden");
  require(golden[0] != std::fma(.9 - .1, 4.0 / 17.0, .1), "Fused arithmetic counterexample disappeared");
  ++calls;
  return @{@"calls": @(calls), @"nonNanDoubleBitExact": @(compared.floating),
      @"nanClassificationMatches": @(compared.nan), @"fnv1a": @(compared.fingerprint), @"mismatches": @0,
      @"scope": @"Two preselected curve-zero graph-free Video keyframes; interior raw-time queries"};
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::runtime_error("Usage: editor-segment_time-probe /absolute/libvideoeditor.dylib");
      NSDictionary* result;
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        result = @{@"sha256": library.sha256, @"uuid": library.uuid, @"constantSpeed": compare(library),
          @"linearProperty": compare_linear_property(library),
          @"factory": @"CombinationUtils::makeCombination(null Draft), SDK-owned detached SegmentVideo tree",
          @"scope": @"Video constant-speed time helpers and packed control-record transform; no curve-speed or full seek"};
      }
      NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
      require(json != nil, "Cannot serialize Segment time evidence");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
