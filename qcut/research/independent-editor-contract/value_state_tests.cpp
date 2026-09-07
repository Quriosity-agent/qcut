#include "test_support.hpp"
#include "value_state.hpp"

#include <bit>
#include <iostream>

namespace {

using namespace editor_contract;
using editor_test::require;

void test_native_fingerprints() {
  std::uint64_t material_hash = editor_test::kFnvStart;
  std::uint64_t time_hash = editor_test::kFnvStart;
  for (std::uint32_t tracking = 0; tracking < 256; ++tracking) {
    for (const auto code : editor_test::kStateCodes) {
      for (const auto changed : editor_test::kChangedBytes) {
        const MutationState state{static_cast<std::uint8_t>(tracking), code, changed};
        for (const auto old_bits : editor_test::kDoubleBits) {
          for (const auto next_bits : editor_test::kDoubleBits) {
            MaterialValue material{std::bit_cast<double>(old_bits), state};
            assign_material_value(material, std::bit_cast<double>(next_bits));
            require(material.mutation.tracking == tracking, "Tracking byte changed");
            editor_test::hash_integer(material_hash, std::bit_cast<std::uint64_t>(material.value), 8);
            editor_test::hash_integer(material_hash, material.mutation.state_code, 4);
            editor_test::hash_integer(material_hash, material.mutation.changed, 1);
          }
        }
        for (const auto old_bits : editor_test::kTimeBits) {
          for (const auto next_bits : editor_test::kTimeBits) {
            KeyframeTime keyframe{std::bit_cast<std::int64_t>(old_bits), state};
            assign_keyframe_time(keyframe, std::bit_cast<std::int64_t>(next_bits));
            require(keyframe.mutation.tracking == tracking, "Time tracking byte changed");
            editor_test::hash_integer(time_hash, std::bit_cast<std::uint64_t>(keyframe.time_offset), 8);
            editor_test::hash_integer(time_hash, keyframe.mutation.state_code, 4);
            editor_test::hash_integer(time_hash, keyframe.mutation.changed, 1);
          }
        }
      }
    }
  }
  // UUID 22337058-B217-3CAF-9979-CFECA7302CF7. Native records contain
  // LE u64 resulting value, LE u32 state, u8 changed in the loop order above.
  require(material_hash == 8238921485342005053ULL, "Material state native fingerprint changed");
  require(time_hash == 9758396941018483869ULL, "Keyframe time native fingerprint changed");
}

void test_equality_payloads_and_aliases() {
  const MutationState initial{255, 0, 173};
  MaterialValue material{0.0, initial};
  assign_material_value(material, -0.0);
  require(std::bit_cast<std::uint64_t>(material.value) == 0 && material.mutation == initial,
          "Signed-zero equality must preserve the old bits and every state field");
  material.value = -0.0;
  assign_material_value(material, 0.0);
  require(std::bit_cast<std::uint64_t>(material.value) == 0x8000000000000000ULL &&
              material.mutation == initial, "Reverse signed-zero equality changed the object");
  assign_material_value(material, 2.0);
  require(material.value == 2.0 && material.mutation == MutationState{255, 2, 1},
          "Setter clamped value or missed the 0-to-2 state transition");
  material.mutation.changed = 173;
  assign_material_value(material, material.value);
  require(material.mutation.changed == 173, "Equal self-alias must not mark changed");
  material.value = std::bit_cast<double>(0x7ff0000000000001ULL);
  assign_material_value(material, material.value);
  require(std::bit_cast<std::uint64_t>(material.value) == 0x7ff0000000000001ULL &&
              material.mutation.changed == 1, "NaN self-alias must mark changed and retain payload");
  KeyframeTime time{INT64_MIN, {1, 3, 173}};
  assign_keyframe_time(time, time.time_offset);
  require(time.mutation == MutationState{1, 3, 173}, "Equal time self-alias modified state");
  assign_keyframe_time(time, INT64_MAX);
  require(time.time_offset == INT64_MAX && time.mutation == MutationState{1, 3, 1},
          "Time transfer clamped a boundary or replaced an existing state code");
}

}  // namespace

int main() {
  try {
    test_native_fingerprints();
    test_equality_payloads_and_aliases();
    std::cout << "2 groups passed; 3,858,432 native-pinned state vectors\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
