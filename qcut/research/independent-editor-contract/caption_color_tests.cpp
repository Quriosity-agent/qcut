#include "caption_color_fixtures.hpp"

#include <algorithm>
#include <iostream>

namespace {
using namespace editor_contract;
using editor_test::require;

// Captured from the real evaluator at libvideoeditor 0x33f1e9c. The suite pins them so
// the contract holds without the vendor library on the machine.
constexpr std::uint64_t kNativeValueFingerprint = 9426952596422373182ULL;
constexpr std::uint64_t kIndependentPathFingerprint = 1057191529647246839ULL;
constexpr std::uint64_t kNativeCorpusCalls = 473901;

struct Golden { const char* label; std::vector<double> previous, next; float progress;
                CaptionColorPath path; std::vector<std::uint64_t> bits; };

const std::vector<Golden>& native_goldens() {
  static const std::vector<Golden> goldens{
      {"red at zero", {1.0, 0.0, 0.0}, {1.0, 0.0, 0.0}, 0.0f,
       CaptionColorPath::Sector0, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"red to cyan half", {1.0, 0.0, 0.0}, {0.0, 1.0, 1.0}, 0.5f,
       CaptionColorPath::Sector1, {0x3fdfdfdfe0000000ULL, 0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"red to magenta half", {1.0, 0.0, 0.0}, {1.0, 0.0, 1.0}, 0.5f,
       CaptionColorPath::Sector5, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3fdfdfdfe0000000ULL, 0x3ff0000000000000ULL}},
      {"red to magenta quarter", {1.0, 0.0, 0.0}, {1.0, 0.0, 1.0}, 0.25f,
       CaptionColorPath::Sector5, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3fcf9f9fa0000000ULL, 0x3ff0000000000000ULL}},
      {"magenta to red quarter", {1.0, 0.0, 1.0}, {1.0, 0.0, 0.0}, 0.25f,
       CaptionColorPath::Sector5, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3fe7f7f800000000ULL, 0x3ff0000000000000ULL}},
      {"grey ramp", {0.25, 0.25, 0.25}, {0.75, 0.75, 0.75}, 4.0f / 17.0f,
       CaptionColorPath::Sector0, {0x3fd7575760000000ULL, 0x3fd7575760000000ULL, 0x3fd7575760000000ULL, 0x3ff0000000000000ULL}},
      {"black to white", {0.0, 0.0, 0.0}, {1.0, 1.0, 1.0}, 1.0f / 3.0f,
       CaptionColorPath::Sector0, {0x3fd5555560000000ULL, 0x3fd5555560000000ULL, 0x3fd5555560000000ULL, 0x3ff0000000000000ULL}},
      {"negative zero side", {-0.0, -0.0, -0.0}, {0.5, 0.25, 0.125}, 0.5f,
       CaptionColorPath::Sector0, {0x3fcf9f9fa0000000ULL, 0x3fc59595a0000000ULL, 0x3fc39393a0000000ULL, 0x3ff0000000000000ULL}},
      {"nan progress", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, std::numeric_limits<float>::quiet_NaN(),
       CaptionColorPath::Sector0, {0x0000000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"negative zero progress", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, -0.0f,
       CaptionColorPath::Sector0, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"just over one", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.5}, 1.0000001f,
       CaptionColorPath::RangeFallback, {0x0000000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"infinite channel", {std::numeric_limits<double>::infinity(), 0.0, 0.0}, {0.0, 0.0, -std::numeric_limits<double>::infinity()}, 0.5f,
       CaptionColorPath::Sector0, {0x4150101020000000ULL, 0x4148181840000000ULL, 0x4140101020000000ULL, 0x3ff0000000000000ULL}},
      {"saturated wrap", {1e300, -0.005, -1e300}, {1e300, -0.005, -1e300}, 0.5f,
       CaptionColorPath::SectorFallback, {0x0000000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"nan channel", {std::numeric_limits<double>::quiet_NaN(), 0.5, 0.25}, {0.5, 0.25, 0.125}, 0.5f,
       CaptionColorPath::Sector1, {0x3fd4141420000000ULL, 0x3fdfdfdfe0000000ULL, 0x3fae1e1e20000000ULL, 0x3ff0000000000000ULL}},
      {"subnormal channel", {5e-324, 1.0, 0.5}, {1.0, 5e-324, 0.5}, 0.9999999f,
       CaptionColorPath::Sector5, {0x3ff0000000000000ULL, 0x0000000000000000ULL, 0x3fdf9f9fa0000000ULL, 0x3ff0000000000000ULL}},
      {"short previous", {0.5, 0.5}, {0.25, 0.25, 0.25}, 0.5f,
       CaptionColorPath::ShapeFallback, {0x0000000000000000ULL, 0x0000000000000000ULL, 0x0000000000000000ULL, 0x3ff0000000000000ULL}},
      {"long inputs", {0.2, 0.4, 0.6, 0.8, 1.0}, {0.9, 0.7, 0.5, 0.3, 0.1}, 0.25f,
       CaptionColorPath::Sector2, {0x3fd09090a0000000ULL, 0x3fe59595a0000000ULL, 0x3fe2323240000000ULL, 0x3ff0000000000000ULL}}};
  return goldens;
}

std::uint32_t float_bits(float value) { return std::bit_cast<std::uint32_t>(value); }
std::uint64_t double_bits(double value) { return std::bit_cast<std::uint64_t>(value); }

void narrowing_semantics() {
  require(saturating_trunc_to_int32(0.0) == 0 && saturating_trunc_to_int32(-0.0) == 0,
          "Both zeros narrow to zero");
  require(saturating_trunc_to_int32(std::numeric_limits<double>::quiet_NaN()) == 0,
          "A NaN channel narrows to zero rather than trapping");
  require(saturating_trunc_to_int32(std::numeric_limits<double>::infinity()) == INT32_MAX &&
          saturating_trunc_to_int32(-std::numeric_limits<double>::infinity()) == INT32_MIN,
          "Infinite channels saturate at both ends");
  require(saturating_trunc_to_int32(-0.9) == 0 && saturating_trunc_to_int32(-1.9) == -1,
          "Narrowing rounds toward zero, not downward");
  require(saturating_trunc_to_int32(2147483647.9) == 2147483647 &&
          saturating_trunc_to_int32(2147483648.0) == INT32_MAX &&
          saturating_trunc_to_int32(-2147483648.0) == INT32_MIN &&
          saturating_trunc_to_int32(-2147483649.0) == INT32_MIN,
          "The binary64 overload saturates exactly at the int32 bounds");
  // The positive bound differs between the overloads because int32 max has no binary32
  // form: the literal 2147483647.0f is 2^31 already, which is why the float overload
  // compares against 2^31 and not against the integer bound.
  require(float_bits(2147483647.0f) == float_bits(2147483648.0f),
          "The int32 maximum is not a binary32 value");
  require(saturating_trunc_to_int32(2147483647.0f) == INT32_MAX &&
          saturating_trunc_to_int32(2147483520.0f) == 2147483520,
          "The binary32 overload saturates at the first float in range");
  require(saturating_trunc_to_int32(-2147483648.0f) == INT32_MIN &&
          saturating_trunc_to_int32(-2147483904.0f) == INT32_MIN,
          "The negative binary32 bound is exact and saturates below it");
  require(saturating_trunc_to_int32(std::numeric_limits<float>::quiet_NaN()) == 0 &&
          saturating_trunc_to_int32(-5.75f) == -5,
          "The binary32 overload shares the NaN and toward-zero rules");
}

void polar_arms() {
  const auto red = caption_color_to_polar(std::vector<double>{1.0, 0.0, 0.0});
  require(red.hue == 0.0f && red.saturation == 1.0f && red.peak == 255.0f,
          "A saturated red resolves on the red arm at zero turn");
  const auto green = caption_color_to_polar(std::vector<double>{0.0, 1.0, 0.0});
  require(green.hue == 120.0f && green.saturation == 1.0f, "The green arm adds a third of a turn");
  const auto blue = caption_color_to_polar(std::vector<double>{0.0, 0.0, 1.0});
  require(blue.hue == 240.0f && blue.saturation == 1.0f, "The blue arm adds two thirds of a turn");
  const auto magenta = caption_color_to_polar(std::vector<double>{1.0, 0.0, 1.0});
  require(magenta.hue == 300.0f, "A red peak below its blue channel wraps through the full turn");
  const auto grey = caption_color_to_polar(std::vector<double>{0.5, 0.5, 0.5});
  require(grey.hue == 0.0f && grey.saturation == 0.0f && grey.peak == 127.0f,
          "An equal triple has no spread, so neither hue nor saturation is computed");
  const auto black = caption_color_to_polar(std::vector<double>{0.0, 0.0, 0.0});
  require(black.peak == 0.0f && black.saturation == 0.0f,
          "A zero peak selects zero saturation instead of the division result");
  const auto negative = caption_color_to_polar(std::vector<double>{-0.5, -0.5, -0.5});
  require(negative.peak == -127.0f && negative.saturation == 0.0f,
          "Negative channels keep their sign through the narrowing");
  // Adding a zero turn is a real instruction. Here the quotient is a negative zero and the
  // addition is the only thing that turns it into a positive zero.
  require(float_bits(0.0f / -1.0f) == 0x80000000U, "The quotient alone would be a negative zero");
  const auto zero_turn = caption_color_to_polar(std::vector<double>{1e300, -1e300, -1e300});
  require(float_bits(zero_turn.hue) == 0U,
          "The zero turn is added, so a negative zero quotient leaves as a positive zero");
}

void wrapped_channels() {
  // Both saturated bounds are reachable, and their difference wraps to minus one, which is
  // what pushes the hue far outside a turn.
  const std::vector<double> wrapped{1e300, -0.005, -1e300};
  const auto polar = caption_color_to_polar(wrapped);
  require(polar.hue == -128849018880.0f,
          "A wrapped spread divides by minus one instead of saturating");
  require(polar.saturation == -1.0f / 2147483648.0f,
          "The wrapped spread also reaches the saturation quotient");
  const auto result = evaluate_caption_color(wrapped, wrapped, 0.5f);
  require(result.path == CaptionColorPath::SectorFallback && result.corrected_hue,
          "A hue that stays negative after one correction leaves the sector table");
  require(result.values == std::vector<double>{0.0, 0.0, 0.0, 1.0},
          "The out-of-table exit produces the same four numbers as the guards");
}

void shape_and_range_gates() {
  const std::vector<double> triple{0.5, 0.25, 0.125};
  for (std::size_t left = 0; left <= 4; ++left) {
    for (std::size_t right = 0; right <= 4; ++right) {
      const std::vector<double> a(left, 0.5), b(right, 0.25);
      const auto result = evaluate_caption_color(a, b, 0.5f);
      const bool wide = left >= 3 && right >= 3;
      require((result.path == CaptionColorPath::ShapeFallback) == !wide,
              "Only shapes of three or more on both sides pass the length test");
    }
  }
  const std::vector<double> five{0.2, 0.4, 0.6, 0.8, 1.0};
  require(evaluate_caption_color_values(five, triple, 0.5f) ==
          evaluate_caption_color_values(std::vector<double>{0.2, 0.4, 0.6}, triple, 0.5f),
          "Only the first three doubles of a longer input are read");
  for (const float outside : {-1e-7f, -1.0f, 1.0000001f, 2.0f,
                              std::numeric_limits<float>::infinity(),
                              -std::numeric_limits<float>::infinity()}) {
    require(evaluate_caption_color(triple, triple, outside).path == CaptionColorPath::RangeFallback,
            "A progress outside the closed unit interval falls back");
  }
  require(evaluate_caption_color(triple, triple, -0.0f).path != CaptionColorPath::RangeFallback,
          "A negative zero progress is not below zero and stays on the arithmetic path");
  require(evaluate_caption_color(triple, triple, 0.0f).values ==
          evaluate_caption_color(triple, triple, -0.0f).values,
          "Both zero progresses produce the same values");
  // The range gate is left open for an unordered progress on purpose. The arithmetic then
  // produces NaN everywhere and the integer quantizer flattens it back to the fallback
  // numbers, so no native comparison can see the difference. Only this assertion can.
  const auto unordered = evaluate_caption_color(std::vector<double>{1.0, 0.0, 0.0},
      std::vector<double>{0.0, 1.0, 0.5}, std::numeric_limits<float>::quiet_NaN());
  require(unordered.path == CaptionColorPath::Sector0,
          "A NaN progress passes the range gate and lands in the first sector");
  require(unordered.values == evaluate_caption_color(triple, triple, 2.0f).values,
          "The NaN path is bit-identical to the guard result, which is why it is unobservable");
}

void arc_and_sectors() {
  const std::vector<double> red{1.0, 0.0, 0.0}, cyan{0.0, 1.0, 1.0}, magenta{1.0, 0.0, 1.0};
  const auto half_turn = evaluate_caption_color(red, cyan, 0.5f);
  require(!half_turn.rotated_arc && half_turn.hue == 90.0f,
          "A separation of exactly half a turn stays on the short arc");
  const auto forward = evaluate_caption_color(red, magenta, 0.25f);
  require(forward.rotated_arc && forward.corrected_hue && forward.hue == 345.0f,
          "A separation over half a turn rotates the trailing side backward");
  const auto backward = evaluate_caption_color(magenta, red, 0.25f);
  require(backward.rotated_arc && backward.corrected_hue && backward.hue == 315.0f,
          "The rotation applies to the leading side when the order is reversed");
  const std::vector<std::pair<std::vector<double>, CaptionColorPath>> wheel{
      {{1.0, 0.0, 0.0}, CaptionColorPath::Sector0}, {{1.0, 1.0, 0.0}, CaptionColorPath::Sector1},
      {{0.0, 1.0, 0.0}, CaptionColorPath::Sector2}, {{0.0, 1.0, 1.0}, CaptionColorPath::Sector3},
      {{0.0, 0.0, 1.0}, CaptionColorPath::Sector4}, {{1.0, 0.0, 1.0}, CaptionColorPath::Sector5}};
  for (const auto& [color, path] : wheel) {
    const auto result = evaluate_caption_color(color, std::vector<double>{0.3, 0.6, 0.9}, 0.0f);
    require(result.path == path, "Each primary and secondary selects its own sector");
    require(result.values == std::vector<double>{color[0], color[1], color[2], 1.0},
            "A zero progress reproduces the left color exactly through the sector table");
  }
}

void unfused_blend() {
  // The blend is a subtraction, a multiplication and an addition, in that order. This only
  // records that the fused form really differs somewhere inside the pinned corpus, so the
  // fingerprint that guards it is not vacuous.
  std::size_t differing = 0;
  for (int i = 0; i <= 16; i += 2) {
    for (int j = 0; j <= 16; j += 2) {
      for (int k = 0; k <= 16; k += 2) {
        const auto left = caption_color_to_polar(std::vector<double>{i / 16.0, j / 16.0, k / 16.0});
        const auto right = caption_color_to_polar(
            std::vector<double>{(16 - i) / 16.0, (16 - k) / 16.0, j / 16.0});
        for (const float progress : editor_test::kCaptionSweepProgress) {
          const float plain = left.hue + (right.hue - left.hue) * progress;
          const float fused = std::fma(right.hue - left.hue, progress, left.hue);
          if (float_bits(plain) != float_bits(fused)) ++differing;
        }
      }
    }
  }
  require(differing > 0, "The fused blend differs from the recovered one inside the corpus");
}

void caption_types() {
  const std::vector<std::string> accepted{"page", "word", "word_unread", "line", "line_unread", "keyword"};
  for (const auto& sample : editor_test::caption_type_corpus()) {
    const bool expected = std::find(accepted.begin(), accepted.end(), sample.type) != accepted.end();
    require(is_caption_type(sample.type) == expected,
            "The caption type gate accepts exactly the six recovered names");
  }
  require(!is_caption_type(std::string_view("page\0", 5)),
          "The compare is length aware, so an embedded null does not truncate the name");
  require(!is_caption_type("pages") && !is_caption_type("pag") && !is_caption_type("Page"),
          "Longer, shorter and recased neighbors are all refused");
  require(is_caption_type(std::string(40, 'x').substr(0, 0) + "keyword"),
          "A heap-allocated string with a matching name is still accepted");
}

void progress_narrowing() {
  require(caption_color_progress(1, 2) == 0.5f && caption_color_progress(-1, 2) == -0.5f,
          "The transcribed progress divides the two signed counts");
  require(std::isnan(caption_color_progress(0, 0)), "A zero over zero span is unordered");
  require(caption_color_progress(1, 0) == std::numeric_limits<float>::infinity() &&
          caption_color_progress(-1, 0) == -std::numeric_limits<float>::infinity(),
          "A zero span keeps the sign of the numerator");
  require(float_bits(caption_color_progress(0, -1)) == 0x80000000U,
          "A zero numerator over a negative span narrows to a negative zero");
  // Narrowed once, at the end: a quotient with more than twenty-four significant bits
  // loses them here, while the linear property path stays in binary64 throughout.
  require(caption_color_progress(1, 3) == 0.33333334f &&
          static_cast<double>(caption_color_progress(1, 3)) != 1.0 / 3.0,
          "The quotient is narrowed to binary32 on the way out");
  // Both counts convert to binary64 first. Narrowing them before the division answers a
  // different float for this pair, so the order of the four instructions is observable.
  require(float_bits(caption_color_progress(69769528, 104144162)) == 0x3f2b80adU,
          "The division happens in binary64 before the single narrowing");
  require(float_bits(69769528.0f / 104144162.0f) == 0x3f2b80aeU,
          "Dividing after two binary32 conversions answers the neighboring float");
  require(caption_color_progress(INT64_MIN, 1) == -9223372036854775808.0f,
          "The extreme count converts through binary64 without wrapping");
}

void corpus_invariants() {
  std::uint64_t values = editor_test::kFnvStart;
  std::uint64_t paths = editor_test::kFnvStart;
  std::uint64_t calls = 0, opaque = 0;
  editor_test::visit_caption_corpus([&](const std::vector<double>& previous,
                                        const std::vector<double>& next, float progress) {
    const auto result = evaluate_caption_color(previous, next, progress);
    require(result.values.size() == 4, "Every exit returns four doubles");
    if (double_bits(result.values[3]) == double_bits(1.0)) ++opaque;
    for (const double channel : result.values) require(!std::isnan(channel), "No exit returns a NaN");
    editor_test::hash_caption_values(values, result.values);
    editor_test::hash_integer(paths, static_cast<std::uint64_t>(result.path), 1);
    ++calls;
  });
  require(calls == kNativeCorpusCalls, "The corpus size drifted from the compared one");
  require(opaque == calls, "The fourth double is a literal one on every exit");
  require(values == kNativeValueFingerprint,
          "The corpus no longer reproduces the recorded native values");
  require(paths == kIndependentPathFingerprint, "The recorded branch attribution drifted");
}

void pinned_goldens() {
  for (const auto& golden : native_goldens()) {
    const auto result = evaluate_caption_color(golden.previous, golden.next, golden.progress);
    require(result.path == golden.path, std::string(golden.label) + " selected another path");
    require(result.values.size() == golden.bits.size(), std::string(golden.label) + " changed shape");
    for (std::size_t index = 0; index < golden.bits.size(); ++index) {
      require(double_bits(result.values[index]) == golden.bits[index],
              std::string(golden.label) + " differs from the captured native bits");
    }
  }
}

void rejected_inputs() {
  bool refused = false;
  try {
    const std::vector<double> pair{0.5, 0.25};
    (void)caption_color_to_polar(pair);
  } catch (const std::invalid_argument&) { refused = true; }
  require(refused, "The polar conversion refuses a shape the caller has not tested");
}

}  // namespace

int main() {
  try {
    narrowing_semantics(); polar_arms(); wrapped_channels(); shape_and_range_gates();
    arc_and_sectors(); unfused_blend(); caption_types(); progress_narrowing();
    corpus_invariants(); pinned_goldens(); rejected_inputs();
    std::cout << "11 caption color groups passed\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
