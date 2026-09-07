#import <Foundation/Foundation.h>
#include "../independent-editor-contract/native_library.hpp"
#include "common_keyframes.hpp"

#include <sys/mman.h>
#include <unistd.h>

#include <bit>
#include <cstring>
#include <iostream>

namespace {
class ReadOnlyInput {
 public:
  explicit ReadOnlyInput(double value) {
    const auto page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0) throw std::runtime_error("Cannot obtain page size");
    size_ = static_cast<std::size_t>(page_size);
    memory_ = mmap(nullptr, size_, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    if (memory_ == MAP_FAILED) throw std::runtime_error("Cannot allocate ABI input");
    auto* bytes = static_cast<std::byte*>(memory_);
    const void* params = bytes + 0x100;
    std::memcpy(bytes + 0x18, &params, sizeof(params));
    std::memcpy(bytes + 0x138, &value, sizeof(value));
    if (mprotect(memory_, size_, PROT_READ) != 0) {
      munmap(memory_, size_);
      throw std::runtime_error("Cannot protect ABI input");
    }
  }
  ~ReadOnlyInput() { munmap(memory_, size_); }
  ReadOnlyInput(const ReadOnlyInput&) = delete;
  ReadOnlyInput& operator=(const ReadOnlyInput&) = delete;
  const void* data() const { return memory_; }
 private:
  void* memory_ = MAP_FAILED;
  std::size_t size_ = 0;
};
}

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::runtime_error("Usage: creator-native-events /absolute/libvideoeditor.dylib");
      const auto library = editor_probe::load_verified(argv[1]);
      using Values = std::vector<double> (*)(const void*);
      const auto native_values = editor_probe::entry<Values>(library, 0x2128834);
      std::uint64_t bits = 0x9e3779b97f4a7c15ULL;
      std::size_t cases = 0;
      const auto compare = [&](std::uint64_t input) {
        const double value = std::bit_cast<double>(input);
        const ReadOnlyInput readonly_input(value);
        const auto observed = native_values(readonly_input.data());
        const auto expected = creator_contract::filter_keyframe_values(value);
        if (observed.size() != 1 || observed.capacity() != 1 ||
            std::bit_cast<std::uint64_t>(observed[0]) != std::bit_cast<std::uint64_t>(expected[0])) {
          throw std::runtime_error("Raw keyframe vector differs from native");
        }
        ++cases;
      };
      for (const std::uint64_t special : {0ULL, 0x8000000000000000ULL, 1ULL,
              0x7ff0000000000000ULL, 0xfff0000000000000ULL,
              0x7ff8000000000042ULL, 0x7ff0000000000001ULL, 0xffffffffffffffffULL}) compare(special);
      for (unsigned i = 0; i < 10000; ++i) {
        bits ^= bits << 13;
        bits ^= bits >> 7;
        bits ^= bits << 17;
        compare(bits);
      }
      std::cout << "{\"cases\":" << cases << ",\"mismatches\":0,\"input_pages\":\"read-only\",\"entry\":\"0x2128834\",\"sha256\":\""
                << library.sha256.UTF8String << "\",\"uuid\":\"" << library.uuid.UTF8String << "\"}\n";
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
