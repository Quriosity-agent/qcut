#include "transform_plan.hpp"

#include <algorithm>
#include <cfenv>
#include <cmath>
#include <limits>

namespace lens_contract {
namespace {
using System = std::array<std::array<float, 4>, 4>;

bool finite(const auto& values) {
  return std::all_of(values.begin(), values.end(), [](float value) {
    return std::isfinite(value);
  });
}

bool solve_anchor_system(System matrix, std::array<float, 4>& values) {
  constexpr float minimum_pivot = 10.0F * std::numeric_limits<float>::epsilon();
  for (std::size_t column = 0; column < 4; ++column) {
    std::size_t pivot = column;
    for (std::size_t row = column + 1; row < 4; ++row) {
      if (std::abs(matrix[row][column]) > std::abs(matrix[pivot][column])) pivot = row;
    }
    if (std::abs(matrix[pivot][column]) < minimum_pivot) return false;
    if (pivot != column) {
      for (std::size_t index = column; index < 4; ++index) {
        std::swap(matrix[column][index], matrix[pivot][index]);
      }
      std::swap(values[column], values[pivot]);
    }
    const float reciprocal = 1.0F / matrix[column][column];
    for (std::size_t row = column + 1; row < 4; ++row) {
      const float factor = -matrix[row][column] * reciprocal;
      for (std::size_t index = column + 1; index < 4; ++index) {
        matrix[row][index] = std::fma(matrix[column][index], factor, matrix[row][index]);
      }
      values[row] = std::fma(values[column], factor, values[row]);
      if (!finite(matrix[row]) || !std::isfinite(values[row])) return false;
    }
  }
  for (std::size_t remaining = 4; remaining > 0; --remaining) {
    const std::size_t row = remaining - 1;
    float value = values[row];
    for (std::size_t column = row + 1; column < 4; ++column) {
      value = std::fma(-values[column], matrix[row][column], value);
    }
    values[row] = value / matrix[row][row];
    if (!std::isfinite(values[row])) return false;
  }
  return true;
}

bool valid_destination(const CropResizeRequest& request) {
  return request.destination_width > 1 && request.destination_height > 1 &&
         request.destination_width <= max_image_dimension &&
         request.destination_height <= max_image_dimension &&
         static_cast<std::size_t>(request.destination_width) *
             static_cast<std::size_t>(request.destination_height) <= max_image_pixels;
}
}  // namespace

bool plan_anchor_resize(const AnchorResizeRequest& request, TransformPlan& output) {
  if (std::fegetround() != FE_TONEAREST || !finite(request.source_points) ||
      !finite(request.destination_points)) return false;
  const auto& point = request.source_points;
  const System matrix{{{point[0], 0, 1, 0}, {0, point[1], 0, 1},
                       {point[2], 0, 1, 0}, {0, point[3], 0, 1}}};
  auto solution = request.destination_points;
  if (!solve_anchor_system(matrix, solution) || solution[0] == 0 || solution[1] == 0) {
    return false;
  }
  const float inverse_x = static_cast<float>(1.0 / static_cast<double>(solution[0]));
  const float inverse_y = static_cast<float>(1.0 / static_cast<double>(solution[1]));
  TransformPlan result{{solution[0], 0, solution[2], 0, solution[1], solution[3]},
                       {inverse_x, 0, -inverse_x * solution[2],
                        0, inverse_y, -inverse_y * solution[3]}};
  if (!finite(result.source_to_destination) || !finite(result.destination_to_source)) return false;
  output = result;
  return true;
}

bool plan_crop_resize(const CropResizeRequest& request, TransformPlan& output) {
  if (!valid_destination(request) || !std::isfinite(request.width) ||
      !std::isfinite(request.height) || request.width <= 1 || request.height <= 1) return false;
  // The caller uses inclusive end coordinates, rounding the addition before subtracting one.
  const AnchorResizeRequest anchors{
      {request.x, request.y, (request.x + request.width) - 1.0F,
       (request.y + request.height) - 1.0F},
      {0, 0, static_cast<float>(request.destination_width - 1),
       static_cast<float>(request.destination_height - 1)}};
  return plan_anchor_resize(anchors, output);
}

bool warp_crop_rgba(const RgbaImageView& source, const CropResizeRequest& request,
                    AffineWarpResult& output) {
  TransformPlan plan;
  if (!plan_crop_resize(request, plan)) return false;
  return warp_affine_rgba(source, {plan.source_to_destination, request.destination_width,
                                  request.destination_height, AffineWarpBackend::image_transform},
                         output);
}

}  // namespace lens_contract
