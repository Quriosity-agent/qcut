#pragma once

#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace editor_contract {

// One side of the evaluator's polar form, derived before the two sides are blended.
// `peak` is the largest 255-scaled channel and is still unnormalized: the value axis
// divides it by 255 only after the blend, so the raw integer must survive that far.
struct CaptionColorPolar {
  float hue = 0.0f;
  float saturation = 0.0f;
  float peak = 0.0f;
};

// Which exit produced the values. The three fallbacks are distinguishable here but not
// in the returned numbers: all three yield the same four doubles, bit for bit.
enum class CaptionColorPath {
  ShapeFallback, RangeFallback, SectorFallback,
  Sector0, Sector1, Sector2, Sector3, Sector4, Sector5
};

struct CaptionColorResult {
  CaptionColorPath path = CaptionColorPath::ShapeFallback;
  CaptionColorPolar previous, next;
  // The hue actually handed to the sector table: after the shortest-arc rotation, the
  // blend and the negative correction.
  float hue = 0.0f;
  bool rotated_arc = false;     // the |difference| > 180 rotation ran
  bool corrected_hue = false;   // the blended hue was negative and one turn was added
  std::vector<double> values;   // always four doubles
};

// Blends two Caption color keyframes through a polar form. Each side needs at least
// three doubles; anything shorter, and a progress outside [0, 1], returns the opaque
// black fallback. A NaN progress is deliberately not out of range.
CaptionColorResult evaluate_caption_color(std::span<const double> previous,
                                          std::span<const double> next, float progress);
std::vector<double> evaluate_caption_color_values(std::span<const double> previous,
                                                  std::span<const double> next, float progress);

// Reads the first three doubles. Fewer than three is this API's own domain limit, not a
// recovered rejection: the caller of the observed code tests the shape before converting.
CaptionColorPolar caption_color_to_polar(std::span<const double> channels);

// ARM FCVTZS: round toward zero, then saturate into int32, with NaN becoming zero. The
// two overloads differ at the positive bound because int32 max is not a binary32 value.
std::int32_t saturating_trunc_to_int32(double value) noexcept;
std::int32_t saturating_trunc_to_int32(float value) noexcept;

// The Caption animation type gate: six exact names, length checked before the compare.
bool is_caption_type(std::string_view type) noexcept;

// The progress the color path hands to the evaluator. TRANSCRIBED FROM FOUR
// INSTRUCTIONS, NOT DIFFERENTIALLY VERIFIED: no native call in this work reached them,
// because driving the enclosing branch needs a real SegmentText. See the record.
float caption_color_progress(std::int64_t numerator, std::int64_t denominator) noexcept;

}  // namespace editor_contract
