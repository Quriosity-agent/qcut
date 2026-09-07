#include "keyframe.hpp"
#include "test_support.hpp"

#include <bit>
#include <cmath>
#include <iostream>

namespace {

using namespace editor_contract;
using editor_test::require;

void test_native_property_vectors() {
  struct Sample { std::uint64_t code; std::string_view legacy; std::string_view modern; };
  constexpr std::array<Sample, 15> cases{{
      {0, "intensity", "intensity"}, {1, "intensity", "intensity"},
      {0x1fff, "intensity", "intensity"}, {0x2000, "Intensity", "intensity"},
      {0x2001, "intensity", "intensity"}, {0x4000, "Intensity", "intensity"},
      {0x6000, "intensity", "intensity"},
      {0x10000, "effects_adjust_intensity", "intensity"},
      {0x10001, "intensity", "intensity"},
      {0x80000000ULL, "intensity", "Intensity"},
      {0x100000000ULL, "intensity", "Intensity"},
      {0x180000000ULL, "intensity", "intensity"},
      {0x1000000000ULL, "intensity", "effects_adjust_intensity"},
      {0x1000000001ULL, "intensity", "intensity"},
      {UINT64_MAX, "intensity", "intensity"},
  }};
  for (const auto& sample : cases) {
    for (const std::uint32_t mode : {0U, 1U, 2U, 0x80000000U, UINT32_MAX}) {
      for (const auto bits : editor_test::kDoubleBits) {
        const auto value = std::bit_cast<double>(bits);
        const auto result = filter_keyframe_metadata({INT64_MIN, sample.code, value, mode});
        require(result.property == (mode == 0 ? sample.legacy : sample.modern),
                "Native metadata key/case mismatch");
        const bool nonfinite = (bits & 0x7ff0000000000000ULL) == 0x7ff0000000000000ULL;
        require(result.value.has_value() != nonfinite, "Nonfinite metadata must represent JSON null");
        if (result.value) {
          require(std::bit_cast<std::uint64_t>(*result.value) == bits,
                  "Finite metadata lost original double bits");
        }
      }
    }
  }
}

void test_transfer_preserves_raw_payloads() {
  for (const auto time_bits : editor_test::kTimeBits) {
    for (const auto intensity_bits : editor_test::kDoubleBits) {
      const FilterKeyframeInput input{std::bit_cast<std::int64_t>(time_bits), 0x2000,
                                      std::bit_cast<double>(intensity_bits), 0};
      const auto result = transfer_filter_keyframe(input);
      require(result.type_code == 2, "Filter keyframe numeric type differs from the call site");
      require(std::bit_cast<std::uint64_t>(result.time_offset) == time_bits,
              "Transfer converted time units");
      require(std::bit_cast<std::uint64_t>(result.intensity) == intensity_bits,
              "Transfer clamped, normalized or canonicalized intensity");
      require(result.metadata.property == "Intensity", "Transfer dropped metadata");
    }
  }
}

}  // namespace

int main() {
  try {
    test_native_property_vectors();
    test_transfer_preserves_raw_payloads();
    std::cout << "2 groups passed; 1,650 native metadata vectors and 264 static transfer cases\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
