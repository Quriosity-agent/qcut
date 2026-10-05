#include "face_live_makeup_geometry.h"

#include <algorithm>
#include <iostream>
#include <string>
#include <utility>

namespace {

using Points = std::array<float, 212>;
std::size_t checks = 0;

void require(bool condition, const std::string& label) {
  ++checks;
  if (!condition) throw std::runtime_error(label);
}

template <typename Call>
void rejects(Call call, const std::string& label) {
  try {
    call();
  } catch (const std::runtime_error&) {
    ++checks;
    return;
  }
  throw std::runtime_error("accepted invalid geometry: " + label);
}

std::uint32_t bits(float value) {
  return std::bit_cast<std::uint32_t>(value);
}

Points reference(const Points& source, int width, int height) {
  Points result{};
  for (std::size_t index = 0; index < source.size(); index += 2) {
    // Independent wider products; volatile stores preserve float32 rounding under contraction.
    const volatile float x = static_cast<float>(static_cast<double>(source[index]) * width);
    const volatile float y = static_cast<float>(static_cast<double>(source[index + 1]) * height);
    result[index] = x;
    result[index + 1] = static_cast<float>(static_cast<double>(height) - y);
  }
  return result;
}

Points variedSource() {
  Points source{};
  for (std::size_t index = 0; index < source.size(); ++index)
    source[index] = static_cast<float>(index + 1) / 213.0f;
  return source;
}

void accepts(const Points& source, const Points& destination, int width, int height) {
  qcut_live::validateMakeupGeometry(source, destination, width, height);
  ++checks;
}

void testSuccess() {
  const auto source = variedSource();
  for (const int width : {1, 2, 3, 17, 1920, 4095, 4096}) {
    for (const int height : {1, 2, 3, 31, 1080, 4095, 4096})
      accepts(source, reference(source, width, height), width, height);
  }
  for (const float value : {0.0f, -0.0f, 1.0f, 0.5f, 0.1f, 0.7f,
                           std::numeric_limits<float>::denorm_min(),
                           std::numeric_limits<float>::min(),
                           std::nextafter(1.0f, 0.0f)}) {
    Points uniform;
    uniform.fill(value);
    for (const int dimension : {1, 3, 4096})
      accepts(uniform, reference(uniform, dimension, dimension), dimension, dimension);
  }

  std::uint32_t state = 0x91e10da5u;
  for (int sample = 0; sample < 128; ++sample) {
    Points random{};
    for (float& value : random) {
      state = state * 1664525u + 1013904223u;
      value = std::bit_cast<float>(state % 0x3f800001u);
    }
    const int width = 1 + static_cast<int>((state >> 12) % 4096);
    const int height = 1 + static_cast<int>(state % 4096);
    accepts(random, reference(random, width, height), width, height);
  }
}

void testDimensions() {
  const auto source = variedSource();
  const auto destination = reference(source, 3, 7);
  for (const int invalid : {std::numeric_limits<int>::min(), -4096, -1, 0,
                            4097, std::numeric_limits<int>::max()}) {
    rejects([&] { qcut_live::validateMakeupGeometry(source, destination, invalid, 7); },
            "width bounds");
    rejects([&] { qcut_live::validateMakeupGeometry(source, destination, 3, invalid); },
            "height bounds");
  }
}

void testInvalidCoordinates() {
  const auto source = variedSource();
  const auto destination = reference(source, 1920, 1080);
  const std::array invalidSource = {
      -std::numeric_limits<float>::denorm_min(), -0.1f,
      std::nextafter(1.0f, 2.0f), std::numeric_limits<float>::max(),
      std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity(),
      std::bit_cast<float>(0x7fc00001u), std::bit_cast<float>(0xffc00001u),
      std::bit_cast<float>(0x7f800001u)};
  const std::array invalidDestination = {
      std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity(),
      std::bit_cast<float>(0x7fc00001u), std::bit_cast<float>(0xffc00001u),
      std::bit_cast<float>(0x7f800001u), std::numeric_limits<float>::max(), -1.0f};
  for (std::size_t index = 0; index < source.size(); ++index) {
    for (const float value : invalidSource) {
      auto invalid = source;
      invalid[index] = value;
      rejects([&] { qcut_live::validateMakeupGeometry(invalid, destination, 1920, 1080); },
              "source coordinate " + std::to_string(index));
    }
    for (const float value : invalidDestination) {
      auto invalid = destination;
      invalid[index] = value;
      rejects([&] { qcut_live::validateMakeupGeometry(source, invalid, 1920, 1080); },
              "destination coordinate " + std::to_string(index));
    }
    for (unsigned bit = 0; bit < 32; ++bit) {
      auto invalid = destination;
      invalid[index] = std::bit_cast<float>(bits(invalid[index]) ^ (std::uint32_t{1} << bit));
      rejects([&] { qcut_live::validateMakeupGeometry(source, invalid, 1920, 1080); },
              "single-bit destination coordinate " + std::to_string(index));
    }
    auto changedSource = source;
    changedSource[index] = 0.0f;
    rejects([&] { qcut_live::validateMakeupGeometry(changedSource, destination, 1920, 1080); },
            "changed source coordinate " + std::to_string(index));
  }
}

void testRoundingAndOrder() {
  Points source{};
  for (std::size_t index = 0; index < source.size(); index += 2) {
    source[index] = 0.1f;
    source[index + 1] = 0.7f;
  }
  const auto destination = reference(source, 3, 3);
  require(bits(destination[0]) == 0x3e99999au, "fractional x rounding fixture");
  require(bits(destination[1]) == 0x3f666668u, "fractional y rounding fixture");
  accepts(source, destination, 3, 3);

  const float doubleY = static_cast<float>(3.0 - static_cast<double>(source[1]) * 3.0);
  const float fusedY = std::fma(-source[1], 3.0f, 3.0f);
  volatile float complement = 1.0f - source[1];
  const float reorderedY = complement * 3.0f;
  require(bits(doubleY) == 0x3f666667u, "double-versus-float fixture");
  for (const float wrongY : {doubleY, fusedY, reorderedY}) {
    require(bits(wrongY) != bits(destination[1]), "rounding alternatives must differ");
    auto invalid = destination;
    invalid.back() = wrongY;
    rejects([&] { qcut_live::validateMakeupGeometry(source, invalid, 3, 3); },
            "last-point double, FMA, or reordered subtraction");
  }

  const auto varied = variedSource();
  const auto expected = reference(varied, 17, 31);
  auto swappedPoints = expected;
  std::swap(swappedPoints[0], swappedPoints[210]);
  std::swap(swappedPoints[1], swappedPoints[211]);
  rejects([&] { qcut_live::validateMakeupGeometry(varied, swappedPoints, 17, 31); },
          "point ordering");
  auto swappedAxes = expected;
  std::swap(swappedAxes[210], swappedAxes[211]);
  rejects([&] { qcut_live::validateMakeupGeometry(varied, swappedAxes, 17, 31); },
          "last-point axis ordering");
  rejects([&] { qcut_live::validateMakeupGeometry(varied, expected, 31, 17); },
          "dimension ordering");
  auto noFlip = expected;
  noFlip.back() = varied.back() * 31.0f;
  rejects([&] { qcut_live::validateMakeupGeometry(varied, noFlip, 17, 31); }, "missing y flip");
}

void testSignedZeroAndInputsUnchanged() {
  for (const float zero : {0.0f, -0.0f}) {
    Points source{};
    source[210] = zero;
    source[211] = 1.0f;
    const auto destination = reference(source, 4096, 4096);
    require(bits(destination[210]) == bits(zero), "x preserves zero sign");
    require(bits(destination[211]) == 0u, "flipped endpoint is positive zero");
    accepts(source, destination, 4096, 4096);
    for (const std::size_t index : {std::size_t{210}, std::size_t{211}}) {
      auto invalid = destination;
      invalid[index] = std::bit_cast<float>(bits(invalid[index]) ^ 0x80000000u);
      rejects([&] { qcut_live::validateMakeupGeometry(source, invalid, 4096, 4096); },
              "signed zero mismatch");
    }
  }
  auto source = variedSource();
  auto destination = reference(source, 17, 31);
  const auto originalSource = source;
  const auto originalDestination = destination;
  accepts(source, destination, 17, 31);
  rejects([&] { qcut_live::validateMakeupGeometry(source, destination, 31, 17); },
          "read-only rejection");
  for (std::size_t index = 0; index < source.size(); ++index) {
    require(bits(source[index]) == bits(originalSource[index]), "source unchanged");
    require(bits(destination[index]) == bits(originalDestination[index]), "destination unchanged");
  }
  Points aliased;
  aliased.fill(0.5f);
  accepts(aliased, aliased, 1, 1);
}

}

int main() {
  try {
    testSuccess();
    testDimensions();
    testInvalidCoordinates();
    testRoundingAndOrder();
    testSignedZeroAndInputsUnchanged();
    std::cout << "makeup geometry: " << checks << " checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "makeup geometry test failed: " << error.what() << '\n';
    return 1;
  }
}
