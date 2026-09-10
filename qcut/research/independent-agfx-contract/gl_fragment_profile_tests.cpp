#include "gl_fragment_profile_fixtures.hpp"
#include "gl_fragment_profile_mutations.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using namespace agfx_contract;
using namespace agfx_test;

int failures = 0;

void check(bool passed, const std::string& description) {
  if (passed) return;
  ++failures;
  std::cerr << "FAILED: " << description << '\n';
}

template <typename Callable>
void expect_rejected(Callable callable, const std::string& description) {
  try {
    callable();
  } catch (const std::invalid_argument&) {
    return;
  } catch (const std::exception& error) {
    check(false, description + " raised the wrong exception: " + error.what());
    return;
  }
  check(false, description + " was accepted");
}

TextureView view_of(const std::vector<std::uint8_t>& bytes, std::uint32_t width,
                    std::uint32_t height) {
  TextureView view{};
  view.bytes = std::span<const std::uint8_t>(bytes.data(), bytes.size());
  view.width = width;
  view.height = height;
  view.depth = 1;
  view.row_stride = static_cast<std::size_t>(width) * 4;
  view.slice_stride = view.row_stride * height;
  return view;
}

AxisPassUniforms row_uniforms() {
  AxisPassUniforms uniforms{};
  uniforms.sample_count = fragment_row_sample_count;
  uniforms.step = fragment_row_step;
  uniforms.sigma = fragment_row_sigma;
  uniforms.gamma = 2.2F;
  return uniforms;
}

AxisPassUniforms column_uniforms() {
  AxisPassUniforms uniforms = row_uniforms();
  uniforms.step = fragment_column_step;
  uniforms.sigma = fragment_column_sigma;
  return uniforms;
}

std::size_t differing(const std::vector<std::uint8_t>& left, const std::vector<std::uint8_t>& right) {
  if (left.size() != right.size()) return std::max(left.size(), right.size());
  std::size_t count = 0;
  for (std::size_t index = 0; index < left.size(); ++index) count += left[index] != right[index];
  return count;
}

// ---------------------------------------------------------------------------
// The sampled lattice
// ---------------------------------------------------------------------------

void test_sampled_lattice() {
  for (std::uint32_t index = 0; index < kSampledLatticeSize; ++index) {
    const float value = sampled_lattice_value(index);
    check(sampled_lattice_index(value) == index, "Lattice round trip at index " + std::to_string(index));
  }
  check(sampled_lattice_value(0) == 0.0F, "Lattice zero is exact");
  check(sampled_lattice_value(kSampledLatticeSize - 1) == 1.0F, "Lattice one is exact");
  expect_rejected([] { (void)sampled_lattice_value(kSampledLatticeSize); }, "Lattice index past the end");
  // The lattice is 1/4080, not 1/255. Half of a byte step is not a lattice
  // point, and the inverse must say so rather than snap to the nearest.
  // 4080 = 255 * 16, so half a byte step is still a lattice point; half a
  // lattice step is not, and that is the value the inverse must refuse.
  check(sampled_lattice_index(0.5F / 255.0F) == 8, "Half a byte step is lattice point eight");
  expect_rejected([] { (void)sampled_lattice_index(0.5F / 4080.0F); }, "A non-lattice value");
  expect_rejected([] { (void)sampled_lattice_index(-0.0F / 1.0F - 1.0F); }, "A negative lattice value");
  expect_rejected([] { (void)sampled_lattice_index(std::numeric_limits<float>::quiet_NaN()); },
                  "A NaN lattice value");
  expect_rejected([] { (void)sampled_lattice_index(std::numeric_limits<float>::infinity()); },
                  "An infinite lattice value");
  check(sampled_lattice_index(-0.0F) == 0, "Negative zero is the zero lattice point");
  std::size_t byte_scale_points = 0;
  for (std::uint32_t byte = 0; byte <= 255; ++byte) {
    const float value = static_cast<float>(byte) / 255.0F;
    try {
      (void)sampled_lattice_index(value);
      ++byte_scale_points;
    } catch (const std::invalid_argument&) {
    }
  }
  // 4080 = 255 * 16, so every byte-scale value is a lattice point; the reverse
  // does not hold and that asymmetry is the whole reason the table has 4081
  // entries instead of 256.
  check(byte_scale_points == 256, "Every byte-scale value is a lattice point");
}

