#include "native_variable_time.hpp"
#include "native_graph.hpp"
#include "native_property.hpp"
#include "native_output.hpp"
#include "variable_time_fixtures.hpp"
#include "test_support.hpp"

#include <iostream>

namespace {
using namespace editor_contract;
using namespace editor_probe;

struct Counts {
  std::uint64_t configurations = 0, maps = 0, normalizations = 0, records = 0, properties = 0, comparisons = 0, nan = 0, snapshots = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  std::uint64_t map_fingerprint = editor_test::kFnvStart;
  void integer(std::int64_t actual, std::int64_t expected, const std::string& context) {
    if (actual != expected) throw std::runtime_error(context + " native=" + std::to_string(actual) + " own=" + std::to_string(expected));
    editor_test::hash_integer(fingerprint, static_cast<std::uint64_t>(actual), 8); ++comparisons;
  }
  void number(double actual, double expected, const std::string& context) {
    if (std::isnan(actual) && std::isnan(expected)) { ++nan; editor_test::hash_integer(fingerprint, 0x7ff8000000000000ULL, 8); return; }
    integer(std::bit_cast<std::int64_t>(actual), std::bit_cast<std::int64_t>(expected), context);
  }
  NSDictionary* json() const {
    return @{@"configurations": @(configurations), @"mapCalls": @(maps), @"normalizedFloatValues": @(normalizations),
      @"records": @(records), @"propertyCalls": @(properties), @"bitExactComparisons": @(comparisons),
      @"nanClassificationMatches": @(nan), @"sourceSnapshotChecks": @(snapshots), @"fnv1a": @(fingerprint),
      @"portableMapFnv1a": @(map_fingerprint), @"mismatches": @0};
  }
};

KeyframeHandle create_video(const Library& editor, const NativeVariableTime& native,
    const VariableSpeedSegment& input, std::span<const SpeedControlPoint> points) {
  const SegmentFactories factories(editor);
  auto video = factories.video();
  factories.set_source_range(video, factories.range(input.source.start, input.source.duration));
  factories.set_target_range(video, factories.range(input.target.start, input.target.duration));
  factories.set_constant_speed(video, input.negative_time_speed); factories.set_offset(video, input.offset);
  native.attach(video, native.make_curve(points));
  return video;
}

void compare_maps(const Library& editor, const NativeVariableTime& native, const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const KeyframeHandle& video, Counts& counts, const std::string& context) {
  counts.integer(static_cast<std::int64_t>(native.sequence_points().size()), static_cast<std::int64_t>(curve.sequence_points().size()), "normalization size");
  for (std::size_t i = 0; i < curve.sequence_points().size(); ++i) {
    counts.integer(std::bit_cast<std::uint32_t>(native.sequence_points()[i]), std::bit_cast<std::uint32_t>(curve.sequence_points()[i]), "normalized float");
    ++counts.normalizations;
  }
  const auto to_timeline = entry<std::int64_t (*)(KeyframeHandle, std::int64_t)>(editor, 0x340737c);
  const auto to_source = entry<std::int64_t (*)(KeyframeHandle, std::int64_t)>(editor, 0x3407dbc);
  const auto to_relative = entry<std::int64_t (*)(KeyframeHandle, std::int64_t)>(editor, 0x340824c);
  const auto queries = editor_test::variable_queries(curve, segment.target.duration);
  for (const auto query : queries) {
    const auto where = context + " time=" + std::to_string(query);
    const auto integral = native.sequence_to_source(query), inverse = native.source_to_sequence(query);
    counts.integer(integral, curve.sequence_to_source(query, segment.target.duration), "integral " + where);
    counts.integer(inverse, curve.source_to_sequence(query, segment.target.duration), "inverse " + where);
    editor_test::hash_integer(counts.map_fingerprint, static_cast<std::uint64_t>(integral), 8);
    editor_test::hash_integer(counts.map_fingerprint, static_cast<std::uint64_t>(inverse), 8);
    counts.maps += 2;
  }
  // Actual Segment wrappers also apply endpoint snapping, raw negative-time fallback and offset.
  for (std::size_t i = 0; i < queries.size(); i += 17) {
    const auto query = queries[i];
    counts.integer(to_timeline(video, query), variable_keyframe_to_timeline(curve, segment, query), "timeline " + context);
    counts.integer(to_source(video, query), variable_timeline_to_keyframe(curve, segment, query), "keyframe " + context);
    counts.integer(to_relative(video, query), variable_keyframe_to_relative_sequence(curve, segment, query), "relative " + context);
    counts.maps += 3;
  }
}

void compare_records(const Library& editor, const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const KeyframeHandle& video, Counts& counts) {
  const KeyframeFactories frames(editor); const GraphFactories graphs(editor);
  const std::array<std::int64_t, 10> deltas{INT64_MIN, -1001, -1, 0, 1, 999, 1000, 2001, segment.source.duration,
      wrapped_sum(segment.source.duration, 1)};
  const std::array controls{-2000.1, -1000.1, -999.9, -0.0, 0.0, 999.9, 1000.0, 2000.1,
      -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(),
      std::bit_cast<double>(0x7ff8000000000123ULL), std::numeric_limits<double>::max()};
  for (const auto delta : deltas) {
    KeyframeList records; std::vector<ControlTimeRecord> expected;
    for (std::size_t i = 0; i < controls.size(); ++i) {
      const ControlTimeRecord input{wrapped_sum(segment.source.start, delta), {controls[i], -0.0}, {controls[controls.size() - 1 - i], .37}};
      auto frame = frames.frame(input.time, 2.5);
      frames.set_curve(frame, 3); frames.set_control(frame, false, input.left); frames.set_control(frame, true, input.right);
      records.push_back(graphs.pack(frame));
      expected.push_back(resolve_variable_speed_record(curve, segment.source, segment.target.duration, input));
    }
    entry<void (*)(KeyframeList&, const KeyframeHandle&)>(editor, 0x1e92190)(records, video);
    for (std::size_t i = 0; i < records.size(); ++i) {
      const auto actual = GraphFactories::snapshot(records[i]);
      counts.integer(actual.time, expected[i].time, "record time");
      counts.number(actual.incoming.time, expected[i].left.time, "record incoming time");
      counts.number(actual.outgoing.time, expected[i].right.time, "record outgoing time");
      counts.number(actual.incoming.value, expected[i].left.value, "record incoming value");
      counts.number(actual.outgoing.value, expected[i].right.value, "record outgoing value");
      counts.number(actual.values.at(0), 2.5, "record material value"); ++counts.records;
    }
  }
}

void compare_properties(const Library& editor, const VariableSpeedCurve& curve,
    const VariableSpeedSegment& segment, const KeyframeHandle& video, Counts& counts, std::size_t config) {
  const KeyframeFactories frames(editor);
  std::vector<double> left_values, right_values;
  for (std::size_t i = 0; i < 1 + config % 7; ++i) {
    left_values.push_back(static_cast<double>(i + 1) / 13);
    right_values.push_back(2 - static_cast<double>(i) / 17);
  }
  if (config % 8 == 7) {
    left_values[0] = std::bit_cast<double>(0x7ff8000000000123ULL);
    right_values.back() = std::numeric_limits<double>::infinity();
  }
  const auto first_time = wrapped_sum(segment.source.start, config % 4 == 0 ? -10000 : 10000);
  const auto last_time = wrapped_sum(segment.source.start, segment.source.duration + (config % 4 == 0 ? 10000 : -10000));
  const NonlinearPropertyInterval interval{
      {first_time, left_values, config % 3 == 0 ? 0 : 3, {-12345.3, -.17}, {12345.5, .37}},
      {last_time, right_values, config % 3 == 1 ? 0 : 2, {-23456.7, -.23}, {23456.9, .29}}};
  auto first = frames.frame(first_time, 1), last = frames.frame(last_time, 1), group = frames.group();
  frames.set_values(first, left_values); frames.set_values(last, right_values);
  frames.set_curve(first, interval.left.curve_type); frames.set_curve(last, interval.right.curve_type);
  frames.set_control(first, false, interval.left.incoming); frames.set_control(first, true, interval.left.outgoing);
  frames.set_control(last, false, interval.right.incoming); frames.set_control(last, true, interval.right.outgoing);
  frames.set_list(group, {first, last});
  auto snapshot = [&](const KeyframeHandle& frame) {
    std::vector<std::uint64_t> result{static_cast<std::uint64_t>(frames.time(frame)), static_cast<std::uint32_t>(frames.curve(frame)), frames.has_graph(frame)};
    for (const auto value : frames.values(frame)) result.push_back(std::bit_cast<std::uint64_t>(value));
    for (const bool outgoing : {false, true}) {
      const auto control = frames.control(frame, outgoing);
      result.push_back(std::bit_cast<std::uint64_t>(control.time)); result.push_back(std::bit_cast<std::uint64_t>(control.value));
    }
    result.push_back(graph_field<std::uint8_t>(frame, 0x20)); result.push_back(graph_field<std::uint32_t>(frame, 0x24));
    result.push_back(graph_field<std::uint8_t>(frame, 0x28)); return result;
  };
  const auto before_first = snapshot(first), before_last = snapshot(last);
  using Property = std::vector<double> (*)(KeyframeHandle, KeyframeHandle, const KeyframeTypeKey&, std::int64_t, std::int64_t);
  std::vector<std::int64_t> queries{first_time + 1, last_time - 1};
  for (std::int64_t step = 1; step < 40; ++step) {
    queries.push_back(first_time + (last_time - first_time) * step / 40);
  }
  const auto forward_queries = queries;
  queries.insert(queries.end(), forward_queries.rbegin(), forward_queries.rend());
  for (const auto query : queries) {
    const auto actual = entry<Property>(editor, 0x33f35f4)(video, group, frames.type_key(), query, query);
    const auto expected = evaluate_variable_property_interval(curve, segment, interval, query);
    counts.integer(static_cast<std::int64_t>(actual.size()), static_cast<std::int64_t>(expected.size()), "property shape");
    for (std::size_t i = 0; i < actual.size(); ++i) counts.number(actual[i], expected[i], "variable property");
    ++counts.properties;
  }
  if (snapshot(first) != before_first || snapshot(last) != before_last) throw std::runtime_error("Property evaluation changed a source keyframe");
  counts.snapshots += 2;
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool { try {
    if (argc != 3) throw std::invalid_argument("Usage: editor-variable_time-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
    const auto editor = load_verified(argv[1]); const auto creator = load_verified(argv[2], kCreatorIdentity);
    Counts counts;
    {
      NativeOutputScope quiet;
      auto property_utility = hold_cubic_utility(editor, creator);
      for (std::size_t config = 0; config < 48; ++config) {
        const auto points = editor_test::variable_curve(config);
        const VariableSpeedCurve curve(points);
        for (const auto duration : editor_test::kVariableDurations) {
          const auto segment = editor_test::variable_segment(duration, config);
          NativeVariableTime native(editor, creator, points, duration);
          auto video = create_video(editor, native, segment, points);
          compare_maps(editor, native, curve, segment, video, counts, "config=" + std::to_string(config) + " duration=" + std::to_string(duration));
          compare_records(editor, curve, segment, video, counts);
          if (duration == 2000000 || duration == 100000000) compare_properties(editor, curve, segment, video, counts, config);
          ++counts.configurations;
        }
      }
    }
    NSDictionary* result = @{@"schemaVersion": @1, @"passed": @YES, @"editorSha256": editor.sha256, @"creatorSha256": creator.sha256,
      @"comparison": counts.json(), @"scope": @"Positive continuous speed curve, SegmentVideo time helpers and preselected graph-free nonlinear property; no curve-speed editing or UI parity"};
    NSData* data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    if (!data) throw std::runtime_error("Cannot serialize variable-time evidence");
    std::cout.write(static_cast<const char*>(data.bytes), static_cast<std::streamsize>(data.length)); std::cout << '\n';
  } catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; } }
}
