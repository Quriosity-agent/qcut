#pragma once

#include "gl_fragment_profile.hpp"

#include <cmath>
#include <string>

namespace agfx_test {

// Deliberately wrong variants of the recovered fragment pass. Each is a single
// localized error of the kind a careless reading produces, and each is compiled
// and run before it is rejected — a variant that does not build proves nothing.
//
// `faithful` must reproduce gl_fragment_profile.cpp exactly. Anything else is
// reported as detected or not detected, and a variant that survives is left in
// the list with its reason rather than deleted.
enum class FragmentMutation : unsigned {
  faithful = 0,
  plus_side_first,        // the upper tap is accumulated before the lower one
  border_credits_weight,  // a dropped tap still adds its weight to the divisor
  weight_via_exp2,        // exp(x) rewritten as exp2(x * log2(e))
  weight_ratio_first,     // the sigma division moved inside the square
  centre_weight_literal,  // the centre weight replaced by a literal one
  ties_to_even,           // the output rounds half to even instead of away
  generic_bilinear,       // plain float bilinear instead of the M4 lattice
  reciprocal_divide,      // the closing divide replaced by a reciprocal multiply
  fused_accumulate,       // the accumulate is fused instead of separately rounded
  gamma_skips_alpha_read, // the alpha channel also takes the gamma round trip
  tap_count_rounds_up,    // the loop bound rounds the sample count up
  encode_before_divide,   // the gamma encode moved ahead of the normalization
  lattice_byte_scale,     // the sampler lattice read as 1/255 instead of 1/4080
  count
};

inline std::string fragment_mutation_name(FragmentMutation mutation) {
  switch (mutation) {
    case FragmentMutation::faithful: return "faithful";
    case FragmentMutation::plus_side_first: return "plus_side_first";
    case FragmentMutation::border_credits_weight: return "border_credits_weight";
    case FragmentMutation::weight_via_exp2: return "weight_via_exp2";
    case FragmentMutation::weight_ratio_first: return "weight_ratio_first";
    case FragmentMutation::centre_weight_literal: return "centre_weight_literal";
    case FragmentMutation::ties_to_even: return "ties_to_even";
    case FragmentMutation::generic_bilinear: return "generic_bilinear";
    case FragmentMutation::reciprocal_divide: return "reciprocal_divide";
    case FragmentMutation::fused_accumulate: return "fused_accumulate";
    case FragmentMutation::gamma_skips_alpha_read: return "gamma_skips_alpha_read";
    case FragmentMutation::tap_count_rounds_up: return "tap_count_rounds_up";
    case FragmentMutation::encode_before_divide: return "encode_before_divide";
    case FragmentMutation::lattice_byte_scale: return "lattice_byte_scale";
    case FragmentMutation::count: break;
  }
  return "unknown";
}

namespace fragment_mutation_detail {

inline std::uint8_t quantize(float value, FragmentMutation mutation) {
  if (mutation != FragmentMutation::ties_to_even) return agfx_contract::quantize_unorm8(value);
  const float saturated =
      std::isnan(value) ? 0.0F : (value < 0.0F ? 0.0F : (value > 1.0F ? 1.0F : value));
  return static_cast<std::uint8_t>(std::nearbyint(static_cast<double>(saturated) * 255.0));
}

inline float weight(float distance, float sigma, FragmentMutation mutation) {
  if (mutation == FragmentMutation::weight_via_exp2) {
    return std::exp2((((-0.5F) * distance) * distance) / (sigma * sigma) * 0x1.715476p+0F);
  }
  if (mutation == FragmentMutation::weight_ratio_first) {
    const float ratio = distance / sigma;
    return std::exp((-0.5F) * ratio * ratio);
  }
  return agfx_contract::shader_tap_weight(distance, sigma);
}

// Plain float bilinear over the same clamped footprint: no fixed-point weight,
// no byte-scale intermediate, no lattice. This is what a reader who assumed the
// sampler was "just bilinear" would write.
inline std::array<float, 4> generic_bilinear(const agfx_contract::TextureView& source, float u,
                                             float v) {
  const auto axis = [](float coordinate, std::uint32_t extent) {
    const float position = coordinate * static_cast<float>(extent) - 0.5F;
    const float base = std::floor(position);
    const auto index = static_cast<std::int64_t>(base);
    const auto clamp = [extent](std::int64_t value) {
      if (value < 0) return std::int64_t{0};
      const auto last = static_cast<std::int64_t>(extent) - 1;
      return value > last ? last : value;
    };
    return std::array<double, 3>{static_cast<double>(clamp(index)),
                                 static_cast<double>(clamp(index + 1)),
                                 static_cast<double>(position - base)};
  };
  const auto column = axis(u, source.width);
  const auto row = axis(v, source.height);
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < 4; ++channel) {
    double total = 0;
    for (int y = 0; y < 2; ++y) {
      for (int x = 0; x < 2; ++x) {
        const auto index = static_cast<std::size_t>(row[static_cast<std::size_t>(y)]) * source.row_stride +
                           static_cast<std::size_t>(column[static_cast<std::size_t>(x)]) * 4 + channel;
        const double weight_x = x == 0 ? 1.0 - column[2] : column[2];
        const double weight_y = y == 0 ? 1.0 - row[2] : row[2];
        total += static_cast<double>(source.bytes[index]) / 255.0 * weight_x * weight_y;
      }
    }
    result[channel] = static_cast<float>(total);
  }
  return result;
}

}  // namespace fragment_mutation_detail

