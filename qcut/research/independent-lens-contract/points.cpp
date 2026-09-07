#include "lens_contract.hpp"

#include <algorithm>
#include <cmath>

namespace lens_contract {
namespace {

bool finite(Point point) {
  return std::isfinite(point.x) && std::isfinite(point.y);
}

bool valid_points(std::span<const Point> points) {
  return points.size() <= max_sample_count &&
         std::all_of(points.begin(), points.end(), finite);
}

void rotate_unchecked(std::span<Point> points, const Rotation& rotation) {
  constexpr float degrees_to_radians = 0.017453299835324287F;
  const float radians = rotation.degrees * degrees_to_radians;
  // A compiler-generated combined sincos call differs from native's two calls.
  static float (*volatile cosine_function)(float) = std::cos;
  static float (*volatile sine_function)(float) = std::sin;
  const float cosine = cosine_function(radians);
  const float sine = sine_function(radians);
  for (auto& point : points) {
    const float x = point.x + -rotation.center.x;
    const float y = point.y + -rotation.center.y;
    point.x = (cosine * x + -sine * y) + rotation.center.x;
    point.y = (sine * x + cosine * y) + rotation.center.y;
  }
}

}  // namespace

bool rotate_points(std::span<const Point> input, const Rotation& rotation,
            std::vector<Point>& output) {
  if (!valid_points(input) || !std::isfinite(rotation.degrees) ||
      !finite(rotation.center)) return false;
  std::vector<Point> candidate(input.begin(), input.end());
  rotate_unchecked(candidate, rotation);
  if (!valid_points(candidate)) return false;
  output.swap(candidate);
  return true;
}

bool warp_points(std::span<const Point> input, const RigidTransform& transform,
                 std::vector<Point>& output) {
  if (!valid_points(input) || !std::isfinite(transform.translation_x) ||
      !std::isfinite(transform.translation_y) || !std::isfinite(transform.degrees) ||
      !std::isfinite(transform.scale)) return false;
  std::vector<Point> candidate(input.begin(), input.end());
  for (auto& point : candidate) {
    point.x += -transform.translation_x;
    point.y += -transform.translation_y;
  }
  rotate_unchecked(candidate, {transform.degrees, {0.0F, 0.0F}});
  for (auto& point : candidate) {
    point.x *= transform.scale;
    point.y *= transform.scale;
  }
  if (!valid_points(candidate)) return false;
  output.swap(candidate);
  return true;
}

}  // namespace lens_contract
