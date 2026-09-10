#include "gl_fragment_native_support.hpp"
#include "gl_fragment_profile_fixtures.hpp"
#include "gl_fragment_profile_mutations.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <span>
#include <sstream>
#include <string>
#include <vector>

namespace {

using namespace agfx_test;
using namespace agfx_test::fragment;
using agfx_contract::AxisPassRequest;
using agfx_contract::AxisPassUniforms;
using agfx_contract::PassAxis;
using agfx_contract::TextureView;

bool identical(float left, float right) {
  return std::bit_cast<std::uint32_t>(left) == std::bit_cast<std::uint32_t>(right);
}

std::uint32_t distance_in_ulp(float left, float right) {
  const auto a = std::bit_cast<std::int32_t>(left);
  const auto b = std::bit_cast<std::int32_t>(right);
  return static_cast<std::uint32_t>(a > b ? a - b : b - a);
}

std::vector<std::uint8_t> read_plane(const std::filesystem::path& path, std::size_t bytes) {
  std::ifstream file(path, std::ios::binary);
  require(file.good(), "Cannot open capture plane " + path.string());
  std::vector<std::uint8_t> data(bytes);
  file.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(bytes));
  require(file.gcount() == static_cast<std::streamsize>(bytes),
          "Capture plane " + path.string() + " is not the expected size");
  return data;
}

