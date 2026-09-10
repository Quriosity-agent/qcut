#pragma once

#include "m4_texture.hpp"

#include <cstdint>
#include <span>
#include <vector>

namespace agfx_contract {

// The fragment stage of the recovered separable Gaussian passes. Two real draws
// use it: a horizontal pass and a vertical pass, both reading an RGBA8 texture
// through a bilinear clamp-to-edge sampler and writing an RGBA8 target.
//
// Everything here is arithmetic *order*, not arithmetic *identity*: the same
// expression written in a different association produces different binary32
// results, so each helper pins the association the recovered pass uses and
// nothing may be simplified into a "cleaner" equivalent.

enum class PassAxis { horizontal, vertical };

// Border handling for a tap that leaves the [0,1] coordinate range.
//   drop        - the tap contributes neither a sample nor weight. The three
//                 recovered comparisons are against 1, 2 and 3, so every other
//                 value (0 included) falls through all of them. This is the
//                 only mode with native pixel evidence.
//   clamp       - the coordinate is pinned to the range edge and both the
//                 sample and its weight are accumulated.
//   weight_only - the weight is accumulated but no sample is read, which pulls
//                 the normalized result toward zero near the border.
//   reflect     - the coordinate is reflected once about the crossed edge and
//                 then handed to the sampler, whose own clamp still applies.
enum class PassBorder : std::int32_t { drop = 0, clamp = 1, weight_only = 2, reflect = 3 };

struct AxisPassUniforms {
  float sample_count;  // u_sampleX / u_sampleY
  float step;          // u_stepX / u_stepY
  float sigma;         // u_sigmaX / u_sigmaY
  float gamma;         // u_gamma
  PassBorder border = PassBorder::drop;
  bool inverse_gamma = true;   // u_inverseGammaCorrection
  bool blur_alpha = true;      // u_blurAlpha
  float space_dither = 0.0F;   // u_spaceDither; only zero is inside this profile
};

// The bilinear RGBA8 output of the verified M4 profile is an integer multiple
// of 1/4080: the sampler sums byte-times-weight products, divides by 4096 with
// truncation and then scales by 1/4080. The tap value therefore never leaves a
// 4081-point lattice, which is what makes the gamma-decode site a *complete*
// table rather than a sampled approximation.
inline constexpr std::uint32_t kSampledLatticeSize = 4081;

[[nodiscard]] float sampled_lattice_value(std::uint32_t index);

// Inverse of sampled_lattice_value. Throws when the argument is not a lattice
// point, so a sampler change cannot silently degrade the table lookup into a
// nearest-neighbour approximation.
[[nodiscard]] std::uint32_t sampled_lattice_index(float value);

// exp((((-0.5) * distance) * distance) / (sigma * sigma)).
// The numerator is built by two separate multiplies and the division is a real
// division: writing -0.5F * (distance / sigma) * (distance / sigma) is the same
// function and a different binary32 value, and both forms occur in the wild.
[[nodiscard]] float shader_tap_weight(float distance, float sigma);

// pow(value, gamma) and pow(value, 1 / gamma). The reciprocal is formed first
// and then handed to pow, matching the recovered `pow(rgb, vec3(1.0 / gamma))`.
[[nodiscard]] float shader_gamma_decode(float value, float gamma);
[[nodiscard]] float shader_gamma_encode(float value, float gamma);

// Saturate, scale by 255 and round half away from zero. Half-to-even differs on
// exactly the values that land on a tie, which is why the rule is pinned rather
// than delegated to whatever the platform's rint happens to do.
[[nodiscard]] std::uint8_t quantize_unorm8(float value);

// Distances of the taps the loop actually reaches. The recovered loop counts
// from 1, stops at the first index whose float conversion exceeds
// sample_count, and is additionally capped at 1024 iterations.
[[nodiscard]] std::vector<float> axis_tap_distances(const AxisPassUniforms& uniforms);

// Measured substitutions for the two elementary-function sites. An empty span
// means "evaluate with the standard library"; a populated span must be a
// complete table, because a partial table would silently mix two arithmetics.
//   gamma_decode - kSampledLatticeSize entries indexed by lattice point
//   tap_weight   - one entry per tap index 0..taps, index 0 being the centre
// fused_accumulate selects a single fused multiply-add for `sum += tap * weight`
// instead of a rounded multiply followed by a rounded add.
struct FragmentArithmetic {
  std::span<const float> gamma_decode{};
  std::span<const float> tap_weight{};
  bool fused_accumulate = false;
};

struct AxisPassRequest {
  TextureView source;
  AxisPassUniforms uniforms;
  PassAxis axis = PassAxis::horizontal;
  FragmentArithmetic arithmetic{};
};

// weights[p] and sums[4p..4p+3] are the state at the point where the recovered
// pass divides; they are returned so that an external instrument can evaluate
// the final divide and gamma encode instead of the standard library.
// centre_alpha[p] is the untouched alpha of the centre tap, which the pass
// restores when blur_alpha is clear — the gamma round trip never reaches it.
struct AxisPassResult {
  std::vector<float> sums;
  std::vector<float> weights;
  std::vector<float> centre_alpha;
  std::vector<std::uint8_t> bytes;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t taps = 0;
};

[[nodiscard]] AxisPassResult run_axis_pass(const AxisPassRequest& request);

// Re-runs only the tail of the pass from externally supplied encoded values.
// `encoded` holds four floats per pixel: the three gamma-encoded colour
// channels followed by the divided alpha, exactly the vector the recovered pass
// assigns to its output. Supplying the tail this way keeps the control flow in
// this file and confines the instrument to elementary functions.
[[nodiscard]] std::vector<std::uint8_t> quantize_axis_pass(const AxisPassResult& state,
                                                           const AxisPassUniforms& uniforms,
                                                           std::span<const float> encoded);

}  // namespace agfx_contract
