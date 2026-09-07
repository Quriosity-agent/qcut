#include "native_segments.hpp"
#include "native_output.hpp"
#include "nonlinear_property_fixtures.hpp"
#include "wrapped_time.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>

namespace {
using editor_probe::KeyframeHandle;
using editor_test::NonlinearFixture;
using editor_test::require;
using Property = std::vector<double> (*)(KeyframeHandle, KeyframeHandle,
    const editor_probe::KeyframeTypeKey&, std::int64_t, std::int64_t);

struct Counts {
  std::uint64_t calls = 0, values = 0, nan = 0, configurations = 0, read_only_checks = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  void compare(const std::vector<double>& actual, const std::vector<double>& expected, const std::string& context) {
    require(actual.size() == expected.size(), context + " output shape differs");
    for (std::size_t i = 0; i < actual.size(); ++i) {
      const auto a = std::bit_cast<std::uint64_t>(actual[i]), b = std::bit_cast<std::uint64_t>(expected[i]);
      if (std::isnan(actual[i]) && std::isnan(expected[i])) {
        ++nan;
        editor_test::hash_integer(fingerprint, 0x7ff8000000000000ULL, 8);
      } else {
        require(a == b, context + " channel=" + std::to_string(i) + " nativeBits=" +
            std::to_string(a) + " independentBits=" + std::to_string(b));
        editor_test::hash_integer(fingerprint, a, 8);
      }
      ++values;
    }
    ++calls;
  }
  NSDictionary* json() const {
    return @{@"calls": @(calls), @"configurations": @(configurations), @"values": @(values),
      @"nonNanBitExact": @(values - nan), @"nanClassificationMatches": @(nan),
      @"readOnlyFrameChecks": @(read_only_checks), @"fnv1a": @(fingerprint), @"mismatches": @0};
  }
};

class NativeProperty {
 public:
  NativeProperty(const editor_probe::Library& editor, const editor_probe::Library& creator)
      : frames(editor), segments(editor), property(editor_probe::entry<Property>(editor, 0x33f35f4)) {
    utility_ = editor_probe::entry<KeyframeHandle (*)()>(editor, 0x2e877bc)();
    require(utility_ != nullptr, "Property runtime utility factory returned no object");
    const void* vtable;
    const void* cubic;
    std::memcpy(&vtable, utility_.get(), sizeof(vtable));
    require(vtable == creator.base + 0x36aced0, "Property runtime has an unknown VEUtils vtable");
    std::memcpy(&cubic, static_cast<const std::byte*>(vtable) + 0x168, sizeof(cubic));
    require(cubic == creator.base + 0x1d803e8, "Property runtime cubic virtual slot differs");
  }

  KeyframeHandle video(const NonlinearFixture& fixture) const {
    const auto result = segments.video();
    const auto& segment = fixture.segment;
    segments.set_source_range(result, segments.range(segment.source.start, segment.source.duration));
    segments.set_target_range(result, segments.range(segment.target.start, segment.target.duration));
    segments.set_constant_speed(result, segment.speed);
    segments.set_offset(result, segment.offset);
    return result;
  }
  KeyframeHandle frame(const NonlinearFixture& fixture, bool right) const {
    const auto input = right ? fixture.interval().right : fixture.interval().left;
    const auto result = frames.frame(input.time, 1);
    frames.set_curve(result, input.curve_type);
    frames.set_values(result, right ? fixture.right_values : fixture.left_values);
    frames.set_control(result, false, input.incoming);
    frames.set_control(result, true, input.outgoing);
    require(!frames.has_graph(result), "Nonlinear factory fixture unexpectedly contains a graph");
    return result;
  }
  std::vector<std::uint64_t> snapshot(const KeyframeHandle& frame) const {
    std::vector<std::uint64_t> result{static_cast<std::uint64_t>(frames.time(frame)),
                                    static_cast<std::uint32_t>(frames.curve(frame)), frames.has_graph(frame)};
    for (const auto value : frames.values(frame)) result.push_back(std::bit_cast<std::uint64_t>(value));
    for (const bool outgoing : {false, true}) {
      const auto control = frames.control(frame, outgoing);
      result.push_back(std::bit_cast<std::uint64_t>(control.time));
      result.push_back(std::bit_cast<std::uint64_t>(control.value));
    }
    const auto* bytes = static_cast<const std::uint8_t*>(frame.get());
    std::uint32_t code;
    std::memcpy(&code, bytes + 0x24, sizeof(code));
    result.insert(result.end(), {bytes[0x20], code, bytes[0x28]});
    return result;
  }

