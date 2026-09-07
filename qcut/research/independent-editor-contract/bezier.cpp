#include "bezier.hpp"

#include <cmath>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The editor contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
namespace {

struct CubicTime {
  float cubic;
  float quadratic;
  float linear;

  float at(float t) const noexcept {
    const float first = t * cubic + quadratic;
    const float second = linear + t * first;
    return t * second;
  }
  float derivative(float t) const noexcept {
    const float first = (cubic * 3.0F) * t;
    const float second = first + (quadratic + quadratic);
    return linear + second * t;
  }
};

float solve_time(const CubicTime& time, float progress) noexcept {
  constexpr float endpoint_epsilon = 1.0e-6F;
  constexpr float residual_epsilon = 1.0e-3F;
  if (progress < 0 || std::fabs(progress) < endpoint_epsilon) return 0;
  if (progress > 1 || std::fabs(progress - 1) < endpoint_epsilon) return 1;
  float candidate = progress;
  for (int iteration = 0; iteration < 8; ++iteration) {
    const float current = time.at(candidate);
    if (std::fabs(current - progress) < residual_epsilon) return candidate;
    const float slope = time.derivative(candidate);
    if (std::fabs(slope) < endpoint_epsilon) break;
    candidate = std::fmax(std::fmin(candidate - (current - progress) / slope, 1.0F), 0.0F);
  }
  float lower = 0;
  float upper = 1;
  while (lower < upper && std::fabs(upper - lower) > endpoint_epsilon) {
    const float midpoint = lower + (upper - lower) * 0.5F;
    const float current = time.at(midpoint);
    if (current < progress) lower = midpoint;
    else upper = midpoint;
    if (std::fabs(current - progress) < residual_epsilon) return midpoint;
  }
  // Exhausting bisection returns the last Newton candidate, not the last midpoint.
  return std::isnan(candidate) ? candidate : std::fmin(candidate, 1.0F);
}

float value_at(const CubicCurve& curve, float t) noexcept {
  const float remaining = 1.0F - t;
  const float first = remaining * (remaining * curve.points[0].value);
  const float second = remaining * (remaining * ((curve.points[1].value * 3.0F) * t));
  const float first_pair = std::fma(first, remaining, second);
  const float third = t * ((curve.points[2].value * 3.0F) * t);
  const float first_three = std::fma(third, remaining, first_pair);
  const float fourth = t * (t * curve.points[3].value);
  return std::fma(fourth, t, first_three);
}

}  // namespace

float evaluate_cubic(const CubicCurve& curve, float progress) noexcept {
  const auto& p = curve.points;
  const float span = p[3].time - p[0].time;
  const float first = (p[1].time - p[0].time) / span;
  const float second = (p[2].time - p[0].time) / span;
  const float second_times_three = second * 3.0F;
  const float first_times_three = first * 3.0F;
  const CubicTime time{first_times_three + (1.0F - second_times_three),
                       second_times_three + first * -6.0F, first_times_three};
  return value_at(curve, solve_time(time, progress));
}

}  // namespace editor_contract