// ---------------------------------------------------------------------------
// Elementary sites
// ---------------------------------------------------------------------------

void test_tap_weight() {
  check(shader_tap_weight(0.0F, 0.02F) == 1.0F, "A zero distance weighs exactly one");
  check(shader_tap_weight(0.0F, 1e-20F) == 1.0F, "A zero distance ignores sigma");
  check(shader_tap_weight(-0.01F, 0.02F) == shader_tap_weight(0.01F, 0.02F),
        "The weight is even in the distance");
  check(shader_tap_weight(0.01F, -0.02F) == shader_tap_weight(0.01F, 0.02F),
        "The weight is even in sigma");
  check(shader_tap_weight(100.0F, 0.01F) == 0.0F, "An unreachable tap underflows to zero");
  expect_rejected([] { (void)shader_tap_weight(0.0F, std::numeric_limits<float>::infinity()); },
                  "An infinite sigma");
  expect_rejected([] { (void)shader_tap_weight(0.0F, 0.0F); }, "A zero sigma");
  // The square underflows around 1e-22, long before sigma itself does, and the
  // expression is a zero-over-zero division past that point.
  expect_rejected([] { (void)shader_tap_weight(0.0F, 1e-30F); }, "A sigma whose square underflows");
  check(shader_tap_weight(0.0F, 1e-22F) == 1.0F, "A sigma just inside the squarable range");
  expect_rejected([] { (void)shader_tap_weight(std::numeric_limits<float>::quiet_NaN(), 1.0F); },
                  "A NaN distance");
  expect_rejected([] { (void)shader_tap_weight(1.0F, std::numeric_limits<float>::quiet_NaN()); },
                  "A NaN sigma");

  // The two associations are the same function and not the same value. The
  // golden row's second tap is one of the places they separate, so this is a
  // guard against "simplifying" the expression in gl_fragment_profile.cpp.
  const float distance = 2.0F * fragment_row_step;
  const float sigma = fragment_row_sigma;
  const float ratio = distance / sigma;
  check(std::bit_cast<std::uint32_t>(shader_tap_weight(distance, sigma)) !=
            std::bit_cast<std::uint32_t>(std::exp(-0.5F * ratio * ratio)),
        "The two weight associations disagree on a real tap");
}

void test_quantization() {
  check(quantize_unorm8(0.0F) == 0, "Zero quantizes to zero");
  check(quantize_unorm8(1.0F) == 255, "One quantizes to 255");
  check(quantize_unorm8(-1.0F) == 0, "Negative values saturate low");
  check(quantize_unorm8(2.0F) == 255, "Values above one saturate high");
  check(quantize_unorm8(-0.0F) == 0, "Negative zero quantizes to zero");
  check(quantize_unorm8(std::numeric_limits<float>::quiet_NaN()) == 0, "NaN quantizes to zero");
  check(quantize_unorm8(-std::numeric_limits<float>::infinity()) == 0, "Negative infinity saturates low");
  check(quantize_unorm8(std::numeric_limits<float>::infinity()) == 255, "Infinity saturates high");
  // Half away from zero is the recovered rule, and on this input domain it is
  // also indistinguishable from half to even. A float scaled by 255 is exact in
  // double, so a tie needs value = (2k+1)/510, which is dyadic only when 255
  // divides 2k+1. Inside [0,1] that leaves 0.5 alone, and both rules answer 128
  // there. The rule is still pinned rather than left to the platform, because
  // the domain that makes the two agree is this one and not the next one.
  std::size_t representable_ties = 0;
  for (std::uint32_t step = 0; step < 255; ++step) {
    const double tie = (2.0 * step + 1.0) / 510.0;
    if (static_cast<double>(static_cast<float>(tie)) != tie) continue;
    ++representable_ties;
    check(tie == 0.5, "The only representable tie is one half");
    check(quantize_unorm8(static_cast<float>(tie)) ==
              static_cast<std::uint8_t>(std::nearbyint(tie * 255.0)),
          "Both rounding rules agree on the only representable tie");
  }
  check(representable_ties == 1, "Exactly one tie is representable in [0,1]");
  for (std::uint32_t byte = 0; byte <= 255; ++byte) {
    check(quantize_unorm8(static_cast<float>(byte) / 255.0F) == byte,
          "Byte round trip at " + std::to_string(byte));
  }
}

