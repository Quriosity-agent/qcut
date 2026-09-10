#include "gl_fragment_profile.hpp"

#include <array>
#include <cfenv>
#include <cmath>
#include <stdexcept>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The fragment arithmetic profile requires IEEE floating-point semantics"
#endif

namespace agfx_contract {
namespace {

// The recovered loop is `for (int i = 1; i <= 1024; ++i)`, so 1024 is a hard
// ceiling independent of the sample count and not a buffer size to be tuned.
constexpr std::uint32_t kMaximumTaps = 1024;

constexpr float kLatticeScale = 4080.0F;

void require_nearest_rounding() {
  if (std::fegetround() != FE_TONEAREST) {
    throw std::invalid_argument("The fragment arithmetic profile requires nearest rounding");
  }
}

void validate_uniforms(const AxisPassUniforms& uniforms) {
  for (float value : {uniforms.sample_count, uniforms.step, uniforms.sigma,
                      uniforms.gamma, uniforms.space_dither}) {
    if (!std::isfinite(value)) {
      throw std::invalid_argument("Fragment pass uniforms must be finite");
    }
  }
  if (uniforms.gamma <= 0 || !std::isfinite(1.0F / uniforms.gamma)) {
    throw std::invalid_argument("Fragment pass gamma must have a finite reciprocal");
  }
  if (uniforms.sigma <= 0) {
    // sigma reaches the weight only as sigma*sigma, so a negative sigma is
    // numerically identical to its magnitude. It is still rejected: nothing in
    // the recovered plan produces one, so accepting it would extend the
    // contract past the evidence.
    throw std::invalid_argument("Fragment pass sigma must be positive");
  }
  if (uniforms.sigma * uniforms.sigma == 0.0F) {
    throw std::invalid_argument("Fragment pass sigma is below the squarable range");
  }
  if (uniforms.space_dither != 0.0F) {
    throw std::invalid_argument("Fragment pass spatial dither is outside this profile");
  }
  switch (uniforms.border) {
    case PassBorder::drop:
    case PassBorder::clamp:
    case PassBorder::weight_only:
    case PassBorder::reflect:
      break;
    default:
      throw std::invalid_argument("Unknown fragment pass border mode");
  }
}

std::array<std::uint32_t, 4> sample_lattice(const TextureView& source, float u, float v) {
  const std::array<TextureView, 1> levels{source};
  MipTextureRequest request{};
  request.levels = levels;
  request.point = {u, v, .5F};
  request.lod = 0.0F;
  request.settings.filter = TexelFilter::linear;
  request.settings.wrap_s = TexelWrap::clamp;
  request.settings.wrap_t = TexelWrap::clamp;
  request.settings.wrap_r = TexelWrap::clamp;
  request.filter = MipFilter::none;
  const auto sampled = sample_m4_texture(request);
  std::array<std::uint32_t, 4> indices{};
  for (std::size_t channel = 0; channel < 4; ++channel) {
    indices[channel] = sampled_lattice_index(sampled[channel]);
  }
  return indices;
}

// One tap contributes four decoded channels. Alpha never passes through the
// gamma round trip, so it is read straight off the lattice.
std::array<float, 4> decode_tap(const std::array<std::uint32_t, 4>& indices,
                                const AxisPassUniforms& uniforms,
                                const FragmentArithmetic& arithmetic) {
  std::array<float, 4> tap{};
  for (std::size_t channel = 0; channel < 4; ++channel) {
    const float value = sampled_lattice_value(indices[channel]);
    if (channel == 3 || !uniforms.inverse_gamma) {
      tap[channel] = value;
    } else if (arithmetic.gamma_decode.empty()) {
      tap[channel] = shader_gamma_decode(value, uniforms.gamma);
    } else {
      tap[channel] = arithmetic.gamma_decode[indices[channel]];
    }
  }
  return tap;
}

void accumulate(std::array<float, 4>& sum, const std::array<float, 4>& tap, float weight,
                bool fused) {
  for (std::size_t channel = 0; channel < 4; ++channel) {
    sum[channel] = fused ? std::fma(tap[channel], weight, sum[channel])
                         : sum[channel] + tap[channel] * weight;
  }
}

}  // namespace

float sampled_lattice_value(std::uint32_t index) {
  if (index >= kSampledLatticeSize) {
    throw std::invalid_argument("Sampled lattice index is outside the bilinear RGBA8 range");
  }
  return static_cast<float>(index) / kLatticeScale;
}

std::uint32_t sampled_lattice_index(float value) {
  if (!std::isfinite(value) || value < 0.0F || value > 1.0F) {
    throw std::invalid_argument("Sampled lattice values are finite and inside [0,1]");
  }
  const auto index = static_cast<std::uint32_t>(
      std::lround(static_cast<double>(value) * static_cast<double>(kLatticeScale)));
  if (index >= kSampledLatticeSize || sampled_lattice_value(index) != value) {
    throw std::invalid_argument("Value is not a point of the bilinear RGBA8 lattice");
  }
  return index;
}

float shader_tap_weight(float distance, float sigma) {
  if (!std::isfinite(distance) || !std::isfinite(sigma) || sigma == 0.0F) {
    throw std::invalid_argument("Tap weight requires a finite distance and nonzero sigma");
  }
  // sigma reaches the expression only as sigma*sigma, and that square underflows
  // to zero well before sigma does. Past that point the recovered expression is
  // a zero-over-zero division and every weight in the pass becomes NaN, so the
  // boundary is on the square and not on sigma itself.
  if (sigma * sigma == 0.0F) {
    throw std::invalid_argument("Tap weight sigma is below the squarable range");
  }
  return std::exp((((-0.5F) * distance) * distance) / (sigma * sigma));
}

float shader_gamma_decode(float value, float gamma) { return std::pow(value, gamma); }

float shader_gamma_encode(float value, float gamma) { return std::pow(value, 1.0F / gamma); }

std::uint8_t quantize_unorm8(float value) {
  const float saturated = std::isnan(value) ? 0.0F : (value < 0.0F ? 0.0F : (value > 1.0F ? 1.0F : value));
  return static_cast<std::uint8_t>(std::lround(static_cast<double>(saturated) * 255.0));
}

std::vector<float> axis_tap_distances(const AxisPassUniforms& uniforms) {
  validate_uniforms(uniforms);
  std::vector<float> distances;
  for (std::uint32_t index = 1; index <= kMaximumTaps; ++index) {
    const float counter = static_cast<float>(index);
    // The comparison is against the float conversion of the counter, so a
    // sample count of 7.46 admits seven taps and a count of exactly 7 admits
    // seven as well. Rounding the count first would lose that boundary.
    if (counter > uniforms.sample_count) break;
    const float distance = counter * uniforms.step;
    if (!std::isfinite(distance)) {
      throw std::invalid_argument("Fragment pass tap distance leaves the finite range");
    }
    distances.push_back(distance);
  }
  return distances;
}

AxisPassResult run_axis_pass(const AxisPassRequest& request) {
  require_nearest_rounding();
  validate_uniforms(request.uniforms);
  const TextureView source = validate_texture_view(request.source);
  if (request.axis != PassAxis::horizontal && request.axis != PassAxis::vertical) {
    throw std::invalid_argument("Unknown fragment pass axis");
  }
  const auto distances = axis_tap_distances(request.uniforms);
  const auto& arithmetic = request.arithmetic;
  if (!arithmetic.gamma_decode.empty() && arithmetic.gamma_decode.size() != kSampledLatticeSize) {
    throw std::invalid_argument("A measured gamma table must cover the whole sampled lattice");
  }
  if (!arithmetic.tap_weight.empty() && arithmetic.tap_weight.size() != distances.size() + 1) {
    throw std::invalid_argument("A measured tap table must cover the centre and every tap");
  }

  std::vector<float> weights(distances.size() + 1);
  weights[0] = arithmetic.tap_weight.empty() ? shader_tap_weight(0.0F, request.uniforms.sigma)
                                             : arithmetic.tap_weight[0];
  for (std::size_t tap = 0; tap < distances.size(); ++tap) {
    weights[tap + 1] = arithmetic.tap_weight.empty()
                           ? shader_tap_weight(distances[tap], request.uniforms.sigma)
                           : arithmetic.tap_weight[tap + 1];
  }

  AxisPassResult result{};
  result.width = source.width;
  result.height = source.height;
  result.taps = static_cast<std::uint32_t>(distances.size());
  const std::size_t pixels = static_cast<std::size_t>(source.width) * source.height;
  result.sums.resize(pixels * 4);
  result.weights.resize(pixels);
  result.centre_alpha.resize(pixels);

  for (std::uint32_t y = 0; y < source.height; ++y) {
    const float v = (static_cast<float>(y) + 0.5F) / static_cast<float>(source.height);
    for (std::uint32_t x = 0; x < source.width; ++x) {
      const float u = (static_cast<float>(x) + 0.5F) / static_cast<float>(source.width);
      const float centre_coordinate = request.axis == PassAxis::horizontal ? u : v;
      const auto centre = decode_tap(sample_lattice(source, u, v), request.uniforms, arithmetic);
      // The centre contribution is a plain multiply by the centre weight, not
      // an accumulate, and the running weight starts at that same value rather
      // than at a literal one.
      std::array<float, 4> sum{};
      for (std::size_t channel = 0; channel < 4; ++channel) sum[channel] = centre[channel] * weights[0];
      float total = weights[0];

      for (std::size_t tap = 0; tap < distances.size(); ++tap) {
        const float weight = weights[tap + 1];
        for (int side = 0; side < 2; ++side) {
          // The recovered loop always evaluates the lower side first; swapping
          // the two changes the accumulation order and therefore the result.
          float coordinate = side == 0 ? centre_coordinate - distances[tap]
                                       : centre_coordinate + distances[tap];
          const bool outside = side == 0 ? coordinate < 0.0F : coordinate > 1.0F;
          if (outside) {
            if (request.uniforms.border == PassBorder::drop) continue;
            if (request.uniforms.border == PassBorder::weight_only) {
              total += weight;
              continue;
            }
            coordinate = request.uniforms.border == PassBorder::clamp
                             ? (side == 0 ? 0.0F : 1.0F)
                             : (side == 0 ? -coordinate : 2.0F - coordinate);
          }
          const float su = request.axis == PassAxis::horizontal ? coordinate : u;
          const float sv = request.axis == PassAxis::horizontal ? v : coordinate;
          const auto tap_value = decode_tap(sample_lattice(source, su, sv), request.uniforms, arithmetic);
          accumulate(sum, tap_value, weight, arithmetic.fused_accumulate);
          total += weight;
        }
      }

      const std::size_t pixel = static_cast<std::size_t>(y) * source.width + x;
      for (std::size_t channel = 0; channel < 4; ++channel) result.sums[pixel * 4 + channel] = sum[channel];
      result.weights[pixel] = total;
      result.centre_alpha[pixel] = centre[3];
    }
  }

  std::vector<float> encoded(pixels * 4);
  for (std::size_t pixel = 0; pixel < pixels; ++pixel) {
    for (std::size_t channel = 0; channel < 4; ++channel) {
      const float divided = result.sums[pixel * 4 + channel] / result.weights[pixel];
      encoded[pixel * 4 + channel] =
          channel < 3 && request.uniforms.inverse_gamma
              ? shader_gamma_encode(divided, request.uniforms.gamma)
              : divided;
    }
  }
  result.bytes = quantize_axis_pass(result, request.uniforms, encoded);
  return result;
}

std::vector<std::uint8_t> quantize_axis_pass(const AxisPassResult& state,
                                             const AxisPassUniforms& uniforms,
                                             std::span<const float> encoded) {
  const std::size_t pixels = state.weights.size();
  if (encoded.size() != pixels * 4 || state.centre_alpha.size() != pixels) {
    throw std::invalid_argument("Encoded tail must carry four values for every pixel");
  }
  std::vector<std::uint8_t> bytes(pixels * 4);
  for (std::size_t pixel = 0; pixel < pixels; ++pixel) {
    for (std::size_t channel = 0; channel < 4; ++channel) {
      const float value = channel == 3 && !uniforms.blur_alpha ? state.centre_alpha[pixel]
                                                               : encoded[pixel * 4 + channel];
      bytes[pixel * 4 + channel] = quantize_unorm8(value);
    }
  }
  return bytes;
}

}  // namespace agfx_contract