TextureView plane_view(const std::vector<std::uint8_t>& bytes, std::uint32_t width,
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

struct Difference {
  std::size_t bytes = 0;
  std::size_t differences = 0;
  int maximum = 0;
};

Difference compare(const std::vector<std::uint8_t>& left, const std::vector<std::uint8_t>& right) {
  require(left.size() == right.size(), "Compared planes differ in size");
  Difference result{left.size(), 0, 0};
  for (std::size_t index = 0; index < left.size(); ++index) {
    const int delta = std::abs(static_cast<int>(left[index]) - static_cast<int>(right[index]));
    if (delta == 0) continue;
    ++result.differences;
    result.maximum = std::max(result.maximum, delta);
  }
  return result;
}

// The complete gamma-decode table over the bilinear RGBA8 lattice. The domain
// is closed, so this is a table and not a sample: every value the pass can hand
// to the decode site appears here exactly once.
struct GammaTable {
  std::vector<float> measured;
  std::vector<float> library;
  std::uint32_t differences = 0;
  std::uint32_t maximum_ulp = 0;
  std::uint64_t fingerprint = 0;
};

GammaTable measure_gamma_table(const FragmentLane& lane, float gamma) {
  const auto count = agfx_contract::kSampledLatticeSize;
  std::vector<float> input(static_cast<std::size_t>(count) * 4, 0.0F);
  for (std::uint32_t index = 0; index < count; ++index) {
    input[static_cast<std::size_t>(index) * 4] = agfx_contract::sampled_lattice_value(index);
    input[static_cast<std::size_t>(index) * 4 + 1] = gamma;
  }
  const auto output = lane.evaluate("  o = vec4(pow(a.x, a.y), 0.0, 0.0, 0.0);\n",
                                    static_cast<GLsizei>(count), 1, input);
  GammaTable table{};
  table.measured.resize(count);
  table.library.resize(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    table.measured[index] = output[static_cast<std::size_t>(index) * 4];
    table.library[index] =
        agfx_contract::shader_gamma_decode(agfx_contract::sampled_lattice_value(index), gamma);
    if (!identical(table.measured[index], table.library[index])) {
      ++table.differences;
      table.maximum_ulp = std::max(table.maximum_ulp,
                                   distance_in_ulp(table.measured[index], table.library[index]));
    }
  }
  table.fingerprint = hash_fragment_floats(table.measured.data(), table.measured.size());
  return table;
}

std::vector<float> measure_tap_weights(const FragmentLane& lane, const AxisPassUniforms& uniforms,
                                       std::size_t taps) {
  std::vector<float> input((taps + 1) * 4, 0.0F);
  const auto distances = agfx_contract::axis_tap_distances(uniforms);
  require(distances.size() == taps, "The measured tap plan disagrees with the recovered one");
  input[1] = uniforms.sigma;
  for (std::size_t tap = 0; tap < taps; ++tap) {
    input[(tap + 1) * 4] = distances[tap];
    input[(tap + 1) * 4 + 1] = uniforms.sigma;
  }
  const auto output = lane.evaluate(
      "  o = vec4(exp((((-0.5) * a.x) * a.x) / (a.y * a.y)), 0.0, 0.0, 0.0);\n",
      static_cast<GLsizei>(taps + 1), 1, input);
  std::vector<float> weights(taps + 1);
  for (std::size_t tap = 0; tap <= taps; ++tap) weights[tap] = output[tap * 4];
  return weights;
}

// Evaluates the closing divide and gamma encode on the fragment stage from the
// state the recovered control flow reached. The instrument only ever sees
// elementary expressions; the loop, the border rule and the ordering stay in
// gl_fragment_profile.cpp.
std::vector<float> instrument_tail(const FragmentLane& lane,
                                   const agfx_contract::AxisPassResult& state, float gamma) {
  const auto pixels = state.weights.size();
  std::vector<float> weights(pixels * 4, 0.0F);
  for (std::size_t pixel = 0; pixel < pixels; ++pixel) {
    weights[pixel * 4] = state.weights[pixel];
    weights[pixel * 4 + 1] = 1.0F / gamma;
  }
  return lane.evaluate(
      "  vec4 divided = a / vec4(b.x);\n"
      "  o = vec4(pow(divided.xyz, vec3(b.y)), divided.w);\n",
      static_cast<GLsizei>(state.width), static_cast<GLsizei>(state.height), state.sums, weights);
}

struct LoweringReport {
  std::uint32_t operands = 0;
  std::uint32_t unfused_multiply_add = 0;
  std::uint32_t fused_multiply_add = 0;
  std::uint32_t ieee_division = 0;
  std::uint32_t reciprocal_multiply = 0;
};

LoweringReport measure_lowering(const FragmentLane& lane) {
  LoweringReport report{};
  report.operands = pinned_lowering_operands;
  std::vector<float> input(static_cast<std::size_t>(report.operands) * 4);
  std::uint32_t state = fragment_fixture_seed;
  const auto unit = [&state] {
    return static_cast<float>(next_fragment_word(state) >> 8) / static_cast<float>(1 << 24);
  };
  for (std::uint32_t index = 0; index < report.operands; ++index) {
    input[static_cast<std::size_t>(index) * 4] = unit();
    input[static_cast<std::size_t>(index) * 4 + 1] = unit() * 2.0F;
    input[static_cast<std::size_t>(index) * 4 + 2] = unit() * 8.0F;
    input[static_cast<std::size_t>(index) * 4 + 3] = 0.25F + unit() * 8.0F;
  }
  const auto output = lane.evaluate("  o = vec4(a.z + a.x * a.y, a.z / a.w, a.z * (1.0 / a.w), 0.0);\n",
                                    static_cast<GLsizei>(report.operands), 1, input);
  for (std::uint32_t index = 0; index < report.operands; ++index) {
    const float x = input[static_cast<std::size_t>(index) * 4];
    const float y = input[static_cast<std::size_t>(index) * 4 + 1];
    const float z = input[static_cast<std::size_t>(index) * 4 + 2];
    const float w = input[static_cast<std::size_t>(index) * 4 + 3];
    const float measured_mac = output[static_cast<std::size_t>(index) * 4];
    const float measured_div = output[static_cast<std::size_t>(index) * 4 + 1];
    if (!identical(measured_mac, z + x * y)) ++report.unfused_multiply_add;
    if (!identical(measured_mac, std::fma(x, y, z))) ++report.fused_multiply_add;
    if (!identical(measured_div, z / w)) ++report.ieee_division;
    if (!identical(measured_div, z * (1.0F / w))) ++report.reciprocal_multiply;
  }
  return report;
}

// The elementary functions the two gamma sites and the weight site are built
// from, measured on the same lane. They are reported so that "the library
// cannot reproduce this" is a number rather than an assertion: a reader who
// wants a portable model has to defeat every row here first.
struct ElementaryReport {
  std::uint32_t points = 0;
  std::uint32_t log2_differences = 0;
  std::uint32_t log2_maximum_ulp = 0;
  std::uint32_t exp2_differences = 0;
  std::uint32_t exp2_maximum_ulp = 0;
  std::uint32_t exp_differences = 0;
  std::uint32_t exp_maximum_ulp = 0;
  std::uint32_t reciprocal_differences = 0;
  std::uint32_t reciprocal_maximum_ulp = 0;
  std::uint32_t pow_differs_from_stage_exp2_log2 = 0;
  std::uint32_t pow_differs_from_library_exp2_log2 = 0;
};

ElementaryReport measure_elementary(const FragmentLane& lane) {
  const auto count = agfx_contract::kSampledLatticeSize;
  std::vector<float> input(static_cast<std::size_t>(count) * 4, 0.0F);
  for (std::uint32_t index = 0; index < count; ++index) {
    const auto slot = static_cast<std::size_t>(index) * 4;
    input[slot] = agfx_contract::sampled_lattice_value(index);
    input[slot + 1] = 2.2F;
    // A negative sweep for exp/exp2 and a divisor bounded away from zero.
    input[slot + 2] = -static_cast<float>(index) / 512.0F;
    input[slot + 3] = 0.25F + static_cast<float>(index) / 512.0F;
  }
  const auto first = lane.evaluate("  o = vec4(log2(a.x), exp2(a.z), exp(a.z), 1.0 / a.w);\n",
                                   static_cast<GLsizei>(count), 1, input);
  const auto second = lane.evaluate("  o = vec4(pow(a.x, a.y), exp2(a.y * log2(a.x)), 0.0, 0.0);\n",
                                    static_cast<GLsizei>(count), 1, input);
  ElementaryReport report{};
  report.points = count;
  const auto record = [](float measured, float reference, std::uint32_t& differences,
                         std::uint32_t& maximum) {
    if (identical(measured, reference)) return;
    ++differences;
    maximum = std::max(maximum, distance_in_ulp(measured, reference));
  };
  for (std::uint32_t index = 0; index < count; ++index) {
    const auto slot = static_cast<std::size_t>(index) * 4;
    const float x = input[slot];
    const float z = input[slot + 2];
    const float w = input[slot + 3];
    if (x > 0.0F) {
      record(first[slot], std::log2(x), report.log2_differences, report.log2_maximum_ulp);
      if (!identical(second[slot], second[slot + 1])) ++report.pow_differs_from_stage_exp2_log2;
      if (!identical(second[slot], std::exp2(2.2F * std::log2(x)))) {
        ++report.pow_differs_from_library_exp2_log2;
      }
    }
    record(first[slot + 1], std::exp2(z), report.exp2_differences, report.exp2_maximum_ulp);
    record(first[slot + 2], std::exp(z), report.exp_differences, report.exp_maximum_ulp);
    record(first[slot + 3], 1.0F / w, report.reciprocal_differences, report.reciprocal_maximum_ulp);
  }
  return report;
}

struct FoldingReport {
  std::uint32_t controls = 0;
  std::uint32_t folded_matches_library = 0;
  std::uint32_t folded_matches_runtime = 0;
};

// Three literal operands the compiler can fold, next to the same three fed
// through a texel fetch. If the folded and the fetched answers agreed there
// would be no way to tell a shader-compiler measurement from a fragment-stage
// one; they do not agree, which is what makes the fetched form necessary.
FoldingReport measure_folding(const FragmentLane& lane) {
  const std::array<float, 3> points{0.25F, 0.5F, 0.75F};
  std::vector<float> input(points.size() * 4, 0.0F);
  for (std::size_t index = 0; index < points.size(); ++index) {
    input[index * 4] = points[index];
    input[index * 4 + 1] = 2.2F;
  }
  const auto output = lane.evaluate(
      "  o = vec4(pow(0.25, 2.2), pow(0.5, 2.2), pow(0.75, 2.2), pow(a.x, a.y));\n",
      static_cast<GLsizei>(points.size()), 1, input);
  FoldingReport report{static_cast<std::uint32_t>(points.size()), 0, 0};
  for (std::size_t index = 0; index < points.size(); ++index) {
    // Lane `index` carries all three folded results in x, y and z and the
    // fetched result for points[index] in w, so the folded value for that same
    // point is component `index` of that lane.
    const float folded = output[index * 4 + index];
    const float runtime = output[index * 4 + 3];
    if (identical(folded, std::pow(points[index], 2.2F))) ++report.folded_matches_library;
    if (identical(folded, runtime)) ++report.folded_matches_runtime;
  }
  return report;
}

struct SamplerReport {
  std::uint32_t channels = 0;
  std::uint32_t differences = 0;
};

// The recovered pass declares its input as a mediump sampler. This compares the
// fragment stage's own bilinear result against the already closed M4 profile at
// coordinates the pass actually produces, so that "the sampler narrowed the
// value" is a measured answer rather than an assumption.
SamplerReport measure_sampler(const FragmentLane& lane, const std::vector<std::uint8_t>& bytes,
                              std::uint32_t width, std::uint32_t height,
                              const AxisPassUniforms& uniforms) {
  const ByteSource source(static_cast<GLsizei>(width), static_cast<GLsizei>(height), bytes.data());
  const auto distances = agfx_contract::axis_tap_distances(uniforms);
  const auto view = plane_view(bytes, width, height);
  const std::array<TextureView, 1> levels{view};
  std::vector<float> queries;
  std::vector<std::array<float, 4>> expected;
  for (std::uint32_t y = 0; y < height; ++y) {
    const float v = (static_cast<float>(y) + 0.5F) / static_cast<float>(height);
    for (std::uint32_t x = 0; x < width; ++x) {
      const float u = (static_cast<float>(x) + 0.5F) / static_cast<float>(width);
      const std::size_t tap = (static_cast<std::size_t>(y) * width + x) % distances.size();
      const float coordinate = ((x + y) % 2 == 0) ? u - distances[tap] : u + distances[tap];
      if (coordinate < 0.0F || coordinate > 1.0F) continue;
      agfx_contract::MipTextureRequest request{};
      request.levels = levels;
      request.point = {coordinate, v, .5F};
      request.lod = 0.0F;
      request.settings.filter = agfx_contract::TexelFilter::linear;
      request.settings.wrap_s = agfx_contract::TexelWrap::clamp;
      request.settings.wrap_t = agfx_contract::TexelWrap::clamp;
      request.settings.wrap_r = agfx_contract::TexelWrap::clamp;
      request.filter = agfx_contract::MipFilter::none;
      expected.push_back(agfx_contract::sample_m4_texture(request));
      queries.insert(queries.end(), {coordinate, v, 0.0F, 0.0F});
    }
  }
  const auto lanes = static_cast<GLsizei>(expected.size());
  const auto output = lane.evaluate("  o = texture(u_source, a.xy);\n", lanes, 1, queries, {},
                                    source.texture());
  SamplerReport report{};
  for (std::size_t index = 0; index < expected.size(); ++index) {
    for (std::size_t channel = 0; channel < 4; ++channel) {
      ++report.channels;
      if (!identical(output[index * 4 + channel], expected[index][channel])) ++report.differences;
    }
  }
  return report;
}

struct AxisReport {
  std::string capture;
  PassAxis axis = PassAxis::horizontal;
  std::size_t bytes = 0;
  Difference library;
  Difference measured;
  Difference instrumented;
  Difference upstream;
  std::vector<float> weights;
  std::uint32_t weight_differences = 0;
};

AxisPassUniforms uniforms_for(const PinnedAxisDraw& draw) {
  AxisPassUniforms uniforms{};
  uniforms.sample_count = draw.sample_count;
  uniforms.step = draw.step;
  uniforms.sigma = draw.sigma;
  uniforms.gamma = 2.2F;
  uniforms.border = agfx_contract::PassBorder::drop;
  uniforms.inverse_gamma = true;
  uniforms.blur_alpha = true;
  uniforms.space_dither = 0.0F;
  return uniforms;
}

AxisReport attribute(const FragmentLane& lane, const std::filesystem::path& root,
                     const PinnedAxisDraw& draw, const GammaTable& gamma) {
  const std::size_t bytes = static_cast<std::size_t>(draw.width) * draw.height * 4;
  const bool horizontal = draw.axis == PassAxis::horizontal;
  const auto input = read_plane(root / draw.capture / (horizontal ? "0.rgba" : "1.rgba"), bytes);
  const auto native = read_plane(root / draw.capture / (horizontal ? "1.rgba" : "2.rgba"), bytes);
  const auto uniforms = uniforms_for(draw);

  AxisPassRequest request{};
  request.source = plane_view(input, draw.width, draw.height);
  request.uniforms = uniforms;
  request.axis = draw.axis;

  AxisReport report{};
  report.capture = draw.capture;
  report.axis = draw.axis;
  report.bytes = bytes;
  report.upstream = compare(input, native);

  const auto library_state = agfx_contract::run_axis_pass(request);
  report.library = compare(library_state.bytes, native);

  report.weights = measure_tap_weights(lane, uniforms, library_state.taps);
  for (std::size_t tap = 0; tap < report.weights.size(); ++tap) {
    const auto distances = agfx_contract::axis_tap_distances(uniforms);
    const float reference = agfx_contract::shader_tap_weight(
        tap == 0 ? 0.0F : distances[tap - 1], uniforms.sigma);
    if (!identical(report.weights[tap], reference)) ++report.weight_differences;
  }

  request.arithmetic.gamma_decode = std::span<const float>(gamma.measured);
  request.arithmetic.tap_weight = std::span<const float>(report.weights);
  request.arithmetic.fused_accumulate = true;
  const auto measured_state = agfx_contract::run_axis_pass(request);
  report.measured = compare(measured_state.bytes, native);

  const auto tail = instrument_tail(lane, measured_state, uniforms.gamma);
  const auto instrumented = agfx_contract::quantize_axis_pass(measured_state, uniforms, tail);
  report.instrumented = compare(instrumented, native);
  return report;
}

// A mutation is reported against two different references, because they answer
// two different questions. `native_differences` says whether the vendor's own
// pixels reject the variant; `contract_differences` says whether the recovered
// model rejects it at all. A variant that scores zero on both is not a weak
// test — it is a statement that this edit is invisible in an eight-bit output,
// and it stays in the list saying so.
// The default suite carries one row and one column instead of a whole frame.
// That is only legitimate if a horizontal pass on an isolated row reproduces
// that row of the full pass and a vertical pass on an isolated column does the
// same, so the claim is re-derived here over every row and column of a capture
// rather than asserted in the fixture header.
struct SeparabilityReport {
  std::size_t rows = 0;
  std::size_t columns = 0;
  std::size_t row_differences = 0;
  std::size_t column_differences = 0;
};

SeparabilityReport check_separability(const std::filesystem::path& root,
                                      const PinnedAxisDraw& horizontal,
                                      const PinnedAxisDraw& vertical) {
  const std::uint32_t width = horizontal.width;
  const std::uint32_t height = horizontal.height;
  const std::size_t bytes = static_cast<std::size_t>(width) * height * 4;
  const auto source = read_plane(root / horizontal.capture / "0.rgba", bytes);
  const auto middle = read_plane(root / horizontal.capture / "1.rgba", bytes);
  const auto final_plane = read_plane(root / horizontal.capture / "2.rgba", bytes);
  SeparabilityReport report{};
  for (std::uint32_t y = 0; y < height; ++y) {
    const std::vector<std::uint8_t> row(source.begin() + static_cast<std::ptrdiff_t>(y) * width * 4,
                                        source.begin() + static_cast<std::ptrdiff_t>(y + 1) * width * 4);
    AxisPassRequest request{};
    request.source = plane_view(row, width, 1);
    request.uniforms = uniforms_for(horizontal);
    request.axis = PassAxis::horizontal;
    const auto produced = agfx_contract::run_axis_pass(request).bytes;
    ++report.rows;
    for (std::size_t index = 0; index < produced.size(); ++index) {
      if (produced[index] != middle[static_cast<std::size_t>(y) * width * 4 + index]) ++report.row_differences;
    }
  }
  for (std::uint32_t x = 0; x < width; ++x) {
    std::vector<std::uint8_t> column(static_cast<std::size_t>(height) * 4);
    for (std::uint32_t y = 0; y < height; ++y) {
      for (std::size_t channel = 0; channel < 4; ++channel) {
        column[static_cast<std::size_t>(y) * 4 + channel] =
            middle[(static_cast<std::size_t>(y) * width + x) * 4 + channel];
      }
    }
    AxisPassRequest request{};
    request.source = plane_view(column, 1, height);
    request.uniforms = uniforms_for(vertical);
    request.axis = PassAxis::vertical;
    const auto produced = agfx_contract::run_axis_pass(request).bytes;
    ++report.columns;
    for (std::uint32_t y = 0; y < height; ++y) {
      for (std::size_t channel = 0; channel < 4; ++channel) {
        if (produced[static_cast<std::size_t>(y) * 4 + channel] !=
            final_plane[(static_cast<std::size_t>(y) * width + x) * 4 + channel]) {
          ++report.column_differences;
        }
      }
    }
  }
  return report;
}

struct MutationReport {
  std::string name;
  bool built = false;
  std::size_t native_differences = 0;
  std::size_t contract_differences = 0;
  std::size_t float_differences = 0;
  std::size_t draws_detected_natively = 0;
  std::size_t draws_detected_by_contract = 0;
};

// How many of the values handed to the quantizer land exactly on a half-step.
// The half-away and half-even rules can only disagree there, so a zero here is
// the reason a rounding variant survives, not evidence that the rule is free.
struct QuantizationDomain {
  std::size_t values = 0;
  std::size_t ties = 0;
  std::size_t distinct_alpha_lattice_points = 0;
};

std::vector<MutationReport> run_mutations(const std::filesystem::path& root,
                                          std::span<const PinnedAxisDraw> draws,
                                          QuantizationDomain& domain) {
  std::vector<MutationReport> reports;
  for (unsigned index = 0; index < static_cast<unsigned>(FragmentMutation::count); ++index) {
    reports.push_back({fragment_mutation_name(static_cast<FragmentMutation>(index)), true, 0, 0, 0, 0});
  }
  for (const auto& draw : draws) {
    const std::size_t bytes = static_cast<std::size_t>(draw.width) * draw.height * 4;
    const bool horizontal = draw.axis == PassAxis::horizontal;
    const auto input = read_plane(root / draw.capture / (horizontal ? "0.rgba" : "1.rgba"), bytes);
    const auto native = read_plane(root / draw.capture / (horizontal ? "1.rgba" : "2.rgba"), bytes);
    AxisPassRequest request{};
    request.source = plane_view(input, draw.width, draw.height);
    request.uniforms = uniforms_for(draw);
    request.axis = draw.axis;
    std::vector<float> faithful_values;
    const auto faithful = run_mutated_axis_pass(FragmentMutation::faithful, request, &faithful_values);
    std::vector<float> values;
    for (unsigned index = 0; index < static_cast<unsigned>(FragmentMutation::count); ++index) {
      const auto produced = run_mutated_axis_pass(static_cast<FragmentMutation>(index), request, &values);
      const auto against_native = compare(produced, native).differences;
      const auto against_contract = compare(produced, faithful).differences;
      reports[index].native_differences += against_native;
      reports[index].contract_differences += against_contract;
      reports[index].draws_detected_natively += against_native != 0 ? 1 : 0;
      reports[index].draws_detected_by_contract += against_contract != 0 ? 1 : 0;
      for (std::size_t value = 0; value < values.size(); ++value) {
        if (!identical(values[value], faithful_values[value])) ++reports[index].float_differences;
      }
    }
    for (const float value : faithful_values) {
      ++domain.values;
      const double scaled = static_cast<double>(value < 0.0F ? 0.0F : (value > 1.0F ? 1.0F : value)) * 255.0;
      if (scaled - std::floor(scaled) == 0.5) ++domain.ties;
    }
    std::vector<bool> seen(agfx_contract::kSampledLatticeSize, false);
    const auto state = agfx_contract::run_axis_pass(request);
    for (const float alpha : state.centre_alpha) seen[agfx_contract::sampled_lattice_index(alpha)] = true;
    domain.distinct_alpha_lattice_points =
        std::max<std::size_t>(domain.distinct_alpha_lattice_points,
                              static_cast<std::size_t>(std::count(seen.begin(), seen.end(), true)));
  }
  return reports;
}

void emit(std::ostream& out, const RendererIdentity& identity, const GammaTable& gamma,
          const LoweringReport& lowering, const ElementaryReport& elementary,
          const FoldingReport& folding, const SamplerReport& sampler,
          const QuantizationDomain& domain, const SeparabilityReport& separability,
          const std::vector<AxisReport>& axes, const std::vector<MutationReport>& mutations) {
  out << "{\"profile\":\"gl-fragment-arithmetic-v1\",\"renderer\":" << std::quoted(identity.renderer)
      << ",\"gl_version\":" << std::quoted(identity.version)
      << ",\"shading_language\":" << std::quoted(identity.shading_language)
      << ",\"vendor\":" << std::quoted(identity.vendor)
      << ",\"gamma_decode\":{\"entries\":" << gamma.measured.size()
      << ",\"library_differences\":" << gamma.differences
      << ",\"maximum_ulp\":" << gamma.maximum_ulp << ",\"fingerprint\":\"" << std::hex
      << gamma.fingerprint << std::dec << "\"},\"lowering\":{\"operands\":" << lowering.operands
      << ",\"unfused_multiply_add_differences\":" << lowering.unfused_multiply_add
      << ",\"fused_multiply_add_differences\":" << lowering.fused_multiply_add
      << ",\"ieee_division_differences\":" << lowering.ieee_division
      << ",\"reciprocal_multiply_differences\":" << lowering.reciprocal_multiply
      << "},\"elementary\":{\"points\":" << elementary.points
      << ",\"log2_differences\":" << elementary.log2_differences
      << ",\"log2_maximum_ulp\":" << elementary.log2_maximum_ulp
      << ",\"exp2_differences\":" << elementary.exp2_differences
      << ",\"exp2_maximum_ulp\":" << elementary.exp2_maximum_ulp
      << ",\"exp_differences\":" << elementary.exp_differences
      << ",\"exp_maximum_ulp\":" << elementary.exp_maximum_ulp
      << ",\"reciprocal_differences\":" << elementary.reciprocal_differences
      << ",\"reciprocal_maximum_ulp\":" << elementary.reciprocal_maximum_ulp
      << ",\"pow_differs_from_stage_exp2_log2\":" << elementary.pow_differs_from_stage_exp2_log2
      << ",\"pow_differs_from_library_exp2_log2\":" << elementary.pow_differs_from_library_exp2_log2
      << "},\"folding\":{\"controls\":" << folding.controls
      << ",\"folded_matches_library\":" << folding.folded_matches_library
      << ",\"folded_matches_runtime\":" << folding.folded_matches_runtime
      << "},\"sampler\":{\"channels\":" << sampler.channels
      << ",\"differences\":" << sampler.differences
      << "},\"quantization_domain\":{\"values\":" << domain.values << ",\"ties\":" << domain.ties
      << ",\"distinct_alpha_lattice_points\":" << domain.distinct_alpha_lattice_points
      << "},\"separability\":{\"rows\":" << separability.rows
      << ",\"row_differences\":" << separability.row_differences
      << ",\"columns\":" << separability.columns
      << ",\"column_differences\":" << separability.column_differences << "},\"draws\":[";
  for (std::size_t index = 0; index < axes.size(); ++index) {
    const auto& axis = axes[index];
    if (index != 0) out << ',';
    out << "{\"capture\":" << std::quoted(axis.capture) << ",\"axis\":\""
        << (axis.axis == PassAxis::horizontal ? "x" : "y") << "\",\"bytes\":" << axis.bytes
        << ",\"upstream_differences\":" << axis.upstream.differences
        << ",\"upstream_maximum\":" << axis.upstream.maximum
        << ",\"library_differences\":" << axis.library.differences
        << ",\"library_maximum\":" << axis.library.maximum
        << ",\"measured_differences\":" << axis.measured.differences
        << ",\"measured_maximum\":" << axis.measured.maximum
        << ",\"instrumented_differences\":" << axis.instrumented.differences
        << ",\"instrumented_maximum\":" << axis.instrumented.maximum
        << ",\"tap_weight_library_differences\":" << axis.weight_differences
        << ",\"tap_weights\":[";
    for (std::size_t tap = 0; tap < axis.weights.size(); ++tap) {
      if (tap != 0) out << ',';
      out << "\"0x" << std::hex << std::bit_cast<std::uint32_t>(axis.weights[tap]) << std::dec << '"';
    }
    out << "]}";
  }
  out << "],\"mutations\":[";
  for (std::size_t index = 0; index < mutations.size(); ++index) {
    if (index != 0) out << ',';
    out << "{\"name\":" << std::quoted(mutations[index].name)
        << ",\"built\":" << (mutations[index].built ? "true" : "false")
        << ",\"native_differences\":" << mutations[index].native_differences
        << ",\"contract_differences\":" << mutations[index].contract_differences
        << ",\"float_differences\":" << mutations[index].float_differences
        << ",\"draws_detected_natively\":" << mutations[index].draws_detected_natively
        << ",\"draws_detected_by_contract\":" << mutations[index].draws_detected_by_contract << '}';
  }
  out << "]}\n";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 2) {
      std::cerr << "usage: agfx-gl-fragment-oracle <capture-root>\n";
      return 2;
    }
    const std::filesystem::path root(argv[1]);
    if (!root.is_absolute() || !std::filesystem::is_directory(root)) {
      std::cerr << "The capture root must be an existing absolute directory\n";
      return 2;
    }
    const qcut_diagnostic::CglContext context;
    const auto identity = read_identity();
    if (!identity.verified()) {
      std::cerr << "Refusing to profile an unverified renderer: " << identity.renderer << " / "
                << identity.version << " / " << identity.shading_language << '\n';
      return 2;
    }
    const FragmentLane lane;
    const auto gamma = measure_gamma_table(lane, 2.2F);
    const auto lowering = measure_lowering(lane);
    const auto elementary = measure_elementary(lane);
    const auto folding = measure_folding(lane);

    std::vector<AxisReport> axes;
    for (const auto& draw : pinned_axis_draws) axes.push_back(attribute(lane, root, draw, gamma));

    const auto& first = pinned_axis_draws.front();
    const auto sampler_plane = read_plane(root / first.capture / "0.rgba",
                                          static_cast<std::size_t>(first.width) * first.height * 4);
    const auto sampler = measure_sampler(lane, sampler_plane, first.width, first.height,
                                         uniforms_for(first));
    const auto separability = check_separability(root, pinned_axis_draws[8], pinned_axis_draws[9]);
    QuantizationDomain domain{};
    const auto mutations = run_mutations(root, pinned_axis_draws, domain);

    emit(std::cout, identity, gamma, lowering, elementary, folding, sampler, domain, separability,
         axes, mutations);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
