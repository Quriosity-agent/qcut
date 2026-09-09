#pragma once

#include "integer_time.hpp"

#include <stdexcept>

namespace editor_contract::variable_detail {
constexpr double kSpeedShape = static_cast<double>(.8F);
constexpr double kTimeShape = static_cast<double>(.2951F);

inline std::int64_t rounded_time(double value) noexcept {
  return truncate_time(std::floor(value + .5));
}

inline void validate_duration(std::int64_t duration) {
  if (duration <= 0) throw std::invalid_argument("Variable speed requires a positive sequence duration");
}

struct Interval {
  double left_time, right_time, width, middle, left_speed, right_speed, delta_speed, average;
  double first_boundary, second_boundary, first_speed, second_speed;

  Interval(float x0, float x1, float y0, float y1, std::int64_t duration)
      : left_time(static_cast<double>(x0) * static_cast<double>(duration)),
        right_time(static_cast<double>(x1) * static_cast<double>(duration)),
        width(static_cast<double>(duration) * static_cast<double>(x1 - x0)),
        middle((static_cast<double>(duration) * static_cast<double>(x0 + x1)) * .5),
        left_speed(y0), right_speed(y1), delta_speed(y1 - y0),
        average(static_cast<double>(y0 + y1) * .5),
        first_boundary(std::fma(-width, kTimeShape, middle)),
        second_boundary(std::fma(width, kTimeShape, middle)),
        first_speed(average - (kSpeedShape * delta_speed) * .5),
        second_speed(average + (kSpeedShape * delta_speed) * .5) {}

  double outer_slope() const {
    return ((1 - kSpeedShape) * delta_speed) / (width * std::fma(kTimeShape, -2, 1));
  }
  double middle_slope() const {
    return (kSpeedShape * delta_speed) / ((width + width) * kTimeShape);
  }
};

inline double solve_integral(double quadratic, double linear, double constant, double source) {
  const double four_a = quadratic * 4;
  const double shifted = std::fma(four_a, source, -(four_a * constant));
  const double discriminant = std::fma(linear, linear, shifted);
  return (std::sqrt(discriminant) - linear) / (quadratic + quadratic);
}
}  // namespace editor_contract::variable_detail
