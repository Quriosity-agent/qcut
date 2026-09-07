#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace editor_test {

constexpr std::array<std::uint64_t, 22> kDoubleBits{
    0, 0x8000000000000000ULL, 0x3ff0000000000000ULL, 0xbff0000000000000ULL,
    0x3fd7ae147ae147aeULL, 0x4000000000000000ULL, 1, 0x8000000000000001ULL,
    0x000fffffffffffffULL, 0x0010000000000000ULL, 0x7fefffffffffffffULL,
    0xffefffffffffffffULL, 0x7ff0000000000000ULL, 0xfff0000000000000ULL,
    0x7ff8000000000000ULL, 0x7ff8000000001234ULL, 0xfff8000000000001ULL,
    0x7ff0000000000001ULL, 0xfff0000000000001ULL, 0xffffffffffffffffULL,
    0x3fdfffffffffffffULL, 0x3fe0000000000001ULL};
constexpr std::array<std::uint64_t, 12> kTimeBits{
    0, 1, 2, 30, 1000000, 0xffffffffffffffffULL, 0xfffffffffffffffeULL,
    0x7fffffffffffffffULL, 0x8000000000000000ULL, 0x8000000000000001ULL,
    0x7ffffffffffffffeULL, 0x123456789abcdef0ULL};
constexpr std::array<std::uint32_t, 6> kStateCodes{0, 1, 2, 3, 0x80000000U, 0xffffffffU};
constexpr std::array<std::uint8_t, 4> kChangedBytes{0, 1, 2, 255};
constexpr std::uint64_t kFnvStart = 14695981039346656037ULL;

inline void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

inline void hash_integer(std::uint64_t& hash, std::uint64_t value, std::size_t bytes) {
  for (std::size_t index = 0; index < bytes; ++index) {
    hash ^= (value >> (8 * index)) & 255U;
    hash *= 1099511628211ULL;
  }
}

}  // namespace editor_test
