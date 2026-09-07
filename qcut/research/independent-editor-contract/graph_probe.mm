#include "native_graph.hpp"
#include "native_segments.hpp"
#include "native_property.hpp"
#include "native_output.hpp"
#include "graph_fixtures.hpp"

#include <cmath>
#include <iostream>

namespace {
using namespace editor_contract;
using editor_probe::KeyframeHandle;
using editor_probe::KeyframeList;
using editor_test::require;

struct Counts {
  std::uint64_t configurations = 0, records = 0, property_calls = 0, integers = 0, numbers = 0, nan = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  std::uint64_t property_fingerprint = editor_test::kFnvStart;
  std::uint64_t source_checks = 0;
  void integer(std::int64_t a, std::int64_t b, const std::string& context) {
    require(a == b, context + " native=" + std::to_string(a) + " independent=" + std::to_string(b));
    editor_test::hash_integer(fingerprint, static_cast<std::uint64_t>(a), 8);
    ++integers;
  }
  void number(double a, double b, const std::string& context) {
    if (std::isnan(a) && std::isnan(b)) {
      ++nan; editor_test::hash_integer(fingerprint, 0x7ff8000000000000ULL, 8); return;
    }
    require(std::bit_cast<std::uint64_t>(a) == std::bit_cast<std::uint64_t>(b),
        context + " nativeBits=" + std::to_string(std::bit_cast<std::uint64_t>(a)) +
        " independentBits=" + std::to_string(std::bit_cast<std::uint64_t>(b)));
    ++numbers; editor_test::hash_integer(fingerprint, std::bit_cast<std::uint64_t>(a), 8);
  }
  void vector(std::span<const double> a, std::span<const double> b, const std::string& context) {
    integer(static_cast<std::int64_t>(a.size()), static_cast<std::int64_t>(b.size()), context + " size");
    for (std::size_t i = 0; i < a.size(); ++i) number(a[i], b[i], context + " channel=" + std::to_string(i));
  }
  void record(const GraphRecord& a, const GraphRecord& b, const std::string& context) {
    integer(a.time, b.time, context + " time"); integer(a.curve_type, b.curve_type, context + " curve");
    vector(a.values, b.values, context + " values");
    number(a.incoming.time, b.incoming.time, context + " incoming time");
    number(a.incoming.value, b.incoming.value, context + " incoming value");
    number(a.outgoing.time, b.outgoing.time, context + " outgoing time");
    number(a.outgoing.value, b.outgoing.value, context + " outgoing value");
    integer(a.channel_incoming.time, b.channel_incoming.time, context + " channel incoming time");
    integer(a.channel_outgoing.time, b.channel_outgoing.time, context + " channel outgoing time");
    vector(a.channel_incoming.values, b.channel_incoming.values, context + " channel incoming");
    vector(a.channel_outgoing.values, b.channel_outgoing.values, context + " channel outgoing");
    ++records;
  }
  NSDictionary* json() const {
    return @{@"configurations": @(configurations), @"recordComparisons": @(records), @"propertyCalls": @(property_calls),
      @"integerComparisons": @(integers), @"nonNanDoubleBitExact": @(numbers), @"nanClassificationMatches": @(nan),
      @"fnv1a": @(fingerprint), @"matrixPropertyFnv1a": @(property_fingerprint), @"readOnlySourceChecks": @(source_checks), @"mismatches": @0};
  }
};

class Native {
 public:
  Native(const editor_probe::Library& editor, const editor_probe::Library& creator)
      : frames(editor), graphs(editor), segments(editor), library(editor) {
    utility = editor_probe::hold_cubic_utility(editor, creator);
  }
  KeyframeHandle frame(const CurvePropertyKeyframe& input) const {
    auto result = frames.frame(input.time, 1);
    frames.set_values(result, {input.values.begin(), input.values.end()});
    frames.set_curve(result, input.curve_type);
    frames.set_control(result, false, input.incoming);
    frames.set_control(result, true, input.outgoing);
    return result;
  }
  KeyframeHandle video(const ConstantSpeedSegment& input) const {
    auto result = segments.video();
    segments.set_source_range(result, segments.range(input.source.start, input.source.duration));
    segments.set_target_range(result, segments.range(input.target.start, input.target.duration));
    segments.set_constant_speed(result, input.speed); segments.set_offset(result, input.offset);
    return result;
  }
  std::vector<double> property(const KeyframeHandle& video, const KeyframeHandle& group, std::int64_t query) const {
    using Function = std::vector<double> (*)(KeyframeHandle, KeyframeHandle,
        const editor_probe::KeyframeTypeKey&, std::int64_t, std::int64_t);
    return editor_probe::entry<Function>(library, 0x33f35f4)(video, group, frames.type_key(), query, query);
  }
  void resolve(KeyframeList& records, const KeyframeHandle& video) const {
    editor_probe::entry<void (*)(KeyframeList&, const KeyframeHandle&)>(library, 0x1e92190)(records, video);
  }
  std::vector<std::uint64_t> snapshot_frame(const KeyframeHandle& frame) const {
    std::vector<std::uint64_t> bits{static_cast<std::uint64_t>(frames.time(frame)),
        static_cast<std::uint32_t>(frames.curve(frame)), frames.has_graph(frame)};
    for (const auto value : frames.values(frame)) bits.push_back(std::bit_cast<std::uint64_t>(value));
    for (const bool outgoing : {false, true}) {
      const auto point = frames.control(frame, outgoing);
      bits.push_back(std::bit_cast<std::uint64_t>(point.time)); bits.push_back(std::bit_cast<std::uint64_t>(point.value));
    }
    bits.push_back(editor_probe::graph_field<std::uint8_t>(frame, 0x20));
    bits.push_back(editor_probe::graph_field<std::uint32_t>(frame, 0x24));
    bits.push_back(editor_probe::graph_field<std::uint8_t>(frame, 0x28));
    const auto& graph = editor_probe::entry<const KeyframeHandle& (*)(void*)>(library, 0xc7e508)(frame.get());
    for (const auto point : graphs.convert(graph)) {
      bits.push_back(static_cast<std::uint32_t>(point.type));
      bits.push_back(std::bit_cast<std::uint64_t>(point.x)); bits.push_back(std::bit_cast<std::uint64_t>(point.y));
    }
    return bits;
  }
  editor_probe::KeyframeFactories frames;
  editor_probe::GraphFactories graphs;
  editor_probe::SegmentFactories segments;
  editor_probe::Library library;
 private:
  KeyframeHandle utility;
};

void compare_case(const Native& native, Counts& counts, const editor_test::GraphFixture& fixture,
                  const std::string& context, bool property_enabled, bool matrix = false) {
  const auto interval = fixture.input.interval();
  auto first = native.frame(interval.left), last = native.frame(interval.right);
  auto graph = native.graphs.create(fixture.points);
  const auto flat = native.graphs.convert(graph);
  counts.integer(static_cast<std::int64_t>(flat.size()), static_cast<std::int64_t>(fixture.points.size()), context + " graph size");
  for (std::size_t i = 0; i < flat.size(); ++i) {
    counts.integer(flat[i].type, fixture.points[i].type, context + " point type");
    counts.number(flat[i].x, fixture.points[i].time_fraction, context + " point x");
    counts.number(flat[i].y, fixture.points[i].value_fraction, context + " point y");
  }
  native.graphs.attach(last, graph);
  // A conflicting graph on the left must not drive this interval's expansion or property.
  native.graphs.attach(first, native.graphs.create(std::array<GraphPoint, 3>{{{0, 0, 0}, {1, .7, -.9}, {0, 1, 1}}}));
  const auto first_before = native.snapshot_frame(first), last_before = native.snapshot_frame(last);
  auto left_record = native.graphs.pack(first), right_record = native.graphs.pack(last);
  auto actual = native.graphs.expand(left_record, right_record);
  auto expected = expand_graph(interval, fixture.points);
  counts.integer(static_cast<std::int64_t>(actual.size()), static_cast<std::int64_t>(expected.size()), context + " record count");
  require(actual.front() == left_record && actual.back() == right_record, "Expansion lost native endpoint record identity");
  for (std::size_t i = 0; i < actual.size(); ++i) {
    counts.record(native.graphs.snapshot(actual[i]), expected[i], context + " record=" + std::to_string(i));
  }
  if (property_enabled) {
    const auto video = native.video(fixture.input.segment), group = native.frames.group();
    native.frames.set_list(group, {first, last});
    native.resolve(actual, video);
    for (std::size_t i = 0; i < actual.size(); ++i) {
      auto resolved = expected[i];
      const auto time = resolve_constant_speed_record(fixture.input.segment, {resolved.time, resolved.incoming, resolved.outgoing});
      resolved.time = time.time; resolved.incoming = time.left; resolved.outgoing = time.right;
      counts.record(native.graphs.snapshot(actual[i]), resolved, context + " resolved=" + std::to_string(i));
    }
    const auto duration = fixture.input.right_time - fixture.input.left_time;
    std::vector<std::int64_t> queries{fixture.input.left_time + 1, fixture.input.right_time - 1};
    for (std::int64_t step = 1; step < 19; ++step) queries.push_back(fixture.input.left_time + duration * step / 19);
    for (unsigned order = 0; order < 2; ++order) {
      for (std::size_t index = 0; index < queries.size(); ++index) {
        const auto query = queries[index];
        const auto values = native.property(video, group, query);
        counts.vector(values,
            evaluate_graph_property(fixture.input.segment, interval, fixture.points, query), context + " query=" + std::to_string(query));
        if (matrix && order == 0 && index >= 2) {
          for (const auto value : values) editor_test::hash_integer(counts.property_fingerprint,
              std::isnan(value) ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
        }
        ++counts.property_calls;
      }
      std::reverse(queries.begin(), queries.end());
    }
    // Expansion mutates temporary records; it must not replace or mutate the source frame fields.
    counts.integer(native.frames.time(first), interval.left.time, context + " source left time");
    counts.integer(native.frames.curve(last), interval.right.curve_type, context + " source right curve");
    counts.vector(native.frames.values(first), interval.left.values, context + " source left values");
    counts.vector(native.frames.values(last), interval.right.values, context + " source right values");
  }
  require(first_before == native.snapshot_frame(first) && last_before == native.snapshot_frame(last),
          context + " changed source frame/graph data or mutation bytes");
  counts.source_checks += 2;
  ++counts.configurations;
}

void edge_cases(const Native& native, Counts& counts) {
  compare_case(native, counts, editor_test::graph_rounding_fixture(), "non-fused-point-golden", true);
  for (std::size_t bits = 0; bits < editor_test::kDoubleBits.size(); ++bits) {
    for (std::size_t shape = 0; shape < 4; ++shape) {
      auto fixture = editor_test::graph_fixture(2, shape + 3);
      for (std::size_t i = 0; i < fixture.input.left_values.size(); ++i) {
        fixture.input.left_values[i] = std::bit_cast<double>(editor_test::kDoubleBits[(bits + i) % editor_test::kDoubleBits.size()]);
        fixture.input.right_values[i] = std::bit_cast<double>(editor_test::kDoubleBits[(bits + i + 7) % editor_test::kDoubleBits.size()]);
      }
      fixture.points[1].time_fraction = std::bit_cast<double>(editor_test::kDoubleBits[bits]);
      fixture.points[2].value_fraction = std::bit_cast<double>(editor_test::kDoubleBits[(bits + 9) % editor_test::kDoubleBits.size()]);
      compare_case(native, counts, fixture, "floating-edge=" + std::to_string(bits) + " shape=" + std::to_string(shape), true);
    }
  }
  for (std::size_t a = 0; a < editor_test::kTimeBits.size(); ++a) {
    for (std::size_t b = 0; b < editor_test::kTimeBits.size(); ++b) {
      for (std::size_t graph = 0; graph < 4; ++graph) {
        auto fixture = editor_test::graph_fixture(graph, a + b);
        fixture.input.left_time = std::bit_cast<std::int64_t>(editor_test::kTimeBits[a]);
        fixture.input.right_time = std::bit_cast<std::int64_t>(editor_test::kTimeBits[b]);
        compare_case(native, counts, fixture, "wrapped-left=" + std::to_string(a) + " right=" + std::to_string(b) + " graph=" + std::to_string(graph), false);
      }
    }
  }
  std::weak_ptr<void> graph_weak, point_weak;
  {
    auto frame = native.frames.frame(0, .5);
    {
      auto graph = native.graphs.create(std::array<GraphPoint, 2>{{{0, 0, 0}, {0, 1, 1}}});
      graph_weak = graph;
      point_weak = editor_probe::entry<const KeyframeList& (*)(void*)>(native.library, 0xd98070)(graph.get()).front();
      native.graphs.attach(frame, graph);
    }
    require(!graph_weak.expired() && !point_weak.expired(), "Attached native graph tree lost ownership");
  }
  require(graph_weak.expired() && point_weak.expired(), "Native graph tree survived its final owner");
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 3) throw std::runtime_error("Usage: editor-graph-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
      NSDictionary* result;
      {
        editor_probe::NativeOutputScope quiet;
        const auto editor = editor_probe::load_verified(argv[1]);
        const auto creator = editor_probe::load_verified(argv[2], editor_probe::kCreatorIdentity);
        const Native native(editor, creator);
        Counts counts;
        require(native.graphs.convert({}).empty(), "Null graph converter should return empty");
        require(native.graphs.convert(native.graphs.create({})).empty(), "Empty real graph converter should return empty");
        for (std::size_t graph = 0; graph < 12; ++graph) {
          for (std::size_t config = 0; config < 84; ++config) {
            compare_case(native, counts, editor_test::graph_fixture(graph, config),
                "graph=" + std::to_string(graph) + " config=" + std::to_string(config), true, true);
          }
        }
        edge_cases(native, counts);
        result = @{@"videoeditorSha256": editor.sha256, @"videoeditorUuid": editor.uuid,
          @"cccreatorSha256": creator.sha256, @"cccreatorUuid": creator.uuid, @"comparison": counts.json(),
          @"scope": @"Right-frame graph with endpoint anchors; original graph/point factories; constant-speed Video property"};
      }
      NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
      require(json != nil, "Cannot serialize graph evidence");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n'; return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
