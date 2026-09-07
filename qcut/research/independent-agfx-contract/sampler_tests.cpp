#include "sampler.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {

using agfx_contract::MetalSampler;
using agfx_contract::SourceSampler;
using agfx_contract::convert_sampler;

constexpr MetalSampler kSentinel{
    0x123456789abcdef0ULL, 0xfedcba9876543210ULL, 0x1122334455667788ULL,
    0x8877665544332211ULL, 0xaabbccddeeff0011ULL, 0x1100ffeeddccbbaaULL};

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

std::uint64_t expected_wrap(std::int32_t source) {
  switch (source) {
    case 0:
      return 2;  // Repeat.
    case 1:
      return 0;  // Clamp to edge.
    case 2:
      return 5;  // Clamp to border color, distinct from clamp to zero (4).
    case 3:
      return 3;  // Mirror repeat, distinct from mirror clamp to edge (1).
    default:
      throw std::runtime_error("Invalid test fixture wrap value");
  }
}

void test_all_valid_combinations() {
  std::size_t checked = 0;
  for (std::int32_t mag = 0; mag != 2; ++mag) {
    for (std::int32_t min = 0; min != 2; ++min) {
      for (std::int32_t mip = 0; mip != 3; ++mip) {
        for (std::int32_t s = 0; s != 4; ++s) {
          for (std::int32_t t = 0; t != 4; ++t) {
            for (std::int32_t r = 0; r != 4; ++r) {
              MetalSampler output = kSentinel;
              const SourceSampler source{mag, min, mip, s, t, r};
              const MetalSampler expected{
                  static_cast<std::uint64_t>(mag),
                  static_cast<std::uint64_t>(min),
                  static_cast<std::uint64_t>(mip), expected_wrap(s),
                  expected_wrap(t), expected_wrap(r)};
              require(convert_sampler(source, output),
                      "Valid sampler rejected at case " +
                          std::to_string(checked));
              require(output == expected,
                      "Wrong sampler conversion at case " +
                          std::to_string(checked));
              ++checked;
            }
          }
        }
      }
    }
  }
  require(checked == 768, "Incomplete valid sampler matrix");
}

void test_invalid_fields_preserve_entire_output() {
  struct Field {
    const char* name;
    std::int32_t SourceSampler::*member;
    std::int32_t first_invalid;
  };
  constexpr std::array<Field, 6> fields{{
      {"mag", &SourceSampler::mag, 2},
      {"min", &SourceSampler::min, 2},
      {"mip", &SourceSampler::mip, 3},
      {"wrap_s", &SourceSampler::wrap_s, 4},
      {"wrap_t", &SourceSampler::wrap_t, 4},
      {"wrap_r", &SourceSampler::wrap_r, 4},
  }};
  std::size_t checked = 0;
  for (const auto& field : fields) {
    const std::array<std::int32_t, 4> invalid_values{
        std::numeric_limits<std::int32_t>::min(), -1, field.first_invalid,
        std::numeric_limits<std::int32_t>::max()};
    for (const auto invalid : invalid_values) {
      SourceSampler source{1, 0, 2, 3, 2, 1};
      source.*field.member = invalid;
      MetalSampler output = kSentinel;
      const std::string context =
          std::string(field.name) + "=" + std::to_string(invalid);
      require(!convert_sampler(source, output),
              "Invalid sampler accepted: " + context);
      require(output == kSentinel,
              "Invalid sampler changed output: " + context);
      ++checked;
    }
  }
  require(checked == 24, "Incomplete invalid sampler matrix");
}

void test_repeated_conversion_and_rejection() {
  MetalSampler output = kSentinel;
  require(convert_sampler({1, 0, 2, 3, 2, 1}, output),
          "Initial conversion rejected");
  const MetalSampler first = output;
  require(convert_sampler({1, 0, 2, 3, 2, 1}, output) && output == first,
          "Repeated conversion changed result");
  require(!convert_sampler({0, 1, 0, 0, 1, -1}, output) && output == first,
          "Rejected update changed a prior valid result");
  require(convert_sampler({0, 1, 0, 0, 1, 2}, output),
          "Valid conversion after rejection failed");
  require(output == MetalSampler{0, 1, 0, 2, 0, 5},
          "Valid conversion retained stale state");
}

}  // namespace

int main() {
  try {
    test_all_valid_combinations();
    test_invalid_fields_preserve_entire_output();
    test_repeated_conversion_and_rejection();
    std::cout << "Sampler contract passed: 768 valid combinations, 24 invalid "
                 "field cases, repeated conversion and unchanged rejection.\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
