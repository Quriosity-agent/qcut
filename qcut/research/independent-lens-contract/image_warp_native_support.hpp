#pragma once

#include "image_warp.hpp"
#include "native_identity.hpp"

#include <cmath>
#include <cstring>

namespace lens_contract::diagnostic {
using Construct = void (*)(void*, int, int, int, void*, std::size_t);
using Destroy = void (*)(void*);
using Warp = void (*)(const void*, void*, void*, const void*, const void*);

class NativeMat {
 public:
  NativeMat(Construct construct, Destroy destroy, int rows, int columns, int type,
            void* data, std::size_t stride) : destroy_(destroy) {
    before_.fill(std::byte{0xa5});
    after_.fill(std::byte{0xa5});
    construct(body_.data(), rows, columns, type, data, stride);
    guards();
    require(field<int>(4) == 2 && field<int>(8) == rows && field<int>(12) == columns &&
                field<void*>(16) == data && (field<int>(0) & 0xfff) == type,
            "Native Mat constructor layout differs");
  }
  ~NativeMat() { destroy_(body_.data()); }
  NativeMat(const NativeMat&) = delete;
  NativeMat& operator=(const NativeMat&) = delete;
  void* address() { return body_.data(); }
  bool continuous() const { return (field<int>(0) & 0x4000) != 0; }
  bool externally_owned() const { return field<void*>(56) == nullptr; }
  void guards() const {
    for (const auto& guard : {before_, after_}) {
      for (const auto value : guard) require(value == std::byte{0xa5}, "Native Mat guard changed");
    }
  }
  void unchanged_storage(void* data, int width, int height) const {
    guards();
    require(field<void*>(16) == data && field<int>(12) == width && field<int>(8) == height,
            "Native output unexpectedly reallocated");
  }

 private:
  template <typename Value>
  Value field(std::size_t offset) const {
    Value result{};
    std::memcpy(&result, body_.data() + offset, sizeof(result));
    return result;
  }
  Destroy destroy_;
  alignas(16) std::array<std::byte, 32> before_{};
  alignas(16) std::array<std::byte, 96> body_{};
  std::array<std::byte, 32> after_{};
};

struct GuardedBytes {
  explicit GuardedBytes(std::size_t length) : storage(length + 64, 0xd7), length(length) {}
  std::uint8_t* data() { return storage.data() + 32; }
  void guards() const {
    for (std::size_t index = 0; index < 32; ++index) {
      require(storage[index] == 0xd7 && storage[length + 32 + index] == 0xd7,
              "Native pixel buffer guard changed");
    }
  }
  std::vector<std::uint8_t> storage;
  std::size_t length;
};

class Samples {
 public:
  std::uint32_t next() {
    state_ ^= state_ << 13; state_ ^= state_ >> 17; state_ ^= state_ << 5;
    return state_;
  }
  float scalar(float denominator) { return (static_cast<int>(next() % 2001U) - 1000) / denominator; }
 private:
  std::uint32_t state_ = 0x77617270;
};

inline std::vector<std::array<float, 6>> matrices() {
  std::vector<std::array<float, 6>> result{
      {1, 0, 0, 0, 1, 0}, {1, 0, 1, 0, 1, 2}, {1, 0, -1, 0, 1, -2},
      {-1, 0, 6, 0, 1, 0}, {0, -1, 4, 1, 0, 0}, {4, -1, 0, 0, 1, 0},
      {0.5F, 0, 0, 0, 0.5F, 0}, {2, 0, 0, 0, 2, 0},
      {1, 0, -65536, 0, 1, 0}, {1, 0, -32768, 0, 1, 0},
      {1, 0, 65536, 0, 1, 0}, {1, 0, 0, 0, 1, -65536},
      {1, 0, -65537, 0, 1, 0}, {1, 0, -1.5F, 0, 1, 0}};
  for (float boundary : {-512.5F / 1024, 511.5F / 1024, -0.5F, 0.5F}) {
    for (float value : {std::nextafter(boundary, -2.0F), boundary,
                         std::nextafter(boundary, 2.0F)}) {
      result.push_back({1, 0, -value, 0, 1, 0});
      result.push_back({1, 0, 0, 0, 1, -value});
    }
  }
  Samples random;
  while (result.size() < 278) {
    std::array<float, 6> matrix{random.scalar(700), random.scalar(1300), random.scalar(70),
                                random.scalar(1300), random.scalar(700), random.scalar(70)};
    if (std::abs(matrix[0] * matrix[4] - matrix[1] * matrix[3]) > 0.05F) result.push_back(matrix);
  }
  return result;
}

}  // namespace lens_contract::diagnostic
