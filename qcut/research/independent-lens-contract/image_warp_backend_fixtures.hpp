#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

namespace lens_contract::fixtures {
// Synthetic matrices selected by quantization-boundary search, then checked natively.
inline constexpr std::array<std::array<float, 6>, 4> boundary_matrices{{
    {-0x1.d119cep-1F, 0x1.d9673p-3F, -0x1.104638p+1F,
     -0x1.8436d2p-1F, 0x1.d2bd3cp-2F, 0x1.c66666p+2F},
    {-0x1.2a7efap-1F, 0x1.60e2dap-7F, 0x1.99f73ap+3F,
     0x1.543e62p-1F, -0x1.00d1b8p-3F, 0x1.2c405ep+3F},
    {0x1.7aee64p-1F, 0x1.7553a8p-1F, -0x1.3ee722p+0F,
     0x1.a95a96p-2F, -0x1.ac8b44p-2F, -0x1.441d42p+3F},
    {0x1.4c7e28p-1F, -0x1.445f28p-2F, 0x1.90af8ap+3F,
     0x1.115448p-3F, 0x1.7a1cacp-1F, 0x1.ee2be2p+2F},
}};

inline std::uint8_t pixel_byte(std::size_t index) {
  return static_cast<std::uint8_t>((index * 71 + index / 4) % 251 + 1);
}

inline std::uint64_t fingerprint(std::span<const std::uint8_t> bytes) {
  std::uint64_t result = 14695981039346656037ULL;
  for (auto value : bytes) result = (result ^ value) * 1099511628211ULL;
  return result;
}
}  // namespace lens_contract::fixtures