void test_tap_plan() {
  const auto distances = axis_tap_distances(row_uniforms());
  check(distances.size() == pinned_tap_count, "The pinned draw admits seven taps");
  for (std::size_t tap = 0; tap < distances.size(); ++tap) {
    check(distances[tap] == static_cast<float>(tap + 1) * fragment_row_step,
          "Tap distance " + std::to_string(tap) + " is index times step");
  }
  auto uniforms = row_uniforms();
  uniforms.sample_count = 7.0F;
  check(axis_tap_distances(uniforms).size() == 7, "An exact sample count keeps its last tap");
  uniforms.sample_count = 6.999999F;
  check(axis_tap_distances(uniforms).size() == 6, "A sample count just below seven loses one");
  uniforms.sample_count = 0.0F;
  check(axis_tap_distances(uniforms).empty(), "A zero sample count admits no taps");
  uniforms.sample_count = -5.0F;
  check(axis_tap_distances(uniforms).empty(), "A negative sample count admits no taps");
  uniforms.sample_count = 1e9F;
  check(axis_tap_distances(uniforms).size() == 1024, "The loop ceiling caps the tap count");
  uniforms.sample_count = 4.0F;
  uniforms.step = std::numeric_limits<float>::max();
  expect_rejected([&] { (void)axis_tap_distances(uniforms); }, "A tap distance that overflows");
}

void test_uniform_validation() {
  const std::vector<std::uint8_t> plane(4 * 4 * 4, 0x40);
  AxisPassRequest request{};
  request.source = view_of(plane, 4, 4);
  request.uniforms = row_uniforms();
  check(!run_axis_pass(request).bytes.empty(), "A valid request produces a plane");

  const auto reject = [&](AxisPassUniforms uniforms, const std::string& description) {
    AxisPassRequest broken = request;
    broken.uniforms = uniforms;
    expect_rejected([&] { (void)run_axis_pass(broken); }, description);
  };
  auto uniforms = row_uniforms();
  uniforms.gamma = 0.0F;
  reject(uniforms, "A zero gamma");
  uniforms = row_uniforms();
  uniforms.gamma = -2.2F;
  reject(uniforms, "A negative gamma");
  uniforms = row_uniforms();
  uniforms.gamma = std::numeric_limits<float>::infinity();
  reject(uniforms, "An infinite gamma");
  uniforms = row_uniforms();
  uniforms.sigma = 0.0F;
  reject(uniforms, "A zero sigma");
  uniforms = row_uniforms();
  uniforms.sigma = -0.02F;
  reject(uniforms, "A negative sigma");
  uniforms = row_uniforms();
  uniforms.sigma = 1e-30F;
  reject(uniforms, "A sigma whose square underflows");
  uniforms = row_uniforms();
  uniforms.space_dither = 1e-7F;
  reject(uniforms, "A nonzero spatial dither");
  uniforms = row_uniforms();
  uniforms.step = std::numeric_limits<float>::quiet_NaN();
  reject(uniforms, "A NaN step");
  uniforms = row_uniforms();
  uniforms.border = static_cast<PassBorder>(4);
  reject(uniforms, "An unknown border mode");

  AxisPassRequest broken = request;
  broken.axis = static_cast<PassAxis>(7);
  expect_rejected([&] { (void)run_axis_pass(broken); }, "An unknown axis");

  // A measured table must be complete. A short one would silently mix the
  // measured arithmetic with the standard library's.
  const std::vector<float> short_gamma(16, 0.5F);
  broken = request;
  broken.arithmetic.gamma_decode = std::span<const float>(short_gamma);
  expect_rejected([&] { (void)run_axis_pass(broken); }, "A partial gamma table");
  const std::vector<float> short_weights(3, 0.5F);
  broken = request;
  broken.arithmetic.tap_weight = std::span<const float>(short_weights);
  expect_rejected([&] { (void)run_axis_pass(broken); }, "A partial tap table");

  const std::vector<std::uint8_t> empty;
  broken = request;
  broken.source = view_of(empty, 0, 0);
  expect_rejected([&] { (void)run_axis_pass(broken); }, "An empty source plane");
}

