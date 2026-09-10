#include "caption_color_fixtures.hpp"
#include "native_library.hpp"
#include "native_output.hpp"

#include <array>
#include <bit>
#include <cmath>
#include <iostream>
#include <string>

namespace {
using namespace editor_contract;
using namespace editor_probe;
using editor_test::require;

// The evaluator has no symbol, so the address alone is not an identity. These are the
// first instruction words at each entry; a different Jianying build fails here instead of
// calling whatever now lives at the offset.
constexpr std::uintptr_t kColorEvaluator = 0x33f1e9c;
constexpr std::uintptr_t kTypePredicate = 0x2a1e6b8;
constexpr std::array<std::uint32_t, 12> kEvaluatorWords{
    0xd10243ffU, 0x6d033befU, 0x6d0433edU, 0x6d052bebU, 0x6d0623e9U, 0xa9074ff4U,
    0xa9087bfdU, 0x910203fdU, 0xaa0803f3U, 0x9000b828U, 0xf9428d08U, 0xf9400108U};
constexpr std::array<std::uint32_t, 8> kPredicateWords{
    0xa9be4ff4U, 0xa9017bfdU, 0x910043fdU, 0xaa0003f3U, 0x39405c0aU, 0x13001d49U,
    0xf9400408U, 0x7100013fU};

using NativeColor = std::vector<double> (*)(const std::vector<double>&,
                                            const std::vector<double>&, float);
using NativeType = bool (*)(const std::string&);

constexpr std::array<const char*, 9> kPathNames{"shapeFallback", "rangeFallback",
    "sectorFallback", "sector0", "sector1", "sector2", "sector3", "sector4", "sector5"};

// Recomputed from the published narrowing helper so that branch attribution comes from the
// observed integers, not from a guess made after the values matched.
struct SideShape {
  std::int32_t red = 0, green = 0, blue = 0, upper = 0, lower = 0, peak = 0, base = 0, spread = 0;
};

SideShape shape_of(const std::vector<double>& channels) {
  SideShape shape;
  shape.red = saturating_trunc_to_int32(channels[0] * 255.0);
  shape.green = saturating_trunc_to_int32(channels[1] * 255.0);
  shape.blue = saturating_trunc_to_int32(channels[2] * 255.0);
  shape.upper = shape.red < shape.green ? shape.green : shape.red;
  shape.lower = shape.red > shape.green ? shape.green : shape.red;
  shape.peak = shape.upper < shape.blue ? shape.blue : shape.upper;
  shape.base = shape.lower > shape.blue ? shape.blue : shape.lower;
  shape.spread = static_cast<std::int32_t>(static_cast<std::uint32_t>(shape.peak) -
                                           static_cast<std::uint32_t>(shape.base));
  return shape;
}

struct SideCounts {
  std::uint64_t peak_zero = 0, peak_nonzero = 0, flat = 0, red_arm = 0, green_arm = 0, blue_arm = 0;
  std::uint64_t unreachable_arm = 0;
  void observe(const SideShape& shape) {
    if (shape.peak == 0) ++peak_zero; else ++peak_nonzero;
    if (shape.spread == 0) { ++flat; return; }
    if (shape.peak == shape.red) ++red_arm;
    else if (shape.peak == shape.green) ++green_arm;
    else if (shape.upper <= shape.blue) ++blue_arm;
    else ++unreachable_arm;
  }
  NSDictionary* json() const {
    return @{@"peakZero": @(peak_zero), @"peakNonZero": @(peak_nonzero), @"flatSpread": @(flat),
      @"hueFromRed": @(red_arm), @"hueFromGreen": @(green_arm), @"hueFromBlue": @(blue_arm),
      @"structurallyUnreachableArm": @(unreachable_arm)};
  }
};

struct Counts {
  std::uint64_t calls = 0, values = 0, nan_outputs = 0;
  std::uint64_t rotated_arc = 0, corrected_hue = 0, predicate_calls = 0, heap_layout_calls = 0;
  std::array<std::uint64_t, 9> paths{};
  SideCounts previous_side, next_side;
  std::uint64_t corpus_calls = 0;
  std::uint64_t fingerprint = editor_test::kFnvStart;
  std::uint64_t path_fingerprint = editor_test::kFnvStart;
  NSDictionary* json() const {
    NSMutableDictionary* histogram = [NSMutableDictionary dictionary];
    for (std::size_t index = 0; index < paths.size(); ++index) histogram[@(kPathNames[index])] = @(paths[index]);
    return @{@"evaluatorCalls": @(calls), @"doublesCompared": @(values),
      @"nanOutputs": @(nan_outputs), @"paths": histogram, @"rotatedArc": @(rotated_arc),
      @"correctedNegativeHue": @(corrected_hue), @"previousSide": previous_side.json(),
      @"nextSide": next_side.json(), @"predicateCalls": @(predicate_calls),
      @"predicateHeapLayoutCalls": @(heap_layout_calls),
      @"sharedCorpusCalls": @(corpus_calls), @"nativeValueFnv1a": @(fingerprint),
      @"independentPathFnv1a": @(path_fingerprint), @"mismatches": @0};
  }
};

// The fingerprints only accumulate over the shared corpus, because that is the sequence
// the standalone suite replays; the named goldens are pinned one by one instead.
void compare(NativeColor native, Counts& counts, const std::vector<double>& previous,
             const std::vector<double>& next, float progress, bool shared_corpus) {
  const auto actual = native(previous, next, progress);
  const auto expected = evaluate_caption_color(previous, next, progress);
  const std::string context = "call=" + std::to_string(counts.calls) +
      " progress=" + std::to_string(progress);
  require(actual.size() == expected.values.size(), context + " result shape differs");
  for (std::size_t index = 0; index < actual.size(); ++index) {
    const double left = actual[index], right = expected.values[index];
    if (std::isnan(left) || std::isnan(right)) {
      require(std::isnan(left) && std::isnan(right), context + " NaN classification differs");
      ++counts.nan_outputs;
    } else {
      require(std::bit_cast<std::uint64_t>(left) == std::bit_cast<std::uint64_t>(right),
              context + " channel=" + std::to_string(index) +
              " nativeBits=" + std::to_string(std::bit_cast<std::uint64_t>(left)) +
              " independentBits=" + std::to_string(std::bit_cast<std::uint64_t>(right)));
    }
    ++counts.values;
  }
  // The fingerprint hashes the native numbers, so the standalone suite that pins it is
  // pinning what the vendor code produced, not a restatement of the independent code.
  if (shared_corpus) {
    editor_test::hash_caption_values(counts.fingerprint, actual);
    editor_test::hash_integer(counts.path_fingerprint, static_cast<std::uint64_t>(expected.path), 1);
    ++counts.corpus_calls;
  }
  ++counts.calls;
  ++counts.paths[static_cast<std::size_t>(expected.path)];
  if (expected.rotated_arc) ++counts.rotated_arc;
  if (expected.corrected_hue) ++counts.corrected_hue;
  if (previous.size() >= 3 && next.size() >= 3 && !(progress < 0.0f) && !(progress > 1.0f)) {
    counts.previous_side.observe(shape_of(previous));
    counts.next_side.observe(shape_of(next));
  }
}

NSArray* capture_goldens(NativeColor native, Counts& counts) {
  struct Request { const char* label; std::vector<double> previous, next; float progress; };
  const std::vector<Request> requests{
      {"red at zero", {1.0, 0.0, 0.0}, {1.0, 0.0, 0.0}, 0.0f},
      {"red to cyan half", {1.0, 0.0, 0.0}, {0.0, 1.0, 1.0}, 0.5f},
      {"red to magenta half", {1.0, 0.0, 0.0}, {1.0, 0.0, 1.0}, 0.5f},
      {"red to magenta quarter", {1.0, 0.0, 0.0}, {1.0, 0.0, 1.0}, 0.25f},
      {"magenta to red quarter", {1.0, 0.0, 1.0}, {1.0, 0.0, 0.0}, 0.25f},
      {"grey ramp", {0.25, 0.25, 0.25}, {0.75, 0.75, 0.75}, 4.0f / 17.0f},
      {"black to white", {0.0, 0.0, 0.0}, {1.0, 1.0, 1.0}, 1.0f / 3.0f},
      {"negative zero side", {-0.0, -0.0, -0.0}, {0.5, 0.25, 0.125}, 0.5f},
      {"nan progress", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, std::numeric_limits<float>::quiet_NaN()},
      {"negative zero progress", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, -0.0f},
      {"just over one", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, 1.0000001f},
      {"infinite channel", {std::numeric_limits<double>::infinity(), 0.0, 0.0},
       {0.0, 0.0, -std::numeric_limits<double>::infinity()}, 0.5f},
      {"saturated wrap", {1e300, -0.005, -1e300}, {1e300, -0.005, -1e300}, 0.5f},
      {"nan channel", {std::numeric_limits<double>::quiet_NaN(), 0.5, 0.25}, {0.5, 0.25, 0.125}, 0.5f},
      {"subnormal channel", {5e-324, 1.0, 0.5}, {1.0, 5e-324, 0.5}, 0.9999999f},
      {"short previous", {0.5, 0.5}, {0.25, 0.25, 0.25}, 0.5f},
      {"long inputs", {0.2, 0.4, 0.6, 0.8, 1.0}, {0.9, 0.7, 0.5, 0.3, 0.1}, 0.25f}};
  NSMutableArray* goldens = [NSMutableArray array];
  for (const auto& request : requests) {
    compare(native, counts, request.previous, request.next, request.progress, false);
    const auto actual = native(request.previous, request.next, request.progress);
    NSMutableArray* bits = [NSMutableArray array];
    for (const double value : actual) {
      [bits addObject:[NSString stringWithFormat:@"0x%016llx",
          static_cast<unsigned long long>(std::bit_cast<std::uint64_t>(value))]];
    }
    const auto expected = evaluate_caption_color(request.previous, request.next, request.progress);
    [goldens addObject:@{@"label": @(request.label),
        @"progressBits": [NSString stringWithFormat:@"0x%08x",
            static_cast<unsigned>(std::bit_cast<std::uint32_t>(request.progress))],
        @"path": @(kPathNames[static_cast<std::size_t>(expected.path)]), @"bits": bits}];
  }
  return goldens;
}

NSArray* compare_predicate(NativeType native, Counts& counts) {
  NSMutableArray* rows = [NSMutableArray array];
  for (const auto& sample : editor_test::caption_type_corpus()) {
    const bool actual = native(sample.type);
    const bool expected = is_caption_type(sample.type);
    require(actual == expected, "Caption type predicate differs for a corpus entry");
    ++counts.predicate_calls;
    if (sample.heap) {
      require(sample.type.capacity() > 22, "The heap layout case stayed inline");
      ++counts.heap_layout_calls;
    }
    if (!sample.heap) {
      NSMutableString* escaped = [NSMutableString string];
      for (const char letter : sample.type) [escaped appendFormat:@"%02x", static_cast<unsigned char>(letter)];
      [rows addObject:@{@"utf8Hex": escaped, @"length": @(sample.type.size()), @"accepted": @(actual)}];
    }
  }
  return rows;
}

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool { try {
    require(argc == 3, "Usage: editor-caption_color-probe /absolute/libvideoeditor.dylib /absolute/libcccreator.dylib");
    NSDictionary* result;
    {
      NativeOutputScope quiet;
      const auto editor = load_verified(argv[1]), creator = load_verified(argv[2], kCreatorIdentity);
      const auto* evaluator_words = reinterpret_cast<const std::uint32_t*>(editor.base + kColorEvaluator);
      for (std::size_t index = 0; index < kEvaluatorWords.size(); ++index) {
        require(evaluator_words[index] == kEvaluatorWords[index],
                "Unknown instruction word at the unexported color evaluator");
      }
      const auto* predicate_words = reinterpret_cast<const std::uint32_t*>(editor.base + kTypePredicate);
      for (std::size_t index = 0; index < kPredicateWords.size(); ++index) {
        require(predicate_words[index] == kPredicateWords[index],
                "Unknown instruction word at the caption type predicate");
      }
      const auto native = entry<NativeColor>(editor, kColorEvaluator);
      const auto predicate = entry<NativeType>(editor, kTypePredicate);
      Counts counts;
      NSArray* types = compare_predicate(predicate, counts);
      NSArray* goldens = capture_goldens(native, counts);
      editor_test::visit_caption_corpus([&](const std::vector<double>& previous,
                                            const std::vector<double>& next, float progress) {
        compare(native, counts, previous, next, progress, true);
      });
      result = @{@"passed": @YES, @"videoeditorSha256": editor.sha256, @"cccreatorSha256": creator.sha256,
        @"evaluatorOffset": @"0x33f1e9c", @"predicateSymbol": @"lyra::CaptionAnimUtils::isCaptionType",
        @"comparison": counts.json(), @"goldens": goldens, @"acceptedTypes": types,
        @"progressNarrowingVerified": @NO,
        @"scope": @"The unexported color evaluator and the exported type predicate only. The enclosing "
                  @"Caption branch, its SegmentText gate and the four key comparisons are not driven here, "
                  @"and the int64-to-binary32 progress at 0x33f4c9c is transcribed, not differentiated."};
    }
    NSData* data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    require(data != nil, "Cannot serialize caption color evidence");
    std::cout.write(static_cast<const char*>(data.bytes), static_cast<std::streamsize>(data.length));
    std::cout << '\n';
  } catch (const std::exception& error) { std::cerr << "FAIL: " << error.what() << '\n'; return 1; } }
}