// Runs the pass under one mutation. The faithful path defers to the contract so
// the two cannot drift apart; every other path re-implements only the part it
// corrupts and shares the rest.
// `encoded` optionally receives the four values per pixel the pass holds just
// before quantization. A variant that leaves those untouched is not a variant
// at all; one that changes them without changing a byte is a variant the
// eight-bit output cannot see. The two cases must not be reported alike.
inline std::vector<std::uint8_t> run_mutated_axis_pass(FragmentMutation mutation,
                                                       const agfx_contract::AxisPassRequest& request,
                                                       std::vector<float>* encoded = nullptr) {
  using namespace agfx_contract;
  if (mutation == FragmentMutation::faithful) {
    const auto state = run_axis_pass(request);
    if (encoded) {
      encoded->assign(state.weights.size() * 4, 0.0F);
      for (std::size_t pixel = 0; pixel < state.weights.size(); ++pixel) {
        for (std::size_t channel = 0; channel < 4; ++channel) {
          const float divided = state.sums[pixel * 4 + channel] / state.weights[pixel];
          (*encoded)[pixel * 4 + channel] =
              channel == 3 && !request.uniforms.blur_alpha ? state.centre_alpha[pixel]
              : channel < 3 && request.uniforms.inverse_gamma
                  ? shader_gamma_encode(divided, request.uniforms.gamma)
                  : divided;
        }
      }
    }
    return state.bytes;
  }

  const TextureView source = validate_texture_view(request.source);
  const auto& uniforms = request.uniforms;
  auto distances = axis_tap_distances(uniforms);
  if (mutation == FragmentMutation::tap_count_rounds_up &&
      static_cast<float>(distances.size() + 1) <= std::ceil(uniforms.sample_count)) {
    distances.push_back(static_cast<float>(distances.size() + 1) * uniforms.step);
  }
  const bool fused = mutation == FragmentMutation::fused_accumulate;

  std::vector<float> weights(distances.size() + 1);
  weights[0] = mutation == FragmentMutation::centre_weight_literal
                   ? 1.0F
                   : fragment_mutation_detail::weight(0.0F, uniforms.sigma, mutation);
  for (std::size_t tap = 0; tap < distances.size(); ++tap) {
    weights[tap + 1] = fragment_mutation_detail::weight(distances[tap], uniforms.sigma, mutation);
  }

  const std::array<TextureView, 1> levels{source};
  const auto tap_value = [&](float u, float v) {
    std::array<float, 4> value{};
    if (mutation == FragmentMutation::generic_bilinear) {
      value = fragment_mutation_detail::generic_bilinear(source, u, v);
    } else {
      MipTextureRequest sample_request{};
      sample_request.levels = levels;
      sample_request.point = {u, v, .5F};
      sample_request.lod = 0.0F;
      sample_request.settings.filter = TexelFilter::linear;
      sample_request.settings.wrap_s = TexelWrap::clamp;
      sample_request.settings.wrap_t = TexelWrap::clamp;
      sample_request.settings.wrap_r = TexelWrap::clamp;
      sample_request.filter = MipFilter::none;
      value = sample_m4_texture(sample_request);
      if (mutation == FragmentMutation::lattice_byte_scale) {
        // The sampler's fixed-point intermediate is byte-times-sixteen, so its
        // output lattice is 1/4080 and not the 1/255 a reader who stopped at
        // "eight-bit texture" would assume.
        for (auto& channel : value) {
          channel = static_cast<float>(std::lround(static_cast<double>(channel) * 255.0)) / 255.0F;
        }
      }
    }
    if (uniforms.inverse_gamma) {
      const std::size_t last =
          mutation == FragmentMutation::gamma_skips_alpha_read ? 4 : 3;
      for (std::size_t channel = 0; channel < last; ++channel) {
        value[channel] = shader_gamma_decode(value[channel], uniforms.gamma);
      }
    }
    return value;
  };

  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(source.width) * source.height * 4);
  if (encoded) encoded->assign(bytes.size(), 0.0F);
  for (std::uint32_t y = 0; y < source.height; ++y) {
    const float v = (static_cast<float>(y) + 0.5F) / static_cast<float>(source.height);
    for (std::uint32_t x = 0; x < source.width; ++x) {
      const float u = (static_cast<float>(x) + 0.5F) / static_cast<float>(source.width);
      const float centre_coordinate = request.axis == PassAxis::horizontal ? u : v;
      const auto centre = tap_value(u, v);
      std::array<float, 4> sum{};
      for (std::size_t channel = 0; channel < 4; ++channel) sum[channel] = centre[channel] * weights[0];
      float total = weights[0];
      for (std::size_t tap = 0; tap < distances.size(); ++tap) {
        const float weight = weights[tap + 1];
        for (int order = 0; order < 2; ++order) {
          const int side = mutation == FragmentMutation::plus_side_first ? 1 - order : order;
          float coordinate = side == 0 ? centre_coordinate - distances[tap]
                                       : centre_coordinate + distances[tap];
          const bool outside = side == 0 ? coordinate < 0.0F : coordinate > 1.0F;
          if (outside) {
            if (uniforms.border == PassBorder::drop) {
              if (mutation == FragmentMutation::border_credits_weight) total += weight;
              continue;
            }
            if (uniforms.border == PassBorder::weight_only) {
              total += weight;
              continue;
            }
            coordinate = uniforms.border == PassBorder::clamp ? (side == 0 ? 0.0F : 1.0F)
                                                              : (side == 0 ? -coordinate : 2.0F - coordinate);
          }
          const auto value = tap_value(request.axis == PassAxis::horizontal ? coordinate : u,
                                       request.axis == PassAxis::horizontal ? v : coordinate);
          for (std::size_t channel = 0; channel < 4; ++channel) {
            sum[channel] = fused ? std::fma(value[channel], weight, sum[channel])
                                 : sum[channel] + value[channel] * weight;
          }
          total += weight;
        }
      }
      const std::size_t pixel = static_cast<std::size_t>(y) * source.width + x;
      for (std::size_t channel = 0; channel < 4; ++channel) {
        const bool encodes = channel < 3 && uniforms.inverse_gamma;
        float value = sum[channel];
        if (encodes && mutation == FragmentMutation::encode_before_divide) {
          value = shader_gamma_encode(value, uniforms.gamma);
        }
        value = mutation == FragmentMutation::reciprocal_divide ? value * (1.0F / total)
                                                                : value / total;
        if (encodes && mutation != FragmentMutation::encode_before_divide) {
          value = shader_gamma_encode(value, uniforms.gamma);
        }
        if (channel == 3 && !uniforms.blur_alpha) value = centre[3];
        if (encoded) (*encoded)[pixel * 4 + channel] = value;
        bytes[pixel * 4 + channel] = fragment_mutation_detail::quantize(value, mutation);
      }
    }
  }
  return bytes;
}

}  // namespace agfx_test
