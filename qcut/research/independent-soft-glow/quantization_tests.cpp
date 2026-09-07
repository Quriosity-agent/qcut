#include "image.hpp"
#include "lut.hpp"
#include "output_mix.hpp"
#include "pipeline.hpp"

#include <bit>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace softglow;
std::size_t checks = 0;

void require(bool value, const char* message) {
    ++checks;
    if (!value) throw std::runtime_error(message);
}

template<typename Function> void rejects(Function function) {
    bool rejected = false;
    try { function(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Invalid input was accepted");
}

unsigned rational_quantization(float value) {
    const auto bits = std::bit_cast<std::uint32_t>(value);
    if ((bits >> 31) != 0) return 0;
    if (value >= 1) return 255;
    const auto exponent = (bits >> 23) & 255U;
    const auto mantissa = (bits & 0x7fffffU) | (exponent == 0 ? 0U : 0x800000U);
    const auto shift = exponent == 0 ? 149U : 150U - exponent;
    if (shift >= 64) return 0;
    return static_cast<unsigned>((static_cast<std::uint64_t>(mantissa) * 255U +
        (std::uint64_t{1} << (shift - 1))) >> shift);
}

void conversion_boundaries() {
    std::size_t old_errors = 0;
    for (unsigned channel = 0; channel < 255; ++channel) {
        const float midpoint = static_cast<float>((channel + 0.5) / 255.0);
        const auto center = std::bit_cast<std::uint32_t>(midpoint);
        for (int offset = -32; offset <= 32; ++offset) {
            const float value = std::bit_cast<float>(static_cast<std::uint32_t>(static_cast<std::int64_t>(center) + offset));
            const auto expected = rational_quantization(value);
            require(quantize_unorm8(value) == expected, "UNORM midpoint differs from exact rational arithmetic");
            const auto old = static_cast<unsigned>(std::round(value * 255.0F));
            old_errors += old != expected;
        }
    }
    require(old_errors == 127, "Double rounding negative control changed");
    for (std::uint32_t bits = 0; bits <= 0x3f800000U; bits += 2053U) {
        const auto value = std::bit_cast<float>(bits);
        require(quantize_unorm8(value) == rational_quantization(value), "UNORM exponent sweep differs");
    }
    for (unsigned value = 0; value <= 255; ++value) {
        require(quantize_unorm8(static_cast<float>(value) / 255) == value, "Byte round trip changed");
    }
    require(quantize_unorm8(-1) == 0 && quantize_unorm8(2) == 255, "UNORM clamp differs");
    require(quantize_unorm8(-0.0F) == 0 && quantize_unorm8(0.5F) == 128, "UNORM special finite values differ");
    for (float invalid : {std::numeric_limits<float>::quiet_NaN(),
                          std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::infinity()}) {
        rejects([&] { quantize_unorm8(invalid); });
    }
    const float value = std::bit_cast<float>(std::uint32_t{0x3f0a0a0a});
    require(quantize_unorm8(value) == 137, "Native 137.5 boundary golden changed");
    require(to_rgba8(Image(1, 1, {value, 0.5F, 0, 1}))[0] == 137, "Image serialization bypassed UNORM conversion");
}

void byte_domain_mixing() {
    Image source(256, 256), target(256, 256);
    for (unsigned a = 0; a < 256; ++a) {
        for (unsigned b = 0; b < 256; ++b) {
            source.at(static_cast<int>(a), static_cast<int>(b)) = {
                a / 255.0F, b / 255.0F, 0, ((a + b) % 256) / 255.0F};
            target.at(static_cast<int>(a), static_cast<int>(b)) = {
                b / 255.0F, a / 255.0F, 1, ((2 * a + b + 3) % 256) / 255.0F};
        }
    }
    for (unsigned weight = 0; weight <= 4; ++weight) {
        const auto bytes = to_rgba8(mix_output({source, target, weight / 4.0}));
        for (unsigned a = 0; a < 256; ++a) {
            for (unsigned b = 0; b < 256; ++b) {
                const auto index = (b * 256 + a) * 4;
                require(bytes[index] == (a * (4 - weight) + b * weight + 2) / 4, "Byte-domain red mix differs");
                require(bytes[index + 1] == (b * (4 - weight) + a * weight + 2) / 4, "Byte-domain green mix differs");
                require(bytes[index + 2] == (255 * weight + 2) / 4, "Byte-domain blue mix differs");
                const auto alpha = (weight == 4 ? 2 * a + b + 3 : a + b) % 256;
                require(bytes[index + 3] == alpha, "Provider alpha behavior differs");
            }
        }
    }
    const Image black(1, 1, {0, 0, 0, 1}), white(1, 1, {1, 1, 1, 1});
    require(to_rgba8(mix_output({black, white, 0.37}))[0] == 94, "Decimal intensity golden differs");
    const Image ten(1, 1, {10 / 255.0F, 10 / 255.0F, 10 / 255.0F, 1});
    require(to_rgba8(mix_output({black, ten, std::nextafter(0.05, 0.0)}))[0] == 0, "Intensity was narrowed before blending");
    require(to_rgba8(mix_output({black, ten, 0.05}))[0] == 1, "Half-integer byte blend differs");
    rejects([&] { mix_output({black, Image(2, 1), 0.5}); });
    const auto lut = identity_lut();
    for (double value : {-1e-300, std::nextafter(1.0, 2.0),
                         std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity()}) {
        rejects([&] { mix_output({black, white, value}); });
        rejects([&] { cinematic_soft_glow({black, lut, value, {}}); });
    }
}
} // namespace

int main() {
    try {
        conversion_boundaries();
        byte_domain_mixing();
        std::cout << "PASS " << checks << " quantization and output mix checks\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << '\n';
        return 1;
    }
}
