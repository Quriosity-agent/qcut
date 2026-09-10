#include "rigid_lock_conversion.hpp"

#include <bit>
#include <cfenv>
#include <cmath>
#include <cstdint>

namespace lens_contract {
namespace {

// Native spells the degree factor 0.01745f. That is NOT pi/180 (0x3c8efa35)
// and NOT the 0.017453299835324287f the recovered rotate_points uses; the
// reverse factor below IS exactly float(180/pi). Do not "fix" the asymmetry:
// it is what makes the two directions fail to round trip, and the pinned
// goldens plus the native oracle both reject either substitution.
constexpr float degrees_to_radians = 0.01745F;
constexpr float radians_to_degrees = 57.295780181884766F;
static_assert(std::bit_cast<std::uint32_t>(degrees_to_radians) == 0x3c8ef34dU);
static_assert(std::bit_cast<std::uint32_t>(radians_to_degrees) == 0x42652ee1U);

// Both angle estimates pass through an open band read out of __TEXT as the
// doubles -1e-05 and +1e-05. A NaN estimate keeps its value.
constexpr double angle_band_low = -1.0e-05;
constexpr double angle_band_high = 1.0e-05;

constexpr float maximum_frame_extent = 8192.0F;
constexpr float maximum_scale = 4.0F;
constexpr float maximum_degrees = 360.0F;
// Native inverts a singular matrix with no guard and returns four NaNs at
// scale 0. QCut rejects that whole neighbourhood instead of reproducing an
// unguarded division; the existing inverse() zero-determinant policy agrees.
constexpr float minimum_scale_magnitude = 1.0e-4F;

// A compiler-folded sincos, or a strength-reduced square, rounds differently
// from the four separate libm calls native issues.
float (*volatile cosine_function)(float) = std::cos;
float (*volatile sine_function)(float) = std::sin;
float (*volatile power_function)(float, float) = std::pow;
float (*volatile arctangent_function)(float, float) = std::atan2;

bool bounded(float value, float low, float high) {
  return std::isfinite(value) && value >= low && value <= high;
}

bool acceptable(const LockFrame& frame, const RigidTransform& input) {
  return std::fegetround() == FE_TONEAREST &&
         bounded(frame.width, 1.0F, maximum_frame_extent) &&
         bounded(frame.height, 1.0F, maximum_frame_extent) &&
         bounded(frame.center.x, 0.0F, frame.width) &&
         bounded(frame.center.y, 0.0F, frame.height) &&
         bounded(std::abs(input.scale), minimum_scale_magnitude, maximum_scale) &&
         bounded(input.degrees, -maximum_degrees, maximum_degrees) &&
         bounded(input.translation_x, -4.0F * frame.width, 4.0F * frame.width) &&
         bounded(input.translation_y, -4.0F * frame.height, 4.0F * frame.height);
}

// The half-frame matrix both directions build from SettingInfo width/height.
Matrix3 frame_matrix(const LockFrame& frame) {
  const float half_width = frame.width / 2.0F;
  const float half_height = frame.height / 2.0F;
  return {half_width, 0.0, half_width, 0.0, half_height, half_height, 0.0, 0.0, 1.0};
}

float band(float value) {
  const double widened = value;
  return widened > angle_band_low && widened < angle_band_high ? 0.0F : value;
}

struct Decomposition {
  float degrees;
  float scale;
};

// Shared decomposition tail. `mirrored` selects Lock2Rigid's atan2 argument
// signs; every other step is identical between the two directions.
Decomposition decompose(const Matrix3& matrix, bool mirrored) {
  const float m00 = static_cast<float>(matrix[0]);
  const float m01 = static_cast<float>(matrix[1]);
  const float m10 = static_cast<float>(matrix[3]);
  const float m11 = static_cast<float>(matrix[4]);
  // The magnitudes are literally sqrtf(powf(m,2)+powf(m,2)); the sign test is
  // a b.pl, so -0.0 and NaN do not flip it.
  float scale_x = std::sqrt(power_function(m00, 2.0F) + power_function(m01, 2.0F));
  if (m00 < 0.0F) scale_x = scale_x * -1.0F;
  float scale_y = std::sqrt(power_function(m10, 2.0F) + power_function(m11, 2.0F));
  if (m11 < 0.0F) scale_y = scale_y * -1.0F;
  const float first = mirrored ? -m10 : m10;
  const float second = mirrored ? m01 : -m01;
  // The angle is the geometric mean of two banded atan2 estimates; the sign
  // comes from a third, unbanded call on the same arguments as the first.
  const float estimate = band(arctangent_function(first, m11));
  const float mirror = band(arctangent_function(second, m00));
  float radians = std::sqrt(estimate * mirror);
  if (arctangent_function(first, m11) < 0.0F) radians = radians * -1.0F;
  return {radians * radians_to_degrees, (scale_x + scale_y) / 2.0F};
}

}  // namespace

bool rigid_to_lock(const LockFrame& frame, const RigidTransform& input,
                   RigidTransform& output) {
  if (!acceptable(frame, input)) return false;
  // Every field is read into a local before the first write, so aliasing the
  // output onto the input is safe.
  const float radians = input.degrees * degrees_to_radians;
  const float cosine = cosine_function(radians);
  const float sine = sine_function(radians);
  const Matrix3 rigid{input.scale * cosine,    input.scale * sine, input.translation_x,
                      (-input.scale) * sine,   input.scale * cosine, input.translation_y,
                      0.0,                     0.0,                1.0};
  const Matrix3 half = frame_matrix(frame);
  Matrix3 inverse_half{};
  Matrix3 product{};
  Matrix3 locked{};
  // multiply() computes into a local candidate, so the aliased second product
  // is safe; an elementwise rewrite would silently break it.
  if (!inverse(half, inverse_half) || !multiply(half, rigid, product) ||
      !multiply(product, inverse_half, product) || !inverse(product, locked)) {
    return false;
  }
  const Decomposition decomposed = decompose(locked, false);
  const float m00 = static_cast<float>(locked[0]);
  const float m10 = static_cast<float>(locked[3]);
  const float translation_x =
      ((static_cast<float>(locked[2]) + frame.center.x * m00) - frame.center.y * m10) -
      frame.center.x;
  const float translation_y =
      ((static_cast<float>(locked[5]) + frame.center.x * m10) + frame.center.y * m00) -
      frame.center.y;
  output = {translation_x, translation_y, decomposed.degrees, decomposed.scale};
  return true;
}

bool lock_to_rigid(const LockFrame& frame, const RigidTransform& input,
                   RigidTransform& output) {
  if (!acceptable(frame, input)) return false;
  const float radians = input.degrees * degrees_to_radians;
  const float cosine = cosine_function(radians);
  const float sine = sine_function(radians);
  const Matrix3 to_origin{1.0, 0.0, -frame.center.x, 0.0, 1.0, -frame.center.y,
                          0.0, 0.0, 1.0};
  const Matrix3 to_target{1.0, 0.0, frame.center.x + input.translation_x,
                          0.0, 1.0, frame.center.y + input.translation_y,
                          0.0, 0.0, 1.0};
  const Matrix3 rotation{cosine, -sine, 0.0, sine, cosine, 0.0, 0.0, 0.0, 1.0};
  const Matrix3 scaling{input.scale, 0.0, 0.0, 0.0, input.scale, 0.0, 0.0, 0.0, 1.0};
  const Matrix3 half = frame_matrix(frame);
  Matrix3 inverse_half{};
  Matrix3 product{};
  Matrix3 inverse_product{};
  Matrix3 unlocked{};
  // Unlike Rigid2Lock this chain is invM5 * inv(M2*M3*M4*M1) * M5; the frame
  // matrix appears on both sides and there is no translation correction.
  if (!inverse(half, inverse_half) || !multiply(to_target, rotation, product) ||
      !multiply(product, scaling, product) || !multiply(product, to_origin, product) ||
      !inverse(product, inverse_product) ||
      !multiply(inverse_half, inverse_product, unlocked) ||
      !multiply(unlocked, half, unlocked)) {
    return false;
  }
  const Decomposition decomposed = decompose(unlocked, true);
  output = {static_cast<float>(unlocked[2]), static_cast<float>(unlocked[5]),
            decomposed.degrees, decomposed.scale};
  return true;
}

}  // namespace lens_contract
