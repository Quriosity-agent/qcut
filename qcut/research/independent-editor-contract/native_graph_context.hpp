#pragma once

#include "native_graph.hpp"
#include "native_segments.hpp"
#include "native_property.hpp"
#include "test_support.hpp"

#include <cmath>

namespace editor_probe {
using editor_test::require;
using editor_contract::GraphRecord;
using editor_contract::CurvePropertyKeyframe;
using editor_contract::ConstantSpeedSegment;

struct GraphCounts {
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

class NativeGraphContext {
 public:
  NativeGraphContext(const editor_probe::Library& editor, const editor_probe::Library& creator)
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

}  // namespace editor_probe