// ---------------------------------------------------------------------------
// The pinned native excerpt
// ---------------------------------------------------------------------------

void test_native_row_and_column() {
  const auto row_source = decode_fragment_hex(fragment_row_source_hex);
  const auto row_native = decode_fragment_hex(fragment_row_native_hex);
  const auto column_source = decode_fragment_hex(fragment_column_source_hex);
  const auto column_native = decode_fragment_hex(fragment_column_native_hex);
  check(row_source.size() == static_cast<std::size_t>(fragment_row_width) * 4, "Golden row width");
  check(row_native.size() == row_source.size(), "Golden row output width");
  check(column_source.size() == static_cast<std::size_t>(fragment_column_height) * 4,
        "Golden column height");
  check(column_native.size() == column_source.size(), "Golden column output height");

  AxisPassRequest horizontal{};
  horizontal.source = view_of(row_source, fragment_row_width, 1);
  horizontal.uniforms = row_uniforms();
  horizontal.axis = PassAxis::horizontal;
  const auto produced_row = run_axis_pass(horizontal).bytes;
  check(produced_row == row_native, "The horizontal pass reproduces the captured row");

  AxisPassRequest vertical{};
  vertical.source = view_of(column_source, 1, fragment_column_height);
  vertical.uniforms = column_uniforms();
  vertical.axis = PassAxis::vertical;
  const auto produced_column = run_axis_pass(vertical).bytes;
  check(produced_column == column_native, "The vertical pass reproduces the captured column");

  // The excerpt is not flat: a model that returned its input unchanged, or that
  // returned a constant, would otherwise pass the two checks above.
  check(differing(row_source, row_native) > 0, "The captured row is actually blurred");
  check(differing(column_source, column_native) > 0, "The captured column is actually blurred");
  check(std::set<std::uint8_t>(row_native.begin(), row_native.end()).size() > 8,
        "The captured row output is not constant");
}

void test_pass_structure() {
  const auto row_source = decode_fragment_hex(fragment_row_source_hex);
  AxisPassRequest request{};
  request.source = view_of(row_source, fragment_row_width, 1);
  request.uniforms = row_uniforms();
  request.axis = PassAxis::horizontal;
  const auto state = run_axis_pass(request);
  check(state.taps == pinned_tap_count, "The pass reports seven taps");
  check(state.weights.size() == fragment_row_width, "One divisor per pixel");
  check(state.sums.size() == static_cast<std::size_t>(fragment_row_width) * 4, "Four sums per pixel");

  // Border mode drop leaves the divisor smaller near the edges and constant in
  // the interior; that is the recovered renormalization and not an accident of
  // the figure.
  const float interior = state.weights[fragment_row_width / 2];
  check(state.weights.front() < interior, "The leading edge drops taps");
  check(state.weights.back() < interior, "The trailing edge drops taps");
  std::size_t interior_constant = 0;
  for (std::uint32_t x = 16; x + 16 < fragment_row_width; ++x) {
    interior_constant += state.weights[x] == interior ? 1 : 0;
  }
  check(interior_constant == fragment_row_width - 32U, "The interior divisor is constant");

  // Weight-only credits the dropped taps and therefore always divides by more.
  auto credited = request;
  credited.uniforms.border = PassBorder::weight_only;
  const auto credited_state = run_axis_pass(credited);
  check(credited_state.weights.front() > state.weights.front(), "Weight-only raises the divisor");
  check(credited_state.weights[fragment_row_width / 2] == interior,
        "Weight-only leaves the interior alone");

  // Clamp and reflect both read a sample instead of dropping it, and they read
  // different samples, so the two must not be folded together.
  auto clamped = request;
  clamped.uniforms.border = PassBorder::clamp;
  auto reflected = request;
  reflected.uniforms.border = PassBorder::reflect;
  const auto clamped_bytes = run_axis_pass(clamped).bytes;
  const auto reflected_bytes = run_axis_pass(reflected).bytes;
  check(differing(clamped_bytes, reflected_bytes) > 0, "Clamp and reflect differ");
  check(differing(clamped_bytes, state.bytes) > 0, "Clamp differs from drop");

  // Alpha only follows the blur when the pass is told to blur it.
  auto opaque = request;
  opaque.uniforms.blur_alpha = false;
  const auto opaque_bytes = run_axis_pass(opaque).bytes;
  for (std::uint32_t x = 0; x < fragment_row_width; ++x) {
    check(opaque_bytes[x * 4 + 3] == row_source[x * 4 + 3], "Unblurred alpha is the centre alpha");
  }
}

