#include "caption_color.hpp"

#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

// Two different literals are loaded, so they are written as two constants. The input
// scale is a binary64 255; the output scale is a binary32 255 and is also the divisor of
// the value axis. Folding them into one constant would silently change the arithmetic.
constexpr double kInputScale = 255.0;
constexpr float kOutputScale = 255.0f;

constexpr float kSectorTurn = 60.0f;
constexpr float kGreenTurn = 120.0f;
constexpr float kBlueTurn = 240.0f;
constexpr float kHalfTurn = 180.0f;
constexpr float kFullTurn = 360.0f;
// A separate negative literal: the rotation adds -360 instead of subtracting 360, and
// the red hue arm adds a real +0, which is not a no-op for a negative zero result.
constexpr float kBackTurn = -360.0f;
constexpr float kNoTurn = 0.0f;
constexpr float kSectorCount = 6.0f;
constexpr std::int32_t kLastSector = 5;

// The three fallbacks all store this literal quadruple, and the out-of-sector exit
// reaches the same numbers through the quantizer. They are indistinguishable in the
// return value; only the path field separates them.
std::vector<double> opaque_black() { return {0.0, 0.0, 0.0, 1.0}; }

// The 32-bit differences are plain SUBs and wrap. Saturated channels really do reach
// both int32 bounds, so the wrap is reachable and must not be softened into saturation.
std::int32_t wrapped_channel_difference(std::int32_t end, std::int32_t start) noexcept {
  return static_cast<std::int32_t>(static_cast<std::uint32_t>(end) -
                                   static_cast<std::uint32_t>(start));
}

// Scale, narrow, widen, rescale. The round trip is what makes every output a multiple of
// 1/255; dropping it is the single largest observable difference from a plain blend.
double quantize_channel(float channel) noexcept {
  const float scaled = channel * kOutputScale;
  return static_cast<double>(static_cast<float>(saturating_trunc_to_int32(scaled)) / kOutputScale);
}

struct ChannelTriple { float first = 0.0f, second = 0.0f, third = 0.0f; };

}  // namespace

std::int32_t saturating_trunc_to_int32(double value) noexcept {
  if (std::isnan(value)) return 0;
  const double truncated = std::trunc(value);
  // Both int32 bounds are exact in binary64, so the comparisons are exact as well.
  if (truncated > 2147483647.0) return INT32_MAX;
  if (truncated < -2147483648.0) return INT32_MIN;
  return static_cast<std::int32_t>(truncated);
}

std::int32_t saturating_trunc_to_int32(float value) noexcept {
  if (std::isnan(value)) return 0;
  const float truncated = std::trunc(value);
  // Int32 max has no binary32 representation; the first float at or above the range is
  // 2^31, and the largest float below it is 2147483520. Comparing against 2147483647.0f
  // would compare against 2^31 after conversion and let 2^31 itself through as UB.
  if (truncated >= 2147483648.0f) return INT32_MAX;
  if (truncated < -2147483648.0f) return INT32_MIN;
  return static_cast<std::int32_t>(truncated);
}

CaptionColorPolar caption_color_to_polar(std::span<const double> channels) {
  if (channels.size() < 3) throw std::invalid_argument("Caption color conversion needs three channels");
  const std::int32_t red = saturating_trunc_to_int32(channels[0] * kInputScale);
  const std::int32_t green = saturating_trunc_to_int32(channels[1] * kInputScale);
  const std::int32_t blue = saturating_trunc_to_int32(channels[2] * kInputScale);
  // One SUBS produces both the ordering flags and this difference, and the difference is
  // kept in a register for the third hue arm instead of being recomputed there. The
  // comparisons below use the signed condition codes, which stay correct across overflow;
  // the retained difference is the wrapped one. Those are two separate facts.
  const std::int32_t red_over_green = wrapped_channel_difference(red, green);
  const std::int32_t upper = red < green ? green : red;
  const std::int32_t lower = red > green ? green : red;
  const std::int32_t peak = upper < blue ? blue : upper;
  const std::int32_t base = lower > blue ? blue : lower;
  const std::int32_t spread = wrapped_channel_difference(peak, base);

  CaptionColorPolar polar;
  polar.peak = static_cast<float>(peak);
  // The left operand skips the division when the peak is zero while the right one divides
  // first and selects afterwards, so the right side really evaluates 0/0. Only the
  // selected value is observable and the two forms select the same value.
  if (peak != 0) polar.saturation = static_cast<float>(spread) / polar.peak;
  if (spread == 0) return polar;

  if (peak == red) {
    polar.hue = static_cast<float>(wrapped_channel_difference(green, blue)) * kSectorTurn;
    polar.hue = polar.hue / static_cast<float>(wrapped_channel_difference(red, base));
    // The turn is chosen by a signed comparison of the two channels, not by the sign of
    // their wrapped difference; those disagree once the subtraction overflows. Adding a
    // zero turn is a real instruction: it is what turns a negative zero into a positive one.
    polar.hue = polar.hue + (green >= blue ? kNoTurn : kFullTurn);
    return polar;
  }
  if (peak == green) {
    polar.hue = static_cast<float>(wrapped_channel_difference(blue, red)) * kSectorTurn;
    polar.hue = polar.hue / static_cast<float>(wrapped_channel_difference(green, base));
    polar.hue = polar.hue + kGreenTurn;
    return polar;
  }
  // Reaching here already implies upper < blue, so this guard is never false. It is kept
  // because it is a real instruction and dropping it would assert a proof the binary does
  // not contain; the diagnostic counts how often the else side runs and reports zero.
  if (upper <= blue) {
    polar.hue = static_cast<float>(red_over_green) * kSectorTurn;
    polar.hue = polar.hue / static_cast<float>(spread);
    polar.hue = polar.hue + kBlueTurn;
  }
  return polar;
}

