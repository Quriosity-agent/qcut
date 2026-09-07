#include "lens_contract.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <numeric>

namespace lens_contract {
namespace {

bool valid_request(const GaussianRequest& request) {
  const double square = request.sigma * request.sigma;
  return request.length > 0 && request.length <= max_kernel_length &&
         std::isfinite(request.sigma) && request.sigma > 0.0 &&
         std::isfinite(4.0 * square) && square > 0.0;
}

double gaussian_weight(double sigma, double position) {
  constexpr double two_pi = 6.2831854820251465;
  // Native calls libm pow; replacing pow(x,2) by x*x changes some kernel bits.
  static double (*volatile power)(double, double) = std::pow;
  const double exponent = -1.0 * (power(position, 2.0) / power(2.0 * sigma, 2.0));
  return (1.0 / std::sqrt(two_pi * power(sigma, 2.0))) * std::exp(exponent);
}

}  // namespace

bool gaussian_kernel(const GaussianRequest& request, std::vector<double>& output) {
  if (!valid_request(request)) return false;
  const bool even = request.length % 2 == 0;
  const int radius = (request.length - (even ? 2 : 1)) / 2;
  const double spacing = radius == 0 ? 0.0 : 3.0 * request.sigma / radius;
  std::vector<double> candidate;
  candidate.reserve(static_cast<std::size_t>(request.length));
  for (int index = radius; index >= 1; --index) {
    candidate.push_back(gaussian_weight(request.sigma, index * spacing * -1.0));
  }
  candidate.push_back(gaussian_weight(request.sigma, 0.0));
  if (even) candidate.push_back(gaussian_weight(request.sigma, 0.0));
  for (int index = 1; index <= radius; ++index) {
    candidate.push_back(gaussian_weight(request.sigma, index * spacing));
  }
  const double total = std::accumulate(candidate.begin(), candidate.end(), 0.0);
  if (!std::isfinite(total) || total <= 0.0) return false;
  for (double& weight : candidate) weight /= total;
  output.swap(candidate);
  return true;
}

bool gaussian_smooth(std::span<const float> input, const GaussianRequest& request,
                     std::vector<float>& output) {
  // Native smoothing reads length+1 weights for even lengths; exclude that domain.
  if (request.length % 2 == 0 || input.size() > max_sample_count ||
      !std::all_of(input.begin(), input.end(),
                   [](float value) { return std::isfinite(value); })) return false;
  std::vector<double> weights;
  if (!gaussian_kernel(request, weights)) return false;
  std::vector<float> candidate(input.size());
  const auto radius = static_cast<std::int64_t>(request.length / 2);
  const auto count = static_cast<std::int64_t>(input.size());
  for (std::int64_t index = 0; index < count; ++index) {
    double sum = 0.0;
    for (std::int64_t offset = -radius; offset <= radius; ++offset) {
      const auto source = std::clamp(index + offset, std::int64_t{0}, count - 1);
      sum += static_cast<double>(input[static_cast<std::size_t>(source)]) *
             weights[static_cast<std::size_t>(offset + radius)];
    }
    const float value = static_cast<float>(sum);
    if (!std::isfinite(value)) return false;
    candidate[static_cast<std::size_t>(index)] = value;
  }
  output.swap(candidate);
  return true;
}

}  // namespace lens_contract