void test_measured_tables_change_nothing_visible() {
  const auto row_source = decode_fragment_hex(fragment_row_source_hex);
  const auto row_native = decode_fragment_hex(fragment_row_native_hex);
  AxisPassRequest request{};
  request.source = view_of(row_source, fragment_row_width, 1);
  request.uniforms = row_uniforms();
  request.axis = PassAxis::horizontal;

  // Rebuild the measured tap table for this draw out of the pinned words and
  // re-run with it. The measured values differ from the library's on three of
  // the eight taps, and the eight-bit output still does not move; that is the
  // attribution result, restated where a machine with no GPU can check it.
  std::vector<float> measured(pinned_tap_weights.size() ? 8 : 0);
  const auto& pinned = pinned_tap_weights[2];  // ramp-x, the golden row's draw
  for (std::size_t tap = 0; tap < measured.size(); ++tap) {
    measured[tap] = std::bit_cast<float>(pinned.measured[tap]);
  }
  std::size_t library_differences = 0;
  const auto distances = axis_tap_distances(request.uniforms);
  for (std::size_t tap = 0; tap < measured.size(); ++tap) {
    const float reference = shader_tap_weight(tap == 0 ? 0.0F : distances[tap - 1], request.uniforms.sigma);
    library_differences += std::bit_cast<std::uint32_t>(measured[tap]) !=
                                   std::bit_cast<std::uint32_t>(reference)
                               ? 1
                               : 0;
  }
  // How many taps the pinned GPU measurement disagrees with is a property of
  // this machine's libm as much as of the GPU: shader_tap_weight is a direct
  // std::exp, and exp is not exactly specified the way fmod and sqrt are. The
  // count was recorded where both halves were measured, so it is only asserted
  // there. The lens zero-angle fingerprint made the same claim portably and
  // remote CI refuted it on Linux and Windows.
#if defined(__APPLE__) && defined(__aarch64__)
  check(library_differences == pinned.libm_differences,
        "The pinned tap table disagrees with the library exactly as recorded");
#else
  static_cast<void>(library_differences);
#endif
  check(measured[0] == 1.0F, "The measured centre weight is exactly one");

  request.arithmetic.tap_weight = std::span<const float>(measured);
  request.arithmetic.fused_accumulate = true;
  const auto produced = run_axis_pass(request).bytes;
  check(produced == row_native, "The measured tap table still reproduces the captured row");
}

// ---------------------------------------------------------------------------
// Negative controls
// ---------------------------------------------------------------------------

