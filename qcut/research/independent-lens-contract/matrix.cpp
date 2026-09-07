#include "lens_contract.hpp"

#include <algorithm>
#include <cmath>

namespace lens_contract {
namespace {

bool finite(const Matrix3& matrix) {
  return std::all_of(matrix.begin(), matrix.end(),
                     [](double value) { return std::isfinite(value); });
}

}  // namespace

bool multiply(const Matrix3& a, const Matrix3& b, Matrix3& output) noexcept {
  if (!finite(a) || !finite(b)) return false;

  // The 23-product evaluation order is observable in floating-point results.
  const double p0 = (a[0] + a[1] + a[2] - a[3] - a[4] - a[7] - a[8]) * b[4];
  const double p1 = (a[0] - a[3]) * (-b[1] + b[4]);
  const double p2 = a[4] * (-b[0] + b[1] + b[3] - b[4] - b[5] - b[6] + b[8]);
  const double p3 = (-a[0] + a[3] + a[4]) * (b[0] - b[1] + b[4]);
  const double p4 = (a[3] + a[4]) * (-b[0] + b[1]);
  const double p5 = a[0] * b[0];
  const double p6 = (-a[0] + a[6] + a[7]) * (b[0] - b[2] + b[5]);
  const double p7 = (-a[0] + a[6]) * (b[2] - b[5]);
  const double p8 = (a[6] + a[7]) * (-b[0] + b[2]);
  const double p9 = (a[0] + a[1] + a[2] - a[4] - a[5] - a[6] - a[7]) * b[5];
  const double p10 = a[7] * (-b[0] + b[2] + b[3] - b[4] - b[5] - b[6] + b[7]);
  const double p11 = (-a[2] + a[7] + a[8]) * (b[4] + b[6] - b[7]);
  const double p12 = (a[2] - a[8]) * (b[4] - b[7]);
  const double p13 = a[2] * b[6];
  const double p14 = (a[7] + a[8]) * (-b[6] + b[7]);
  const double p15 = (-a[2] + a[4] + a[5]) * (b[5] + b[6] - b[8]);
  const double p16 = (a[2] - a[5]) * (b[5] - b[8]);
  const double p17 = (a[4] + a[5]) * (-b[6] + b[8]);
  const double p18 = a[1] * b[3];
  const double p19 = a[5] * b[7];
  const double p20 = a[3] * b[2];
  const double p21 = a[6] * b[1];
  const double p22 = a[8] * b[8];
  const Matrix3 candidate{
      p5 + p13 + p18,
      p0 + p3 + p4 + p5 + p11 + p13 + p14,
      p5 + p6 + p8 + p9 + p13 + p15 + p17,
      p1 + p2 + p3 + p5 + p13 + p15 + p16,
      p1 + p3 + p4 + p5 + p19,
      p13 + p15 + p16 + p17 + p20,
      p5 + p6 + p7 + p10 + p11 + p12 + p13,
      p11 + p12 + p13 + p14 + p21,
      p5 + p6 + p7 + p8 + p22};
  if (!finite(candidate)) return false;
  output = candidate;
  return true;
}

bool inverse(const Matrix3& m, Matrix3& output) noexcept {
  if (!finite(m)) return false;
  const double determinant =
      m[0] * (m[4] * m[8] - m[7] * m[5]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (!std::isfinite(determinant) || determinant == 0.0) return false;
  const double reciprocal = 1.0 / determinant;
  const Matrix3 candidate{
      (m[4] * m[8] - m[7] * m[5]) * reciprocal,
      (m[2] * m[7] - m[1] * m[8]) * reciprocal,
      (m[1] * m[5] - m[2] * m[4]) * reciprocal,
      (m[5] * m[6] - m[3] * m[8]) * reciprocal,
      (m[0] * m[8] - m[2] * m[6]) * reciprocal,
      (m[3] * m[2] - m[0] * m[5]) * reciprocal,
      (m[3] * m[7] - m[6] * m[4]) * reciprocal,
      (m[6] * m[1] - m[0] * m[7]) * reciprocal,
      (m[0] * m[4] - m[3] * m[1]) * reciprocal};
  if (!finite(candidate)) return false;
  output = candidate;
  return true;
}

}  // namespace lens_contract
