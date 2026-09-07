#pragma once

#include "image.hpp"

#include <array>
#include <bit>
#include <cstdint>

namespace softglow::blit_fixtures {

struct Dimensions { int source_width; int source_height; int width; int height; };

inline constexpr std::array<Dimensions, 4> goldens{{
    {2, 2, 512, 512}, {31, 23, 43, 37}, {257, 145, 128, 72}, {160, 90, 321, 181}}};

inline std::uint32_t next(std::uint32_t& seed) {
    seed = seed * 1664525U + 1013904223U;
    return seed;
}

inline Image input(Dimensions dimensions, std::uint32_t seed) {
    const auto count = static_cast<std::size_t>(dimensions.source_width) * dimensions.source_height * 4;
    std::vector<std::uint8_t> bytes(count);
    for (auto& value : bytes) value = static_cast<std::uint8_t>(next(seed) >> 24);
    return from_rgba8(bytes, dimensions.source_width, dimensions.source_height);
}

inline std::uint64_t float_hash(const Image& image) {
    std::uint64_t result = 14695981039346656037ULL;
    for (const auto& pixel : image.pixels) {
        for (float value : pixel) {
            const auto bits = std::bit_cast<std::uint32_t>(value);
            for (unsigned shift = 0; shift < 32; shift += 8) {
                result = (result ^ ((bits >> shift) & 255U)) * 1099511628211ULL;
            }
        }
    }
    return result;
}

} // namespace softglow::blit_fixtures
