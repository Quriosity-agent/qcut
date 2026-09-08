#include "motion_constraint.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>

namespace lens_contract {
namespace {
constexpr float motion_epsilon = 1.0e-5F;

bool bounded(float value, float low, float high) {
  return std::isfinite(value) && value >= low && value <= high;
}

float minimum(float a, float b) {
  if (a == 0.0F && b == 0.0F) {
    return std::signbit(a) || std::signbit(b) ? -0.0F : 0.0F;
  }
  return std::min(a, b);
}

float maximum(float a, float b) {
  if (a == 0.0F && b == 0.0F) {
    return std::signbit(a) && std::signbit(b) ? -0.0F : 0.0F;
  }
  return std::max(a, b);
}

void scale_points(std::vector<Point>& points, Point center, float scale) {
  for (auto& point : points) {
    point.x = ((point.x + -center.x) * scale) + center.x;
    point.y = ((point.y + -center.y) * scale) + center.y;
  }
}

bool inside(std::span<const Point> points, const MotionConstraint& constraint) {
  const float right = constraint.width - 1.0F;
  const float bottom = constraint.height - 1.0F;
  return std::all_of(points.begin(), points.end(), [=](Point point) {
    return point.x >= 0.0F && point.x <= right && point.y >= 0.0F && point.y <= bottom;
  });
}

struct Bounds {
  float left;
  float top;
  float right;
  float bottom;
  bool has_area() const { return right - left >= 1.0F && bottom - top >= 1.0F; }
};

Bounds bounds(std::span<const Point> points) {
  Bounds result{points.front().x, points.front().y, points.front().x, points.front().y};
  for (Point point : points.subspan(1)) {
    result.left = minimum(result.left, point.x);
    result.top = minimum(result.top, point.y);
    result.right = maximum(result.right, point.x);
    result.bottom = maximum(result.bottom, point.y);
  }
  return result;
}

float restrict_rotation(const std::vector<Point>& points, float degrees,
                        const MotionConstraint& constraint) {
  std::vector<Point> rotated;
  rotate_points(points, {degrees, constraint.center}, rotated);
  if (inside(rotated, constraint)) return degrees;
  float accepted = 0.0F;
  float rejected = degrees;
  float candidate = degrees;
  float previous = degrees;
  for (unsigned iteration = 0; iteration < 30; ++iteration) {
    const bool searching = degrees < 0.0F ? rejected < accepted : rejected > accepted;
    if (!searching) break;
    candidate = accepted + (rejected - accepted) / 2.0F;
    const float delta = candidate - previous;
    // Native rotates the previous polygon, retaining accumulated binary32 error.
    rotate_points(rotated, {delta, constraint.center}, rotated);
    const bool fits = inside(rotated, constraint);
    if (std::abs(delta) < motion_epsilon && fits) break;
    if (fits) accepted = candidate;
    else rejected = candidate;
    previous = candidate;
  }
  // Native returns the last candidate, including a last rejected candidate.
  return candidate;
}

float clip_translation(float value, float extent, float low, float high) {
  const float first = -low;
  const float second = (extent - 1.0F) - high;
  return minimum(maximum(value, minimum(first, second)), maximum(first, second));
}

bool active(float value) { return value > motion_epsilon || value < -motion_epsilon; }
}  // namespace

bool constrain_motion(const MotionConstraint& constraint,
                      const RigidTransform& input, RigidTransform& output) {
  if (std::fegetround() != FE_TONEAREST ||
      !bounded(constraint.width, 1.0F, 32768.0F) ||
      !bounded(constraint.height, 1.0F, 32768.0F) ||
      !bounded(constraint.center.x, 0.0F, constraint.width) ||
      !bounded(constraint.center.y, 0.0F, constraint.height) ||
      !bounded(constraint.minimum_scale, 0.01F, 1.0F) ||
      !bounded(input.scale, -4.0F, 4.0F) || !bounded(input.degrees, -180.0F, 180.0F) ||
      !bounded(input.translation_x, -4.0F * constraint.width, 4.0F * constraint.width) ||
      !bounded(input.translation_y, -4.0F * constraint.height, 4.0F * constraint.height)) {
    return false;
  }
  RigidTransform result = input;
  result.scale = maximum(minimum(input.scale, 1.0F), constraint.minimum_scale);
  std::vector<Point> polygon{{0.0F, 0.0F}, {constraint.width - 1.0F, 0.0F},
                             {constraint.width - 1.0F, constraint.height - 1.0F},
                             {0.0F, constraint.height - 1.0F}};
  scale_points(polygon, constraint.center, result.scale);
  if (active(result.degrees)) {
    if (bounds(polygon).has_area()) {
      result.degrees = restrict_rotation(polygon, result.degrees, constraint);
    }
    // Border mode 11 does not change scale, but native still crops by scale/scale.
    scale_points(polygon, constraint.center, result.scale / result.scale);
    rotate_points(polygon, {result.degrees, constraint.center}, polygon);
  }
  if (active(result.translation_x) || active(result.translation_y)) {
    const Bounds rectangle = bounds(polygon);
    if (rectangle.has_area()) {
      result.translation_x = clip_translation(result.translation_x, constraint.width,
                                              rectangle.left, rectangle.right);
      result.translation_y = clip_translation(result.translation_y, constraint.height,
                                              rectangle.top, rectangle.bottom);
    }
  }
  output = result;
  return true;
}
}  // namespace lens_contract
