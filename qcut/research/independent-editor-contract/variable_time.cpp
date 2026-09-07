#include "variable_time.hpp"
#include "variable_time_internal.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "The variable-time contract requires IEEE floating-point semantics"
#endif

namespace editor_contract {
using namespace variable_detail;

VariableSpeedCurve::VariableSpeedCurve(std::span<const SpeedControlPoint> points) {
  if (points.size() < 2) throw std::invalid_argument("A continuous speed curve needs at least two points");
  if (points.size() > 4096) throw std::length_error("Speed curve exceeds the independent point budget");
  std::vector<float> source;
  source.reserve(points.size()); speeds_.reserve(points.size());
  for (const auto& point : points) {
    if (!std::isfinite(point.source_fraction) || point.source_fraction < 0 || point.source_fraction > 1 ||
        !std::isfinite(point.speed) || point.speed <= 0 || point.speed > std::numeric_limits<float>::max()) {
      throw std::invalid_argument("Speed points must be finite and representable as positive floats");
    }
    const auto x = static_cast<float>(point.source_fraction);
    const auto y = static_cast<float>(point.speed);
    if (!std::isfinite(point.source_fraction) || !std::isfinite(point.speed) ||
        !std::isfinite(x) || !std::isfinite(y) || x < 0 || x > 1 || y <= 0 ||
        (!source.empty() && x <= source.back())) {
      throw std::invalid_argument("Only finite forward speed curves with distinct float coordinates are verified");
    }
    source.push_back(x); speeds_.push_back(y);
  }
  if (source.front() != 0 || source.back() != 1) throw std::invalid_argument("Speed curve endpoints must be 0 and 1");
  sequence_.resize(source.size());
  float accumulated = 0;
  for (std::size_t i = 1; i < source.size(); ++i) {
    const float average = (speeds_[i] + speeds_[i - 1]) * .5F;
    const float interval = (source[i] - source[i - 1]) / average;
    accumulated = accumulated + interval;
    sequence_[i] = accumulated;
  }
  if (!std::isfinite(accumulated) || accumulated <= 0) throw std::invalid_argument("Speed normalization is degenerate");
  for (std::size_t i = 1; i < sequence_.size(); ++i) {
    sequence_[i] = sequence_[i] / accumulated;
    if (!std::isfinite(sequence_[i]) || sequence_[i] <= sequence_[i - 1]) {
      throw std::invalid_argument("Normalized speed coordinates are degenerate");
    }
  }
}

std::int64_t VariableSpeedCurve::source_to_sequence(std::int64_t query, std::int64_t duration) const {
  validate_duration(duration);
  const double requested = static_cast<double>(std::max<std::int64_t>(query, 0));
  double cumulative = 0;
  for (std::size_t i = 1; i < sequence_.size(); ++i) {
    const Interval part(sequence_[i - 1], sequence_[i], speeds_[i - 1], speeds_[i], duration);
    cumulative = std::fma(part.average, part.width, cumulative);
    if (cumulative <= requested) continue;
    // Native recomputes the prior total from the rounded cumulative sum.
    const double prior = std::fma(-part.average, part.width, cumulative);
    const double remaining = requested - prior;
    if (part.delta_speed == 0) return rounded_time(part.left_time + remaining / part.left_speed);
    const double first_area = (part.first_boundary - part.left_time) * ((part.first_speed + part.left_speed) * .5);
    const double second_average = (part.first_speed + part.second_speed) * .5;
    const double second_area = std::fma(second_average, part.second_boundary - part.first_boundary, first_area);
    double a = 1, b = 0, c = 0;
    if (remaining >= 0 && remaining <= first_area) {
      const double slope = part.outer_slope();
      b = std::fma(-slope, part.left_time, part.left_speed);
      a = slope * .5;
      c = std::fma(slope * -.5, part.left_time * part.left_time, -(b * part.left_time));
    } else if (remaining > first_area && remaining <= second_area) {
      const double slope = part.middle_slope();
      b = std::fma(-slope, part.middle, part.average);
      a = slope * .5;
      c = std::fma(-(a * part.first_boundary), part.first_boundary, first_area);
      c = std::fma(-b, part.first_boundary, c);
    } else if (remaining > second_area && remaining <= part.average * part.width) {
      const double slope = part.outer_slope();
      b = std::fma(-slope, part.right_time, part.right_speed);
      a = slope * .5;
      c = std::fma(-(a * part.second_boundary), part.second_boundary, second_area);
      c = std::fma(-b, part.second_boundary, c);
    } else {
      return 0;
    }
    return rounded_time(solve_integral(a, b, c, remaining));
  }
  return rounded_time(static_cast<double>(sequence_.back()) * static_cast<double>(duration));
}

std::int64_t VariableSpeedCurve::sequence_to_source(std::int64_t query, std::int64_t duration) const {
  validate_duration(duration);
  const auto clamped = std::max<std::int64_t>(query, 0);
  const double requested = static_cast<double>(clamped);
  // Native MUL keeps only the low 64 bits before unsigned conversion to double.
  const auto unsigned_query = static_cast<std::uint64_t>(clamped);
  const double squared = static_cast<double>(unsigned_query * unsigned_query);
  double cumulative = 0;
  for (std::size_t i = 1; i < sequence_.size(); ++i) {
    const Interval part(sequence_[i - 1], sequence_[i], speeds_[i - 1], speeds_[i], duration);
    if (part.right_time < requested) {
      cumulative = std::fma(part.average, part.width, cumulative);
      continue;
    }
    double area = 0;
    if (requested >= part.left_time && requested <= part.first_boundary) {
      const double slope = part.outer_slope();
      const double intercept = std::fma(-slope, part.left_time, part.left_speed);
      const double half_slope = slope * .5;
      area = std::fma(half_slope, squared, intercept * requested);
      area = std::fma(-half_slope, part.left_time * part.left_time, area);
      area = std::fma(-intercept, part.left_time, area);
    } else if (requested > part.first_boundary && requested <= part.second_boundary) {
      const double slope = part.middle_slope();
      const double intercept = std::fma(-slope, part.middle, part.average);
      const double half_slope = slope * .5;
      area = std::fma(half_slope, squared, intercept * requested);
      area = std::fma(-half_slope, part.first_boundary * part.first_boundary, area);
      area = std::fma(-intercept, part.first_boundary, area);
      double first_area = (part.first_boundary - part.left_time) * (part.first_speed + part.left_speed);
      first_area = first_area * .5;
      area = first_area + area;
    } else if (requested > part.second_boundary && requested <= part.right_time) {
      const double slope = part.outer_slope();
      const double intercept = std::fma(-slope, part.right_time, part.right_speed);
      const double half_slope = slope * .5;
      area = std::fma(half_slope, squared, intercept * requested);
      area = std::fma(-half_slope, part.second_boundary * part.second_boundary, area);
      area = std::fma(-intercept, part.second_boundary, area);
      double middle_area = (part.second_boundary - part.first_boundary) * (part.second_speed + part.first_speed);
      middle_area = middle_area * .5;
      area = middle_area + area;
      double first_area = (part.first_boundary - part.left_time) * (part.first_speed + part.left_speed);
      first_area = first_area * .5;
      area = first_area + area;
    }
    return rounded_time(cumulative + area);
  }
  return rounded_time(cumulative);
}
}  // namespace editor_contract
