#include "pixel_format.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {

using agfx_contract::convert_pixel_format;

constexpr std::uint64_t kSentinel = 0x123456789abcdef0ULL;
constexpr std::uint64_t kFnvOffset = 14695981039346656037ULL;
constexpr std::uint64_t kFnvPrime = 1099511628211ULL;

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

void hash_integer(std::uint64_t& hash, std::uint64_t value,
                  std::size_t byte_count) {
  for (std::size_t index = 0; index < byte_count; ++index) {
    hash ^= (value >> (index * 8)) & 0xffU;
    hash *= kFnvPrime;
  }
}

void test_complete_domain_against_native_fingerprint() {
  std::size_t direct = 0;
  std::size_t gated = 0;
  std::size_t rejected = 0;
  std::uint64_t fingerprint = kFnvOffset;
  for (std::uint32_t source = 1; source <= 205; ++source) {
    std::uint64_t current_output = kSentinel;
    const bool current_return =
        convert_pixel_format({source, true}, current_output);
    const bool current_written = current_output != kSentinel;
    const std::string context = "source " + std::to_string(source);
    require(current_return == current_written,
            "Current-platform return/write mismatch at " + context);

    std::uint64_t older_output = kSentinel;
    const bool older_return =
        convert_pixel_format({source, false}, older_output);
    require(older_return == current_return,
            "Platform gate changed recognition at " + context);
    if (source >= 164 && source <= 191) {
      require(current_return && older_output == kSentinel,
              "Gated format did not preserve output at " + context);
      ++gated;
    } else {
      require(older_output == current_output,
              "Platform gate affected an ungated format at " + context);
      if (current_return) {
        ++direct;
      } else {
        ++rejected;
      }
    }

    hash_integer(fingerprint, source, 4);
    hash_integer(fingerprint, current_return, 1);
    hash_integer(fingerprint, current_written, 1);
    hash_integer(fingerprint, current_output, 8);
  }

  require(direct == 85 && gated == 28 && rejected == 92,
          "Expected 85 direct, 28 gated and 92 rejected formats");
  // Native UUID 408EB610-AD47-3846-9595-14B6A3ABF537, sources 1..205.
  // Each record is LE u32 source, u8 return, u8 written, LE u64 output.
  // The false availability branch above is static evidence, not an old-OS run.
  require(fingerprint == 0xe87db91f1384326fULL,
          "Complete domain differs from the pinned native observations");
}

void test_aliases_and_nonmonotonic_formats() {
  struct Expected {
    std::uint32_t source;
    std::uint64_t metal;
  };
  constexpr std::array<Expected, 22> cases{{
      {2, 10},    {15, 10},   {29, 70},   {43, 70},
      {50, 80},   {90, 110},  {97, 110},  {128, 92},
      {131, 252}, {132, 252}, {135, 260}, {136, 260},
      {149, 151}, {150, 150}, {172, 208}, {173, 190},
      {174, 210}, {175, 192}, {190, 218}, {191, 200},
      {204, 240}, {205, 241},
  }};
  for (const auto& expected : cases) {
    std::uint64_t output = std::numeric_limits<std::uint64_t>::max();
    require(convert_pixel_format({expected.source, true}, output),
            "Known format rejected: " + std::to_string(expected.source));
    require(output == expected.metal,
            "Wrong complete 64-bit output for source " +
                std::to_string(expected.source));
  }

  for (std::uint32_t source = 164; source <= 191; ++source) {
    std::uint64_t output = kSentinel;
    require(convert_pixel_format({source, true}, output),
            "ASTC-format branch rejected");
    require(output != 209 && output != 191,
            "The ASTC numeric gaps were incorrectly filled");
  }
}

void test_unwritten_paths_preserve_all_bits() {
  constexpr std::array<std::uint64_t, 4> sentinels{
      0, 1, 0xfedcba9876543210ULL,
      std::numeric_limits<std::uint64_t>::max()};
  constexpr std::array<std::uint32_t, 11> rejected_sources{
      0, 127, 153, 163, 192, 203, 206, 207, 65536U + 43U,
      0x80000000U, std::numeric_limits<std::uint32_t>::max()};

  for (const auto sentinel : sentinels) {
    for (const bool available : {false, true}) {
      for (const auto source : rejected_sources) {
        std::uint64_t output = sentinel;
        require(!convert_pixel_format({source, available}, output),
                "Invalid format accepted: " + std::to_string(source));
        require(output == sentinel,
                "Rejected format modified output: " + std::to_string(source));
      }
    }
    for (std::uint32_t source = 164; source <= 191; ++source) {
      std::uint64_t output = sentinel;
      require(convert_pixel_format({source, false}, output),
              "Unavailable recognized format returned false");
      require(output == sentinel,
              "Unavailable format modified output: " + std::to_string(source));
    }
  }
}

void test_call_order_and_output_reuse() {
  std::array<std::uint64_t, 206> forward{};
  for (std::uint32_t source = 1; source <= 205; ++source) {
    forward[source] = kSentinel;
    convert_pixel_format({source, true}, forward[source]);
  }
  for (std::uint32_t source = 205; source != 0; --source) {
    std::uint64_t output = kSentinel;
    convert_pixel_format({source, true}, output);
    require(output == forward[source],
            "Call order changed source " + std::to_string(source));
  }

  std::uint64_t output = kSentinel;
  require(convert_pixel_format({164, true}, output) && output == 204,
          "Initial gated conversion failed");
  require(convert_pixel_format({191, false}, output) && output == 204,
          "Unavailable conversion changed the prior valid output");
  require(!convert_pixel_format({127, true}, output) && output == 204,
          "Rejected conversion changed the prior valid output");
  require(convert_pixel_format({43, false}, output) && output == 70,
          "Ungated conversion incorrectly reused the previous gate");
  require(convert_pixel_format({191, true}, output) && output == 200,
          "Re-enabling availability retained stale state");
}

}  // namespace

int main() {
  try {
    test_complete_domain_against_native_fingerprint();
    test_aliases_and_nonmonotonic_formats();
    test_unwritten_paths_preserve_all_bits();
    test_call_order_and_output_reuse();
    std::cout << "Pixel format contract passed: 205 sources on both platform "
                 "branches, 85 direct / 28 gated / 92 rejected, native "
                 "fingerprint, aliases, sentinels and call order.\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