  editor_probe::KeyframeFactories frames;
  editor_probe::SegmentFactories segments;
  Property property;
 private:
  KeyframeHandle utility_;
};

std::vector<double> evaluate(const NativeProperty& native, Counts& counts, const NonlinearFixture& fixture,
    const KeyframeHandle& video, const KeyframeHandle& group, std::int64_t window_start,
    std::int64_t window_end, const std::string& context) {
  const auto query = editor_contract::wrapped_midpoint(window_start, window_end);
  const auto expected = editor_contract::evaluate_nonlinear_property_interval(fixture.segment, fixture.interval(), query);
  const auto actual = native.property(video, group, native.frames.type_key(), window_start, window_end);
  counts.compare(actual, expected, context + " start=" + std::to_string(window_start) + " end=" + std::to_string(window_end));
  return actual;
}

NSMutableArray* golden_cases(const NativeProperty& native, Counts& counts) {
  NSMutableArray* results = [NSMutableArray array];
  for (std::size_t i = 0; i < editor_test::kNonlinearGoldenCount; ++i) {
    const auto fixture = editor_test::nonlinear_golden(i);
    const auto video = native.video(fixture), group = native.frames.group();
    native.frames.set_list(group, {native.frame(fixture, false), native.frame(fixture, true)});
    const auto query = editor_test::nonlinear_golden_query(i);
    const auto values = evaluate(native, counts, fixture, video, group, query, query, "golden=" + std::to_string(i));
    if (i == 10) {
      require(std::memcmp(values.data(), fixture.right_values.data(), values.size() * sizeof(double)) == 0,
              "Record-tail fallback changed right-value signed zero or NaN payload bits");
    }
    NSMutableArray* bits = [NSMutableArray array];
    for (const auto value : values) [bits addObject:@(std::bit_cast<std::uint64_t>(value))];
    [results addObject:@{@"fixture": @(i), @"doubleBits": bits}];
    ++counts.configurations;
  }
  return results;
}

void matrix_cases(const NativeProperty& native, Counts& counts) {
  constexpr auto pair_count = editor_test::kCurveTypes.size() * editor_test::kCurveTypes.size() - 1;
  for (std::size_t pair = 0; pair < pair_count; ++pair) {
    for (std::size_t speed = 0; speed < editor_test::kCurveSpeeds.size(); ++speed) {
      for (std::size_t range = 0; range < editor_test::kCurveRangeCount; ++range) {
        const auto fixture = editor_test::nonlinear_matrix(pair, speed, range);
        const auto video = native.video(fixture), group = native.frames.group();
        const auto first = native.frame(fixture, false), last = native.frame(fixture, true);
        native.frames.set_list(group, {first, last});
        const auto first_before = native.snapshot(first), last_before = native.snapshot(last);
        const auto context = "pair=" + std::to_string(pair) + " speed=" + std::to_string(speed) + " range=" + std::to_string(range);
        for (const auto window : editor_test::nonlinear_windows(fixture)) {
          evaluate(native, counts, fixture, video, group, window.start, window.end, context);
        }
        require(native.snapshot(first) == first_before && native.snapshot(last) == last_before,
                context + " property evaluation changed source keyframe data or mutation bytes");
        counts.read_only_checks += 2;
        ++counts.configurations;
      }
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 3) throw std::runtime_error("Usage: editor-nonlinear_property-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
      NSDictionary* result;
      {
        editor_probe::NativeOutputScope quiet;
        const auto editor = editor_probe::load_verified(argv[1]);
        const auto creator = editor_probe::load_verified(argv[2], editor_probe::kCreatorIdentity);
        const NativeProperty native(editor, creator);
        Counts counts;
        const auto goldens = golden_cases(native, counts);
        matrix_cases(native, counts);
        result = @{@"videoeditorSha256": editor.sha256, @"videoeditorUuid": editor.uuid,
            @"cccreatorSha256": creator.sha256, @"cccreatorUuid": creator.uuid, @"comparison": counts.json(),
            @"goldens": goldens, @"scope": @"Two preselected graph-free Video keyframes; at least one nonzero curve; constant speed; non-hit raw window midpoint"};
      }
      NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
      require(json != nil, "Cannot serialize nonlinear property evidence");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
      return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
