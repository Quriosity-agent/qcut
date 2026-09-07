#include "filter_time.hpp"
#include "test_support.hpp"

#include <bit>
#include <iostream>

namespace {

using namespace editor_contract;
using editor_test::require;

void test_static_boundary_vectors() {
  struct Sample { TimeEndpoints sequence; TimeEndpoints absolute_trim; std::int64_t duration; };
  constexpr std::array<Sample, 12> samples{{
      {{100, 140}, {100, 140}, 40}, {{-10, 20}, {0, 20}, 30},
      {{-30, -10}, {0, -10}, 20}, {{20, 10}, {20, 10}, -10},
      {{-1, -1}, {0, -1}, 0}, {{0, 0}, {0, 0}, 0},
      {{INT64_MIN, INT64_MAX}, {0, INT64_MAX}, -1},
      {{INT64_MAX, INT64_MIN}, {INT64_MAX, INT64_MIN}, 1},
      {{INT64_MIN, 0}, {0, 0}, INT64_MIN},
      {{0, INT64_MIN}, {0, INT64_MIN}, INT64_MIN},
      {{INT64_MAX, -1}, {INT64_MAX, -1}, INT64_MIN},
      {{-1, INT64_MAX}, {0, INT64_MAX}, INT64_MIN},
  }};
  for (const auto& sample : samples) {
    for (const bool cast_succeeded : {false, true}) {
      for (const auto subtype : {INT32_MIN, -1, 0, 2, 3, 4, INT32_MAX}) {
        const auto result = filter_insert_times({sample.sequence, cast_succeeded, subtype});
        const auto trim = cast_succeeded && subtype == 3
                              ? TimeEndpoints{0, sample.duration} : sample.absolute_trim;
        require(result == FilterInsertTimes{sample.sequence, trim, sample.duration},
                "Static insert-time vector failed");
      }
    }
  }
}

void test_modular_endpoint_and_cast_properties() {
  std::uint64_t random = 0x5143555454494d45ULL;
  for (std::uint32_t index = 0; index < 65536; ++index) {
    random = random * 6364136223846793005ULL + 1442695040888963407ULL;
    const auto start_bits = random;
    random = random * 6364136223846793005ULL + 1442695040888963407ULL;
    const auto end_bits = random;
    const TimeEndpoints input{std::bit_cast<std::int64_t>(start_bits),
                              std::bit_cast<std::int64_t>(end_bits)};
    const auto absolute = filter_insert_times({input, false, 3});
    const auto relative = filter_insert_times({input, true, 3});
    require(absolute.sequence == input && relative.sequence == input,
            "Reconstructed sequence must preserve both original endpoints");
    require(start_bits + static_cast<std::uint64_t>(absolute.duration) == end_bits,
            "Duration lost modulo-2^64 arithmetic");
    require(absolute.trim.in >= 0 && absolute.trim.out == input.out,
            "Absolute trim changed its output endpoint");
    require(relative.trim.in == 0 && relative.trim.out == absolute.duration &&
                relative.duration == absolute.duration,
            "Subtype changed the duration or used a clamped duration");
    require(filter_insert_times({input, true, 2}) == absolute,
            "Subtype equality must not be interpreted as a range or bit flag");
  }
}

}  // namespace

int main() {
  try {
    test_static_boundary_vectors();
    test_modular_endpoint_and_cast_properties();
    std::cout << "2 groups passed; 168 fixed static cases and 65,536 modular/cast cases\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
