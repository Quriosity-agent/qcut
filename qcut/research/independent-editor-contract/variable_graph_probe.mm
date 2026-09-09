#include "native_graph_context.hpp"
#include "native_variable_time.hpp"
#include "native_output.hpp"
#include "variable_graph_fixtures.hpp"

#include <algorithm>
#include <iostream>

namespace {
using namespace editor_contract;
using namespace editor_probe;

KeyframeHandle make_video(const NativeGraphContext& native, const Library& creator,
    const editor_test::VariableGraphFixture& fixture) {
  auto video = native.segments.video();
  const auto& segment = fixture.segment;
  native.segments.set_source_range(video, native.segments.range(segment.source.start, segment.source.duration));
  native.segments.set_target_range(video, native.segments.range(segment.target.start, segment.target.duration));
  native.segments.set_constant_speed(video, segment.negative_time_speed);
  native.segments.set_offset(video, segment.offset);
  NativeVariableTime speed(native.library, creator, fixture.speed, segment.target.duration);
  speed.attach(video, speed.make_curve(fixture.speed));
  return video;
}

void compare_case(const NativeGraphContext& native, const Library& creator, GraphCounts& counts,
    const editor_test::VariableGraphFixture& fixture, const std::string& context, bool property, bool matrix) {
  const VariableSpeedCurve curve(fixture.speed);
  const auto interval = fixture.graph.input.interval();
  auto first = native.frame(interval.left), last = native.frame(interval.right);
  auto graph = native.graphs.create(fixture.graph.points);
  native.graphs.attach(last, graph);
  native.graphs.attach(first, native.graphs.create(std::array<GraphPoint, 3>{{{0, 0, 0}, {1, .87, -.97}, {0, 1, 1}}}));
  const auto first_before = native.snapshot_frame(first), last_before = native.snapshot_frame(last);
  const auto left = native.graphs.pack(first), right = native.graphs.pack(last);
  auto records = native.graphs.expand(left, right);
  const auto expanded = expand_graph(interval, fixture.graph.points);
  counts.integer(static_cast<std::int64_t>(records.size()), static_cast<std::int64_t>(expanded.size()), context + " expansion shape");
  require(records.front() == left && records.back() == right, "Graph endpoint identity changed");
  for (std::size_t i = 0; i < records.size(); ++i) counts.record(GraphFactories::snapshot(records[i]), expanded[i], context + " raw record");
  const auto video = make_video(native, creator, fixture);
  native.resolve(records, video);
  const auto prepared = prepare_variable_graph(curve, fixture.segment, interval, fixture.graph.points);
  counts.integer(static_cast<std::int64_t>(records.size()), static_cast<std::int64_t>(prepared.size()), context + " resolved shape");
  for (std::size_t i = 0; i < records.size(); ++i) counts.record(GraphFactories::snapshot(records[i]), prepared[i], context + " resolved record");
  if (property) {
    const auto group = native.frames.group();
    native.frames.set_list(group, {first, last});
    auto queries = editor_test::variable_graph_queries(fixture.graph);
    for (unsigned order = 0; order < 2; ++order) {
      for (const auto query : queries) {
        const auto actual = native.property(video, group, query);
        counts.vector(actual, evaluate_variable_graph_property(curve, fixture.segment, interval, fixture.graph.points, query),
            context + " query=" + std::to_string(query));
        if (matrix && order == 0) {
          for (const auto value : actual) editor_test::hash_integer(counts.property_fingerprint,
              std::isnan(value) ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
        }
        ++counts.property_calls;
      }
      std::reverse(queries.begin(), queries.end());
    }
  }
  require(first_before == native.snapshot_frame(first) && last_before == native.snapshot_frame(last), context + " changed frame/graph source");
  counts.source_checks += 2;
  ++counts.configurations;
}

void special_cases(const NativeGraphContext& native, const Library& creator, GraphCounts& counts) {
  const std::array scalar_offsets{999.9, 1000.0, std::numeric_limits<double>::infinity(),
      -std::numeric_limits<double>::infinity(), std::bit_cast<double>(0x7ff8000000001234ULL),
      std::numeric_limits<double>::max()};
  for (const auto shape : {0U, 2U}) {
    for (std::size_t i = 0; i < scalar_offsets.size(); ++i) {
      auto fixture = editor_test::variable_graph_fixture(shape, 8 + i);
      fixture.graph.input.left_curve = 1; fixture.graph.input.right_curve = 2;
      fixture.graph.input.left_outgoing.time = scalar_offsets[i];
      fixture.graph.input.right_incoming.time = -scalar_offsets[i];
      compare_case(native, creator, counts, fixture, "scalar=" + std::to_string(shape) + "/" + std::to_string(i), true, false);
    }
  }
  for (std::size_t bits = 0; bits < editor_test::kDoubleBits.size(); ++bits) {
    auto fixture = editor_test::variable_graph_fixture(4, 8 + bits);
    fixture.graph.points[1].time_fraction = std::bit_cast<double>(editor_test::kDoubleBits[bits]);
    fixture.graph.points[3].value_fraction = std::bit_cast<double>(editor_test::kDoubleBits[(bits + 7) % editor_test::kDoubleBits.size()]);
    for (std::size_t channel = 0; channel < fixture.graph.input.left_values.size(); ++channel) {
      fixture.graph.input.left_values[channel] = std::bit_cast<double>(editor_test::kDoubleBits[(bits + channel) % editor_test::kDoubleBits.size()]);
      fixture.graph.input.right_values[channel] = std::bit_cast<double>(editor_test::kDoubleBits[(bits + channel + 7) % editor_test::kDoubleBits.size()]);
    }
    compare_case(native, creator, counts, fixture, "floating=" + std::to_string(bits), true, false);
  }
  for (std::size_t left = 0; left < editor_test::kTimeBits.size(); ++left) {
    for (std::size_t right = 0; right < editor_test::kTimeBits.size(); ++right) {
      auto fixture = editor_test::variable_graph_fixture(left % 12, 8 + right);
      fixture.graph.input.left_time = std::bit_cast<std::int64_t>(editor_test::kTimeBits[left]);
      fixture.graph.input.right_time = std::bit_cast<std::int64_t>(editor_test::kTimeBits[right]);
      compare_case(native, creator, counts, fixture, "wrapped=" + std::to_string(left) + "/" + std::to_string(right), false, false);
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool { try {
    require(argc == 3, "Usage: editor-variable_graph-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
    NSDictionary* result;
    {
      NativeOutputScope quiet;
      const auto editor = load_verified(argv[1]), creator = load_verified(argv[2], kCreatorIdentity);
      const NativeGraphContext native(editor, creator);
      GraphCounts counts;
      for (std::size_t graph = 0; graph < 12; ++graph) {
        for (std::size_t config = 0; config < 96; ++config) {
          compare_case(native, creator, counts, editor_test::variable_graph_fixture(graph, config),
              "graph=" + std::to_string(graph) + " config=" + std::to_string(config), true, true);
        }
      }
      special_cases(native, creator, counts);
      result = @{@"passed": @YES, @"videoeditorSha256": editor.sha256, @"cccreatorSha256": creator.sha256,
        @"comparison": counts.json(), @"scope": @"Nonempty right-frame graph and positive continuous variable speed; genuine Video property, scalar/channel controls; no complete dispatch"};
    }
    NSData* data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    require(data != nil, "Cannot serialize variable graph evidence");
    std::cout.write(static_cast<const char*>(data.bytes), static_cast<std::streamsize>(data.length)); std::cout << '\n';
  } catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; } }
}
