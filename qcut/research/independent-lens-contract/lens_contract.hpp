#pragma once

#include <array>
#include <cstddef>
#include <limits>
#include <span>
#include <vector>

#if defined(__FAST_MATH__) || (defined(__FINITE_MATH_ONLY__) && __FINITE_MATH_ONLY__)
#error "Lens contract requires finite-value checks and ordered IEEE arithmetic"
#endif

namespace lens_contract {

static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);

using Matrix3 = std::array<double, 9>;

struct Point {
  float x;
  float y;
  bool operator==(const Point&) const = default;
};

struct Rotation {
  float degrees;
  Point center;
};

struct RigidTransform {
  float translation_x;
  float translation_y;
  float degrees;
  float scale;
};

struct GaussianRequest {
  int length;
  double sigma;
};

constexpr int max_kernel_length = 4095;
constexpr std::size_t max_sample_count = 1U << 20;

// All failures preserve output. Finite-domain guards are QCut policy.
bool multiply(const Matrix3& left, const Matrix3& right, Matrix3& output) noexcept;
bool inverse(const Matrix3& input, Matrix3& output) noexcept;
bool rotate_points(std::span<const Point> input, const Rotation& rotation,
            std::vector<Point>& output);
bool warp_points(std::span<const Point> input, const RigidTransform& transform,
                 std::vector<Point>& output);
bool gaussian_kernel(const GaussianRequest& request, std::vector<double>& output);
bool gaussian_smooth(std::span<const float> input, const GaussianRequest& request,
                     std::vector<float>& output);

}  // namespace lens_contract
