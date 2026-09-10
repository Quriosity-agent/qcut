#include "native_graph_context.hpp"
#include "native_output.hpp"
#include "property_dispatch_fixtures.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <optional>

namespace {
using namespace editor_contract;
using namespace editor_probe;

using NativeProperty = std::vector<double> (*)(KeyframeHandle, KeyframeHandle,
    const KeyframeTypeKey&, std::int64_t, std::int64_t);
using NativeFind = KeyframeHandle (*)(KeyframeHandle, std::int64_t, std::int64_t, bool,
    KeyframeHandle*, KeyframeHandle*);
using NativeCaption = bool (*)(const KeyframeHandle&);

constexpr std::array<const char*, 8> kBranchNames{"segmentDefault", "exactHit", "nextCopy",
    "previousCopy", "clampedPrevious", "clampedNext", "linear", "curved"};

struct DispatchCounts {
  GraphCounts numeric;
  std::array<std::uint64_t, 8> branches{};
  std::uint64_t configurations = 0, calls = 0, refusals = 0, selections = 0;
  std::uint64_t source_checks = 0, caption_key_calls = 0, empty_value_calls = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  NSDictionary* json() const {
    NSMutableDictionary* histogram = [NSMutableDictionary dictionary];
    for (std::size_t i = 0; i < branches.size(); ++i) histogram[@(kBranchNames[i])] = @(branches[i]);
    return @{@"configurations": @(configurations), @"propertyCalls": @(calls), @"branches": histogram,
      @"independentRefusals": @(refusals), @"finderAttributionChecks": @(selections),
      @"integerComparisons": @(numeric.integers), @"nonNanDoubleBitExact": @(numeric.numbers),
      @"nanClassificationMatches": @(numeric.nan), @"readOnlySourceChecks": @(source_checks),
      @"captionKeyCalls": @(caption_key_calls), @"emptyValueCalls": @(empty_value_calls),
      @"comparisonFnv1a": @(numeric.fingerprint), @"branchFnv1a": @(fingerprint), @"mismatches": @0};
  }
};

std::optional<std::size_t> index_of(const KeyframeHandle& handle, const KeyframeList& frames) {
  if (!handle) return {};
  const auto found = std::find(frames.begin(), frames.end(), handle);
  require(found != frames.end(), "Native finder returned a foreign keyframe");
  return static_cast<std::size_t>(found - frames.begin());
}

std::vector<std::uint64_t> snapshot(const KeyframeFactories& factory, const KeyframeHandle& frame) {
  std::vector<std::uint64_t> bits{static_cast<std::uint64_t>(factory.time(frame)),
      static_cast<std::uint32_t>(factory.curve(frame)), factory.has_graph(frame)};
  for (const auto value : factory.values(frame)) bits.push_back(std::bit_cast<std::uint64_t>(value));
  for (const bool outgoing : {false, true}) {
    const auto point = factory.control(frame, outgoing);
    bits.push_back(std::bit_cast<std::uint64_t>(point.time));
    bits.push_back(std::bit_cast<std::uint64_t>(point.value));
  }
  return bits;
}

struct NativeFixture {
  KeyframeHandle video, group;
  KeyframeList list;
  std::vector<std::vector<std::uint64_t>> before;
};

NativeFixture build(const NativeGraphContext& native, const editor_test::DispatchFixture& fixture,
                    const std::vector<DispatchKeyframe>& view) {
  NativeFixture result;
  result.video = native.video(fixture.segment);
  for (const auto& entry : view) {
    result.list.push_back(native.frame(entry.frame));
    require(!native.frames.has_graph(result.list.back()), "Native keyframe factory attached a graph");
    result.before.push_back(snapshot(native.frames, result.list.back()));
  }
  result.group = native.frames.group();
  native.frames.set_list(result.group, result.list);
  require(native.frames.list(result.group) == result.list, "Native group setter reordered the list");
  return result;
}

void compare_window(const NativeGraphContext& native, DispatchCounts& counts, const NativeFixture& objects,
    const editor_test::DispatchFixture& fixture, const std::vector<DispatchKeyframe>& view,
    KeyframeWindow window, const std::string& context, bool caption_key, NSMutableArray* goldens) {
  const auto property = entry<NativeProperty>(native.library, 0x33f35f4);
  const auto find = entry<NativeFind>(native.library, 0x340b6a8);
  std::optional<PropertyDispatchResult> expected;
  try {
    expected = dispatch_property_values({fixture.segment, view, window,
        native.frames.type_key().property, false});
  } catch (const std::invalid_argument&) { ++counts.refusals; return; }
  catch (const std::length_error&) { ++counts.refusals; return; }
  const auto actual = property(objects.video, objects.group, native.frames.type_key(), window.start, window.end);
  ++counts.calls;
  ++counts.branches[static_cast<std::size_t>(expected->branch)];
  editor_test::hash_integer(counts.fingerprint, static_cast<std::uint64_t>(expected->branch), 1);
  if (expected->branch == PropertyDispatchBranch::SegmentDefault) {
    counts.numeric.integer(static_cast<std::int64_t>(actual.size()), 0, context + " unmodeled Segment chain");
  } else {
    counts.numeric.vector(actual, expected->values, context);
  }
  // The finder decides the branch; comparing object identity keeps the attribution independent.
  std::vector<std::int64_t> times;
  for (const auto& entry : view) times.push_back(entry.frame.time);
  const auto selection = select_keyframe_window(times, window);
  KeyframeHandle previous, next;
  const auto selected = find(objects.group, window.start, window.end, false, &previous, &next);
  require(index_of(selected, objects.list) == selection.selected &&
          index_of(previous, objects.list) == selection.previous &&
          index_of(next, objects.list) == selection.next, context + " native branch attribution differs");
  require(native.frames.list(objects.group) == objects.list, context + " read-only finder changed the list");
  ++counts.selections;
  if (caption_key) {
    // A Video segment never satisfies the Caption predicate, so a color key must not change the result.
    const KeyframeTypeKey color{"KFTypeTextColor", "synthetic-only"};
    const auto colored = property(objects.video, objects.group, color, window.start, window.end);
    counts.numeric.vector(colored, actual, context + " caption color key");
    ++counts.caption_key_calls;
  }
  if (goldens != nil) {
    NSMutableArray* bits = [NSMutableArray array];
    for (const auto value : actual) {
      [bits addObject:[NSString stringWithFormat:@"0x%016llx",
          static_cast<unsigned long long>(std::bit_cast<std::uint64_t>(value))]];
    }
    [goldens addObject:@{@"context": @(context.c_str()), @"start": @(window.start), @"end": @(window.end),
        @"branch": @(kBranchNames[static_cast<std::size_t>(expected->branch)]), @"bits": bits}];
  }
}

void compare_fixture(const NativeGraphContext& native, DispatchCounts& counts,
                     std::size_t shape, std::size_t config) {
  const auto fixture = editor_test::dispatch_fixture(shape, config);
  const auto view = fixture.view();
  const auto objects = build(native, fixture, view);
  auto windows = editor_test::dispatch_windows(fixture);
  const std::string prefix = "shape=" + std::to_string(shape) + " config=" + std::to_string(config);
  for (unsigned order = 0; order < 2; ++order) {
    for (std::size_t index = 0; index < windows.size(); ++index) {
      const auto window = windows[index];
      compare_window(native, counts, objects, fixture, view, window,
          prefix + " window=[" + std::to_string(window.start) + "," + std::to_string(window.end) + "]",
          order == 0 && index % 8 == 0, nil);
    }
    std::reverse(windows.begin(), windows.end());
  }
  for (std::size_t i = 0; i < objects.list.size(); ++i) {
    require(objects.before[i] == snapshot(native.frames, objects.list[i]), prefix + " changed a source keyframe");
    ++counts.source_checks;
  }
  ++counts.configurations;
}

// The empty-values fallback is only observable as an empty native vector; both paths return one.
void empty_value_cases(const NativeGraphContext& native, DispatchCounts& counts) {
  const auto property = entry<NativeProperty>(native.library, 0x33f35f4);
  const auto segment = editor_test::dispatch_segment(0);
  const auto video = native.video(segment);
  const std::array<double, 1> filled{4.5};
  for (const std::size_t empty_index : {std::size_t{0}, std::size_t{1}}) {
    KeyframeList list;
    std::vector<DispatchKeyframe> view;
    for (std::size_t index = 0; index < 2; ++index) {
      const std::span<const double> values = index == empty_index ? std::span<const double>{} : filled;
      const CurvePropertyKeyframe frame{index == 0 ? 9000 : 17000, values, 0, {}, {}};
      view.push_back({frame, false});
      list.push_back(native.frame(frame));
    }
    const auto group = native.frames.group();
    native.frames.set_list(group, list);
    for (const auto window : {KeyframeWindow{9000, 9000}, KeyframeWindow{17000, 17000},
                              KeyframeWindow{13000, 13000}, KeyframeWindow{-100000, -99000}}) {
      std::optional<PropertyDispatchResult> expected;
      try { expected = dispatch_property_values({segment, view, window, "qcut-window-probe", false}); }
      catch (const std::invalid_argument&) { ++counts.refusals; continue; }
      const auto actual = property(video, group, native.frames.type_key(), window.start, window.end);
      const std::string context = "emptyValues=" + std::to_string(empty_index) +
          " window=" + std::to_string(window.start);
      if (expected->branch == PropertyDispatchBranch::SegmentDefault) {
        counts.numeric.integer(static_cast<std::int64_t>(actual.size()), 0, context + " empty fallback");
      } else {
        counts.numeric.vector(actual, expected->values, context);
      }
      ++counts.empty_value_calls;
    }
  }
}

NSArray* capture_goldens(const NativeGraphContext& native, DispatchCounts& counts) {
  struct Request { std::size_t shape, config; KeyframeWindow window; };
  const std::array<Request, 15> requests{{{0, 16, {17000, 17000}}, {0, 16, {-100000, -99000}},
      {0, 16, {900000, 910000}}, {0, 16, {13000, 13000}}, {0, 18, {13000, 13000}},
      {1, 4, {10004, 10004}}, {1, 4, {10001, 10001}}, {2, 4, {33000, 33000}}, {3, 4, {45000, 45000}},
      {4, 8, {1600, 1600}}, {4, 8, {1350, 1350}}, {5, 8, {40100, 40100}}, {10, 4, {1250, 1250}},
      {9, 9, {INT64_MAX, INT64_MAX}}, {6, 7, {1, -1}}}};
  NSMutableArray* goldens = [NSMutableArray array];
  for (const auto& request : requests) {
    const auto fixture = editor_test::dispatch_fixture(request.shape, request.config);
    const auto view = fixture.view();
    const auto objects = build(native, fixture, view);
    compare_window(native, counts, objects, fixture, view, request.window,
        "golden shape=" + std::to_string(request.shape) + " config=" + std::to_string(request.config),
        false, goldens);
  }
  return goldens;
}

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool { try {
    require(argc == 3, "Usage: editor-property_dispatch-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
    NSDictionary* result;
    {
      NativeOutputScope quiet;
      const auto editor = load_verified(argv[1]), creator = load_verified(argv[2], kCreatorIdentity);
      const NativeGraphContext native(editor, creator);
      DispatchCounts counts;
      const auto caption = entry<NativeCaption>(editor, 0x2a1e5a0);
      const auto probe_video = native.video(editor_test::dispatch_segment(0));
      require(!caption(probe_video) && !caption(KeyframeHandle{}),
              "The Caption predicate is not false for a Video segment");
      for (std::size_t shape = 0; shape < editor_test::kDispatchShapes; ++shape) {
        for (std::size_t config = 0; config < editor_test::kDispatchConfigs; ++config) {
          compare_fixture(native, counts, shape, config);
        }
      }
      empty_value_cases(native, counts);
      NSArray* goldens = capture_goldens(native, counts);
      result = @{@"passed": @YES, @"videoeditorSha256": editor.sha256, @"cccreatorSha256": creator.sha256,
        @"captionPredicateFalseForVideo": @YES, @"comparison": counts.json(), @"goldens": goldens,
        @"scope": @"One SegmentVideo, positive constant speed, graph-free keyframes; the eleven Segment-type "
                  @"default getters and the Caption color path are reported, not implemented"};
    }
    NSData* data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    require(data != nil, "Cannot serialize property dispatch evidence");
    std::cout.write(static_cast<const char*>(data.bytes), static_cast<std::streamsize>(data.length));
    std::cout << '\n';
  } catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; } }
}