void test_mutations() {
  const auto row_source = decode_fragment_hex(fragment_row_source_hex);
  const auto row_native = decode_fragment_hex(fragment_row_native_hex);
  const auto column_source = decode_fragment_hex(fragment_column_source_hex);
  const auto column_native = decode_fragment_hex(fragment_column_native_hex);

  AxisPassRequest horizontal{};
  horizontal.source = view_of(row_source, fragment_row_width, 1);
  horizontal.uniforms = row_uniforms();
  horizontal.axis = PassAxis::horizontal;
  AxisPassRequest vertical{};
  vertical.source = view_of(column_source, 1, fragment_column_height);
  vertical.uniforms = column_uniforms();
  vertical.axis = PassAxis::vertical;

  // Recorded, not asserted: which variants this excerpt rejects and which it
  // cannot see. `detected` variants must stay detected; the others are listed
  // with their reason in the accompanying note and are deliberately not
  // deleted to make the suite look stronger than it is.
  const std::vector<FragmentMutation> detected{
      FragmentMutation::border_credits_weight, FragmentMutation::generic_bilinear,
      FragmentMutation::tap_count_rounds_up, FragmentMutation::encode_before_divide,
      FragmentMutation::lattice_byte_scale};
  const std::vector<FragmentMutation> invisible_in_eight_bits{
      FragmentMutation::plus_side_first, FragmentMutation::weight_via_exp2,
      FragmentMutation::weight_ratio_first, FragmentMutation::reciprocal_divide,
      FragmentMutation::fused_accumulate};
  const std::vector<FragmentMutation> not_a_change{
      FragmentMutation::centre_weight_literal, FragmentMutation::ties_to_even,
      FragmentMutation::gamma_skips_alpha_read};
  check(detected.size() + invisible_in_eight_bits.size() + not_a_change.size() + 1 ==
            static_cast<std::size_t>(FragmentMutation::count),
        "Every variant is classified exactly once");

  check(run_mutated_axis_pass(FragmentMutation::faithful, horizontal) == row_native,
        "The faithful variant is the contract");

  for (const auto mutation : detected) {
    const auto row = differing(run_mutated_axis_pass(mutation, horizontal), row_native);
    const auto column = differing(run_mutated_axis_pass(mutation, vertical), column_native);
    check(row + column > 0, "Variant " + fragment_mutation_name(mutation) + " is rejected");
  }
  for (const auto mutation : invisible_in_eight_bits) {
    std::vector<float> mutated_values;
    std::vector<float> faithful_values;
    (void)run_mutated_axis_pass(FragmentMutation::faithful, horizontal, &faithful_values);
    (void)run_mutated_axis_pass(mutation, horizontal, &mutated_values);
    std::size_t float_differences = 0;
    for (std::size_t index = 0; index < faithful_values.size(); ++index) {
      float_differences += std::bit_cast<std::uint32_t>(mutated_values[index]) !=
                                   std::bit_cast<std::uint32_t>(faithful_values[index])
                               ? 1
                               : 0;
    }
    check(float_differences > 0,
          "Variant " + fragment_mutation_name(mutation) + " really changes the arithmetic");
    check(differing(run_mutated_axis_pass(mutation, horizontal), row_native) == 0,
          "Variant " + fragment_mutation_name(mutation) + " stays invisible at eight bits");
  }
  for (const auto mutation : not_a_change) {
    std::vector<float> mutated_values;
    std::vector<float> faithful_values;
    (void)run_mutated_axis_pass(FragmentMutation::faithful, horizontal, &faithful_values);
    (void)run_mutated_axis_pass(mutation, horizontal, &mutated_values);
    check(mutated_values == faithful_values,
          "Variant " + fragment_mutation_name(mutation) + " is not a change on this domain");
  }

  // Why two of the three are not a change here, stated as a check rather than
  // a claim: nothing in the excerpt lands on a rounding tie, and every alpha in
  // it is the opaque lattice endpoint.
  std::vector<float> values;
  (void)run_mutated_axis_pass(FragmentMutation::faithful, horizontal, &values);
  std::size_t ties = 0;
  for (const float value : values) {
    const double scaled = static_cast<double>(std::clamp(value, 0.0F, 1.0F)) * 255.0;
    ties += scaled - std::floor(scaled) == 0.5 ? 1 : 0;
  }
  check(ties == 0, "The excerpt contains no rounding tie");
  std::size_t opaque = 0;
  for (std::uint32_t x = 0; x < fragment_row_width; ++x) opaque += row_source[x * 4 + 3] == 0xff ? 1 : 0;
  check(opaque == fragment_row_width, "Every alpha in the excerpt is opaque");
  check(shader_gamma_decode(1.0F, 2.2F) == 1.0F, "Gamma decoding leaves the opaque endpoint alone");
}