CaptionColorResult evaluate_caption_color(std::span<const double> previous,
                                          std::span<const double> next, float progress) {
  CaptionColorResult result;
  result.values = opaque_black();
  // Both shape tests divide a byte length by eight and compare against three. A longer
  // vector is accepted and only its first three doubles are ever read.
  if (previous.size() < 3 || next.size() < 3) {
    result.path = CaptionColorPath::ShapeFallback;
    return result;
  }
  // The range gate is a compare followed by a conditional compare, and its condition is
  // false for an unordered operand, so a NaN progress passes the gate and continues into
  // the arithmetic. Writing !(progress >= 0.0f && progress <= 1.0f) would close it; that
  // variant is not observable in the return value and is pinned by a standalone test.
  if (progress < 0.0f || progress > 1.0f) {
    result.path = CaptionColorPath::RangeFallback;
    return result;
  }
  result.previous = caption_color_to_polar(previous);
  result.next = caption_color_to_polar(next);

  const float left = result.previous.hue;
  const float right = result.next.hue;
  const float separation = std::fabs(left - right);
  // The rotation picks its side on a plus condition, which also holds for an unordered
  // compare, and the short-arc test uses a less-or-equal condition, which likewise holds
  // when unordered. So two NaN hues keep both endpoints untouched.
  const bool left_leads = !(left < right);
  const bool short_arc = !(separation > kHalfTurn);
  result.rotated_arc = !short_arc;
  const float start = (short_arc || !left_leads) ? left : left + kBackTurn;
  const float end = (short_arc || left_leads) ? right : right + kBackTurn;

  // Difference, scale, sum: three separate instructions and no fused multiply-add. The
  // fused form differs by one ULP on real inputs and the diagnostic detects it.
  float hue = start + (end - start) * progress;
  if (hue < 0.0f) {
    result.corrected_hue = true;
    hue = hue + kFullTurn;
  }
  result.hue = hue;
  // A single correction is not a normalization: a hue far below zero stays negative here.
  const float sixths = hue / kSectorTurn;
  const float folded = std::fmod(sixths, kSectorCount);
  const std::int32_t sector = saturating_trunc_to_int32(folded);
  // The table test is unsigned, so a negative sector leaves the table as well.
  if (static_cast<std::uint32_t>(sector) > static_cast<std::uint32_t>(kLastSector)) {
    result.path = CaptionColorPath::SectorFallback;
    return result;
  }

  const float value_previous = result.previous.peak / kOutputScale;
  const float value_next = result.next.peak / kOutputScale;
  const float saturation = result.previous.saturation +
      (result.next.saturation - result.previous.saturation) * progress;
  const float value = value_previous + (value_next - value_previous) * progress;
  // The fraction is taken from the unfolded sixths minus the truncated fold, not from the
  // fold itself. Both agree while the hue stays under one turn and diverge afterwards.
  const float fraction = sixths - static_cast<float>(sector);
  const float dark = value * (1.0f - saturation);
  const float waning = value * (1.0f - saturation * fraction);
  const float waxing = value * (1.0f - saturation * (1.0f - fraction));

  ChannelTriple channels;
  switch (sector) {
    case 0: channels = {value, waxing, dark}; break;
    case 1: channels = {waning, value, dark}; break;
    case 2: channels = {dark, value, waxing}; break;
    case 3: channels = {dark, waning, value}; break;
    case 4: channels = {waxing, dark, value}; break;
    default: channels = {value, dark, waning}; break;
  }
  result.path = static_cast<CaptionColorPath>(
      static_cast<int>(CaptionColorPath::Sector0) + sector);
  result.values = {quantize_channel(channels.first), quantize_channel(channels.second),
                   quantize_channel(channels.third), 1.0};
  return result;
}

std::vector<double> evaluate_caption_color_values(std::span<const double> previous,
                                                  std::span<const double> next, float progress) {
  return evaluate_caption_color(previous, next, progress).values;
}

bool is_caption_type(std::string_view type) noexcept {
  // Six length-then-compare pairs, in source order. The compare is length aware, so an
  // embedded null never truncates the test and a longer string never matches a prefix.
  return type == "page" || type == "word" || type == "word_unread" || type == "line" ||
         type == "line_unread" || type == "keyword";
}

float caption_color_progress(std::int64_t numerator, std::int64_t denominator) noexcept {
  // Two signed conversions to binary64, one binary64 division, one narrowing to binary32.
  // Converting the operands to float first would lose the numerator before the division.
  return static_cast<float>(static_cast<double>(numerator) / static_cast<double>(denominator));
}

}  // namespace editor_contract
