#include "lens_contract.hpp"
#include "transform_plan.hpp"

#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
using namespace lens_contract;

template <typename Value>
Value read() {
  Value value{};
  if (!(std::cin >> value)) throw std::runtime_error("Missing or invalid input");
  return value;
}

std::size_t count() {
  const auto value = read<std::size_t>();
  if (value > max_sample_count) throw std::runtime_error("Input exceeds sample limit");
  return value;
}

void end_input() {
  std::cin >> std::ws;
  if (std::cin.peek() != std::char_traits<char>::eof()) {
    throw std::runtime_error("Unexpected trailing input");
  }
}

template <typename Values>
void print(const Values& values) {
  for (const auto value : values) std::cout << value << ' ';
  std::cout << '\n';
}

void run(const std::string& mode) {
  if (mode == "resize-plan" || mode == "crop-plan") {
    TransformPlan output{};
    bool valid = false;
    if (mode == "resize-plan") {
      AnchorResizeRequest request{};
      for (float& value : request.source_points) value = read<float>();
      for (float& value : request.destination_points) value = read<float>();
      end_input();
      valid = plan_anchor_resize(request, output);
    } else {
      const CropResizeRequest request{read<float>(), read<float>(), read<float>(), read<float>(),
                                       read<int>(), read<int>()};
      end_input();
      valid = plan_crop_resize(request, output);
    }
    if (!valid) throw std::runtime_error("Transform plan outside the supported finite domain");
    print(output.source_to_destination);
    print(output.destination_to_source);
    return;
  }
  if (mode == "multiply" || mode == "inverse") {
    Matrix3 a{}, b{}, output{};
    for (double& value : a) value = read<double>();
    if (mode == "multiply") {
      for (double& value : b) value = read<double>();
    }
    end_input();
    const bool valid = mode == "multiply" ? multiply(a, b, output) : inverse(a, output);
    if (!valid) throw std::runtime_error("Matrix outside the supported finite domain");
    print(output);
    return;
  }
  if (mode == "kernel" || mode == "smooth") {
    const GaussianRequest request{read<int>(), read<double>()};
    if (mode == "kernel") {
      end_input();
      std::vector<double> output;
      if (!gaussian_kernel(request, output)) throw std::runtime_error("Invalid kernel request");
      print(output);
      return;
    }
    std::vector<float> input(count());
    for (float& value : input) value = read<float>();
    end_input();
    std::vector<float> output;
    if (!gaussian_smooth(input, request, output)) throw std::runtime_error("Invalid smoothing request");
    print(output);
    return;
  }
  if (mode == "rotate" || mode == "warp") {
    Rotation rotation{};
    RigidTransform transform{};
    if (mode == "rotate") {
      rotation = {read<float>(), {read<float>(), read<float>()}};
    } else {
      transform = {read<float>(), read<float>(), read<float>(), read<float>()};
    }
    std::vector<Point> input(count());
    for (auto& point : input) point = {read<float>(), read<float>()};
    end_input();
    std::vector<Point> output;
    const bool valid = mode == "rotate" ? rotate_points(input, rotation, output)
                                         : warp_points(input, transform, output);
    if (!valid) throw std::runtime_error("Invalid point transform");
    for (auto point : output) std::cout << point.x << ' ' << point.y << '\n';
    return;
  }
  throw std::runtime_error("Mode must be multiply, inverse, kernel, smooth, rotate, warp, resize-plan or crop-plan");
}
}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 2) throw std::runtime_error("Usage: lens-contract MODE < numbers.txt");
    std::cout << std::setprecision(17);
    run(argv[1]);
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