// ---------------------------------------------------------------------------
// Recorded measurements
// ---------------------------------------------------------------------------

void test_recorded_measurements() {
  check(pinned_axis_draws.size() == pinned_attribution.size(), "One attribution per pinned draw");
  std::size_t compared = 0;
  for (const auto& record : pinned_attribution) {
    compared += record.bytes;
    check(record.libm_differences == 0, std::string("Library model closes ") + std::string(record.capture));
    check(record.measured_differences == 0, std::string("Measured model closes ") + std::string(record.capture));
    check(record.instrumented_differences == 0,
          std::string("Instrumented model closes ") + std::string(record.capture));
  }
  check(compared == 608256, "The attribution covered 608,256 bytes");
  check(pinned_gamma_decode_libm_differences == 2860, "The gamma table diverges on 2,860 entries");
  check(pinned_gamma_decode_maximum_ulp == 18, "The gamma table diverges by at most 18 units");
  check(pinned_gamma_decode_fingerprint != 0, "The gamma table fingerprint is recorded");
  check(pinned_sampler_differences == 0, "The mediump sampler matched the closed profile");
  check(pinned_sampler_channels > 0, "The sampler comparison covered real channels");
  // The fused form matched every operand and the unfused form did not; that is
  // what licenses std::fma at the accumulate site and nowhere else.
  check(pinned_fused_multiply_add_differences == 0, "The fragment stage fuses its multiply-add");
  check(pinned_unfused_multiply_add_differences > 0, "The unfused form is distinguishable");
  check(pinned_ieee_division_differences > pinned_reciprocal_multiply_differences,
        "Division is closer to a reciprocal multiply than to a rounded divide");
  check(pinned_reciprocal_multiply_differences > 0,
        "The reciprocal is not the correctly rounded one either");
  // Every elementary function the two gamma sites and the weight site are built
  // from diverges from the standard library somewhere on the same sweep.
  check(pinned_elementary_points == kSampledLatticeSize, "The elementary sweep covers the lattice");
  for (const auto differences : {pinned_log2_differences, pinned_exp2_differences,
                                 pinned_exp_differences, pinned_reciprocal_differences}) {
    check(differences > 0 && differences <= pinned_elementary_points,
          "An elementary function diverges somewhere on the sweep");
  }
  for (const auto ulp : {pinned_log2_maximum_ulp, pinned_exp2_maximum_ulp, pinned_exp_maximum_ulp,
                         pinned_reciprocal_maximum_ulp}) {
    check(ulp > 0, "An elementary divergence is at least one unit wide");
  }
  // The stage composes its own pow out of its own exp2 and log2 exactly; the
  // library composing the same two calls does not land on the same value, so
  // copying the decomposition buys nothing.
  check(pinned_pow_differs_from_stage_exp2_log2 == 0, "The stage's pow is its own exp2 of log2");
  check(pinned_pow_differs_from_library_exp2_log2 > 0,
        "The library's composition of the same decomposition does not reproduce it");

  // The folded and the fetched call disagree everywhere, which is why the
  // oracle feeds its operands through a texel fetch.
  check(pinned_folded_matches_libm == pinned_folding_controls, "Folded calls land on the library value");
  check(pinned_folded_matches_runtime == 0, "Folded calls never land on the fragment-stage value");
}

}  // namespace

int main() {
  try {
    test_sampled_lattice();
    test_tap_weight();
    test_quantization();
    test_tap_plan();
    test_uniform_validation();
    test_native_row_and_column();
    test_pass_structure();
    test_measured_tables_change_nothing_visible();
    test_mutations();
    test_recorded_measurements();
  } catch (const std::exception& error) {
    std::cerr << "Unexpected exception: " << error.what() << '\n';
    return 1;
  }
  if (failures != 0) {
    std::cerr << failures << " fragment profile checks failed\n";
    return 1;
  }
  std::cout << "gl fragment profile contract: all checks passed\n";
  return 0;
}
