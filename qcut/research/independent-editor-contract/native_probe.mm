#include "native_library.hpp"
#include "keyframe.hpp"
#include "test_support.hpp"
#include "value_state.hpp"

#include <bit>
#include <charconv>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
#include <unistd.h>

namespace {

using editor_test::require;

class NativeOutputScope {
 public:
  NativeOutputScope() : saved_stdout_(dup(STDOUT_FILENO)) {
    if (saved_stdout_ < 0) {
      throw std::runtime_error("Cannot preserve diagnostic stdout");
    }
    if (dup2(STDERR_FILENO, STDOUT_FILENO) < 0) {
      close(saved_stdout_);
      throw std::runtime_error("Cannot isolate native initializer output");
    }
  }
  ~NativeOutputScope() {
    std::fflush(stdout);
    dup2(saved_stdout_, STDOUT_FILENO);
    close(saved_stdout_);
  }
  NativeOutputScope(const NativeOutputScope&) = delete;
  NativeOutputScope& operator=(const NativeOutputScope&) = delete;
 private:
  int saved_stdout_;
};

struct alignas(16) GuardedObject {
  std::array<std::uint8_t, 16> before;
  std::array<std::uint8_t, 256> object;
  std::array<std::uint8_t, 16> after;
  bool operator==(const GuardedObject&) const = default;
};

template <typename Value>
void write(GuardedObject& object, std::size_t offset, Value value) {
  require(offset + sizeof(Value) <= object.object.size(), "Probe write out of bounds");
  std::memcpy(object.object.data() + offset, &value, sizeof(value));
}

template <typename Value>
Value read(const GuardedObject& object, std::size_t offset) {
  require(offset + sizeof(Value) <= object.object.size(), "Probe read out of bounds");
  Value value;
  std::memcpy(&value, object.object.data() + offset, sizeof(value));
  return value;
}

void write_state(GuardedObject& object, const editor_contract::MutationState& state) {
  write(object, 0x20, state.tracking);
  write(object, 0x24, state.state_code);
  write(object, 0x28, state.changed);
}

NSDictionary* compare_setters(const editor_probe::Library& library, bool material) {
  using Setter = void (*)(void*, const void*);
  using Getter = const void* (*)(const void*);
  const auto setter = editor_probe::entry<Setter>(library, material ? 0xf1cc74 : 0xdc37ec);
  const auto getter = editor_probe::entry<Getter>(library, material ? 0xf1cc6c : 0xdc37e4);
  const std::size_t value_offset = material ? 0xe8 : 0x48;
  const auto* bits = material ? editor_test::kDoubleBits.data() : editor_test::kTimeBits.data();
  const auto count = material ? editor_test::kDoubleBits.size() : editor_test::kTimeBits.size();
  std::uint64_t fingerprint = editor_test::kFnvStart;
  std::size_t comparisons = 0;
  for (std::uint32_t tracking = 0; tracking < 256; ++tracking) {
    for (const auto state_code : editor_test::kStateCodes) {
      for (const auto changed : editor_test::kChangedBytes) {
        for (std::size_t old_index = 0; old_index < count; ++old_index) {
          for (std::size_t next_index = 0; next_index < count; ++next_index) {
            GuardedObject native;
            native.before.fill(0xa5);
            native.object.fill(0x69);
            native.after.fill(0x5a);
            const editor_contract::MutationState initial{
                static_cast<std::uint8_t>(tracking), state_code, changed};
            write_state(native, initial);
            write(native, value_offset, bits[old_index]);
            GuardedObject expected = native;
            if (material) {
              editor_contract::MaterialValue model{std::bit_cast<double>(bits[old_index]), initial};
              editor_contract::assign_material_value(model, std::bit_cast<double>(bits[next_index]));
              write(expected, value_offset, std::bit_cast<std::uint64_t>(model.value));
              write_state(expected, model.mutation);
            } else {
              editor_contract::KeyframeTime model{std::bit_cast<std::int64_t>(bits[old_index]), initial};
              editor_contract::assign_keyframe_time(model, std::bit_cast<std::int64_t>(bits[next_index]));
              write(expected, value_offset, std::bit_cast<std::uint64_t>(model.time_offset));
              write_state(expected, model.mutation);
            }
            auto input = bits[next_index];
            setter(native.object.data(), &input);
            require(input == bits[next_index], "Native setter changed input");
            require(native == expected, "Native setter full-buffer mismatch at case " +
                                        std::to_string(comparisons));
            require(getter(native.object.data()) == native.object.data() + value_offset,
                    "Native getter did not return the stored field address");
            editor_test::hash_integer(fingerprint, read<std::uint64_t>(native, value_offset), 8);
            editor_test::hash_integer(fingerprint, read<std::uint32_t>(native, 0x24), 4);
            editor_test::hash_integer(fingerprint, read<std::uint8_t>(native, 0x28), 1);
            ++comparisons;
          }
        }
      }
    }
  }
  return @{@"comparisons": @(comparisons), @"nativeFingerprint": @(fingerprint),
           @"mismatches": @0, @"all256TrackingBytes": @YES,
           @"scope": @"Leaf native setters/getters on guarded synthetic memory; no model constructor or event dispatch"};
}

struct NativeRecord {
  std::uint64_t unused = 0xa5a5a5a5a5a5a5a5ULL;
  std::int64_t time_offset;
  std::uint64_t property;
  double intensity;
};

NSDictionary* compare_metadata(const editor_probe::Library& library) {
  static_assert(sizeof(std::string) == 24 && sizeof(NativeRecord) == 32);
  static_assert(offsetof(NativeRecord, time_offset) == 8);
  static_assert(offsetof(NativeRecord, property) == 16);
  static_assert(offsetof(NativeRecord, intensity) == 0x18);
  using Serialize = std::string (*)(const NativeRecord*, std::uint32_t);
  const auto serialize = editor_probe::entry<Serialize>(library, 0x3a194b0);
  constexpr std::array<std::uint64_t, 15> properties{
      0, 1, 0x1fff, 0x2000, 0x2001, 0x4000, 0x6000, 0x10000,
      0x10001, 0x80000000ULL, 0x100000000ULL, 0x180000000ULL,
      0x1000000000ULL, 0x1000000001ULL, UINT64_MAX};
  constexpr std::array<std::uint32_t, 5> modes{0, 1, 2, 0x80000000U, UINT32_MAX};
  std::size_t comparisons = 0;
  NSMutableArray* samples = [NSMutableArray array];
  for (const auto mode : modes) {
    for (const auto property : properties) {
      for (const auto bits : editor_test::kDoubleBits) {
        @autoreleasepool {
          NativeRecord record{0xa5a5a5a5a5a5a5a5ULL, INT64_MIN,
                                    property, std::bit_cast<double>(bits)};
          const auto prior = std::bit_cast<std::array<std::uint8_t, 32>>(record);
          const std::string json = serialize(&record, mode);
          require(prior == std::bit_cast<std::array<std::uint8_t, 32>>(record),
                  "Metadata helper changed input record");
          NSData* data = [NSData dataWithBytes:json.data() length:json.size()];
          id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
          const auto expected = editor_contract::filter_keyframe_metadata(
              {record.time_offset, property, record.intensity, mode});
          NSString* key = [[NSString alloc] initWithBytes:expected.property.data()
                                                length:expected.property.size()
                                              encoding:NSUTF8StringEncoding];
          require([parsed isKindOfClass:[NSDictionary class]] && [parsed count] == 1,
                  "Unexpected metadata JSON root: " + json);
          id inner = parsed[key];
          require([inner isKindOfClass:[NSDictionary class]] && [inner count] == 1,
                  "Unexpected metadata property: " + json);
          id value = inner[@"value"];
          if (!expected.value) {
            require(value == [NSNull null], "Nonfinite JSON value was not null: " + json);
          } else {
            require([value isKindOfClass:[NSNumber class]], "JSON value was not numeric: " + json);
            const auto number_start = json.find("\"value\":");
            require(number_start != std::string::npos, "Missing numeric key");
            double decoded = 0;
            const auto result = std::from_chars(json.data() + number_start + 8,
                                                 json.data() + json.size(), decoded);
            require(result.ec == std::errc{} && result.ptr < json.data() + json.size() &&
                    *result.ptr == '}' && std::bit_cast<std::uint64_t>(decoded) == bits,
                    "JSON numeric value did not preserve the finite double: " + json);
          }
          if (bits == 0x3fd7ae147ae147aeULL) {
            [samples addObject:@{@"mode": @(mode), @"propertyCode": @(property),
                                 @"json": @(json.c_str())}];
          }
          ++comparisons;
        }
      }
    }
  }
  return @{@"comparisons": @(comparisons), @"mismatches": @0,
           @"samples": samples,
           @"scope": @"Native metadata JSON helper; independent structured fields, not byte-identical decimal formatting"};
}

}  // namespace

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::runtime_error("Usage: editor-native-probe /absolute/libvideoeditor.dylib");
      NSDictionary* report;
      {
        const NativeOutputScope native_output;
        const auto library = editor_probe::load_verified(argv[1]);
        report = @{@"status": @"ok", @"librarySha256": library.sha256,
                            @"arm64Uuid": library.uuid,
                            @"materialValue": compare_setters(library, true),
                            @"keyframeTime": compare_setters(library, false),
                            @"keyframeMetadata": compare_metadata(library),
                   @"filterInsertTimes": @"Static reconstruction only; native object graph not invoked"};
      }
      NSData* json = [NSJSONSerialization dataWithJSONObject:report
                         options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
      if (!json) throw std::runtime_error("Could not encode probe report");
      std::cout.write(static_cast<const char*>(json.bytes), json.length);
      std::cout << '\n';
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
