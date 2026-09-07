#pragma once

#include <bit>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

struct Checks {
  unsigned count = 0;
  void require(bool condition, std::string_view message) {
    ++count;
    if (!condition) throw std::runtime_error(std::string(message));
  }
  void same_bits(double actual, double expected, std::string_view message) {
    require(std::bit_cast<std::uint64_t>(actual) == std::bit_cast<std::uint64_t>(expected), message);
  }
  int finish() const {
    std::cout << count << " checks passed\n";
    return 0;
  }
};
