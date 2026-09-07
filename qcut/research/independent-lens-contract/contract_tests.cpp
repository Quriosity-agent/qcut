#include "lens_contract.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>

namespace {
using namespace lens_contract;

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

bool close(double left, double right, double tolerance = 1e-12) {
  return std::isfinite(left) && std::isfinite(right) &&
         std::abs(left - right) <= tolerance;
}

void matrices() {
  const Matrix3 identity{1, 0, 0, 0, 1, 0, 0, 0, 1};
  const Matrix3 a{1, 2, 3, 0, 1, 4, 5, 6, 0};
  const Matrix3 b{-2, 1, 0, 3, 0, 1, 4, -1, 2};
  Matrix3 result{};
  require(multiply(a, b, result), "Matrix multiplication rejected");
  require(result == Matrix3{16, -2, 8, 19, -4, 9, 8, 5, 6},
          "Matrix order or row-major layout changed");
  require(inverse(a, result), "Invertible matrix rejected");
  require(result == Matrix3{-24, 18, 5, 20, -15, -4, -5, 4, 1},
          "Inverse cofactor arrangement changed");
  Matrix3 restored{};
  require(multiply(a, result, restored) && restored == identity,
          "Inverse does not compose to identity");
  result = a;
  require(multiply(result, b, result) && result[0] == 16,
          "Aliased multiply output is unsafe");
  result = a;
  require(inverse(result, result) && result[0] == -24,
          "Aliased inverse output is unsafe");

  const Matrix3 sentinel{9, 8, 7, 6, 5, 4, 3, 2, 1};
  result = sentinel;
  require(!inverse(Matrix3{}, result) && result == sentinel,
          "Singular inverse changed output");
  for (double invalid : {std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::quiet_NaN()}) {
    for (std::size_t index = 0; index < a.size(); ++index) {
      Matrix3 damaged = a;
      damaged[index] = invalid;
      require(!inverse(damaged, result) && result == sentinel,
              "Nonfinite inverse changed output");
      require(!multiply(damaged, b, result) && result == sentinel,
              "Nonfinite product changed output");
    }
  }
  Matrix3 extreme = identity;
  extreme[0] = std::numeric_limits<double>::max();
  require(!multiply(extreme, extreme, result) && result == sentinel,
          "Overflowing multiplication was accepted");
}

void kernels_and_smoothing() {
  std::vector<double> weights;
  require(gaussian_kernel({3, 1.0}, weights), "Length-three kernel rejected");
  const std::vector<double> native_three{
      0.087049355438259091, 0.82590128912348182, 0.087049355438259091};
  for (std::size_t index = 0; index < weights.size(); ++index) {
    require(close(weights[index], native_three[index], 2e-15),
            "Pinned Gaussian shape changed");
  }
  require(gaussian_kernel({4, 1.0}, weights) && weights.size() == 4,
          "Even kernel length changed");
  require(close(weights[0], 0.047674732449554745, 2e-15) &&
              weights[1] == weights[2],
          "Even kernel did not duplicate its center");
  for (int length = 1; length <= 65; ++length) {
    require(gaussian_kernel({length, 0.7}, weights), "Valid kernel rejected");
    require(weights.size() == static_cast<std::size_t>(length),
            "Kernel length mismatch");
    require(close(std::accumulate(weights.begin(), weights.end(), 0.0), 1.0),
            "Kernel normalization changed");
    require(std::equal(weights.begin(), weights.end(), weights.rbegin()),
            "Kernel symmetry changed");
  }
  std::vector<float> output;
  const std::vector<float> impulse{0, 0, 1, 0, 0};
  require(gaussian_smooth(impulse, {3, 1.0}, output), "Smooth impulse rejected");
  require(output == std::vector<float>{0, 0.08704935759305954F,
                                      0.82590126991271973F,
                                      0.08704935759305954F, 0},
          "Impulse response differs from native fixture");
  require(gaussian_smooth(std::vector<float>{1, 0, 0}, {3, 1.0}, output),
          "Boundary impulse rejected");
  require(close(output[0], 0.91295063495635986, 1e-7) && output[2] == 0,
          "Boundary no longer replicates the nearest sample");
  require(gaussian_smooth(std::vector<float>{4.5F}, {65, 3.0}, output) &&
              output == std::vector<float>{4.5F},
          "Window wider than the input changed a constant");
  require(gaussian_smooth({}, {3, 1.0}, output) && output.empty(),
          "Empty sequence changed behavior");
  output = impulse;
  require(gaussian_smooth(output, {3, 1.0}, output) && output[0] == 0,
          "Aliased smoothing failed");

  const std::vector<double> weight_sentinel{8, 9};
  const std::vector<float> sentinel{8, 9};
  weights = weight_sentinel;
  output = sentinel;
  for (const GaussianRequest invalid :
       {GaussianRequest{0, 1}, {-1, 1}, {4096, 1}, {3, 0}, {3, -1},
        {3, std::numeric_limits<double>::infinity()},
        {3, std::numeric_limits<double>::quiet_NaN()}, {3, 1e-300}, {3, 1e300}}) {
    require(!gaussian_kernel(invalid, weights) && weights == weight_sentinel,
            "Invalid kernel did not fail atomically");
    require(!gaussian_smooth(impulse, invalid, output) && output == sentinel,
            "Invalid smoothing did not fail atomically");
  }
  require(!gaussian_smooth(impulse, {4, 1}, output) && output == sentinel,
          "Unsafe even smoothing window accepted");
  require(!gaussian_smooth(std::vector<float>{1, std::numeric_limits<float>::quiet_NaN()},
                           {3, 1}, output) && output == sentinel,
          "Nonfinite sequence changed output");
}

void point_transforms() {
  const std::vector<Point> input{{1, 0}, {0, 1}, {-4, 5}};
  std::vector<Point> result;
  require(rotate_points(input, {90, {0, 0}}, result), "Rotation rejected");
  require(result[0] == Point{-6.3975784314607154e-7F, 1},
          "Native degree conversion was replaced by ideal pi/180");
  require(rotate_points(std::vector<Point>{{4, 8}}, {53, {4, 8}}, result) &&
              result[0] == Point{4, 8},
          "Rotation center moved");
  require(warp_points(std::vector<Point>{{5, 8}}, {2, 3, 0, 2}, result) &&
              result[0] == Point{6, 10},
          "Warp translation sign or scale order changed");
  require(warp_points(input, {0, 0, 0, 0}, result) &&
              std::all_of(result.begin(), result.end(),
                          [](Point point) { return point == Point{0, 0}; }),
          "Zero scale should collapse points");
  result = input;
  require(rotate_points(result, {0, {0, 0}}, result) && result == input,
          "Aliased rotation failed");
  require(rotate_points({}, {180, {0, 0}}, result) && result.empty(),
          "Empty rotation failed");
  result = input;
  const float nan = std::numeric_limits<float>::quiet_NaN();
  require(!rotate_points(input, {nan, {0, 0}}, result) && result == input,
          "Nonfinite angle changed output");
  require(!warp_points(input, {0, nan, 0, 1}, result) && result == input,
          "Nonfinite transform changed output");
  require(!rotate_points(std::vector<Point>{{nan, 0}}, {0, {0, 0}}, result) &&
              result == input,
          "Nonfinite point changed output");
}
}  // namespace

int main() {
  try {
    matrices();
    kernels_and_smoothing();
    point_transforms();
    std::cout << "Lens contract: matrix order/inverse, Gaussian shape/borders, "
                 "point transforms, aliasing and atomic rejection passed.\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
