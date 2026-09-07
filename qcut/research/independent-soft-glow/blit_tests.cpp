#include "blit.hpp"
#include "blit_fixtures.hpp"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace softglow;
std::size_t checks = 0;

void require(bool valid, const char* message) {
    ++checks;
    if (!valid) throw std::runtime_error(message);
}

template<typename Function> void rejects(Function function) {
    bool rejected = false;
    try { function(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Invalid blit input was accepted");
}

void native_goldens() {
    // Hashes are from original seeded inputs read back as RGBA32F on M4 CGL.
    constexpr std::array<std::uint64_t, 4> hashes{
        0xdda548c52c18d3ecULL, 0x198d3b44d459bc9fULL,
        0xfa9387e4617cc3feULL, 0xe638d5cace9d4a63ULL};
    for (std::size_t i = 0; i < hashes.size(); ++i) {
        const auto size = blit_fixtures::goldens[i];
        const auto source = blit_fixtures::input(size, 987321U + static_cast<std::uint32_t>(i));
        const auto result = blit_resize({source, size.width, size.height, BlitTarget::rgba32f});
        require(blit_fixtures::float_hash(result) == hashes[i], "Native floating blit golden differs");
        require(to_rgba8(result) == to_rgba8(blit_resize({source, size.width, size.height})),
            "RGBA8 target bypassed normalized-float quantization");
    }
}

void rounding_and_orientation() {
    Image ramp(2, 1, {0, 0, 0, 0});
    ramp.at(1, 0) = {1, 1 / 255.0F, 1, 1};
    const auto result = blit_resize({ramp, 512, 1, BlitTarget::rgba32f});
    require(result.at(128, 0)[0] == 1 / 255.0F, "Half-weight did not round toward the upper source coordinate");
    require(result.at(135, 0)[1] == 1 / 4080.0F, "Half sub-byte did not round upward");
    require(result.at(0, 0) == ramp.at(0, 0) && result.at(511, 0) == ramp.at(1, 0), "Edge clamping changed");
    require(to_rgba8(resize(ramp, 512, 1)) != to_rgba8(result), "Generic resize negative control did not differ");

    Image checker(2, 2, {0, 0, 0, 0});
    checker.at(1, 0) = checker.at(0, 1) = {1, 1, 1, 1};
    const auto combined = blit_resize({checker, 512, 512, BlitTarget::rgba32f});
    require(combined.at(128, 135)[0] == 142 / 4080.0F,
        "Four-tap interpolation rounded each axis separately (143), instead of the combined sum (142)");

    Image vertical(1, 2, {1, 1, 1, 1});
    vertical.at(0, 1) = {0, 0, 0, 0};
    const auto reversed = blit_resize({vertical, 1, 512, BlitTarget::rgba32f, true});
    require(reversed.at(0, 128)[0] == 0, "Reversed source half-weight orientation changed");
    require(reversed.at(0, 128)[0] != result.at(128, 0)[0], "Half weights incorrectly commute with source reversal");
    const auto identity = blit_resize({vertical, 1, 2, BlitTarget::rgba8, true});
    require(identity.at(0, 0) == vertical.at(0, 1) && identity.at(0, 1) == vertical.at(0, 0), "Reversed source identity changed");
}

void shape_and_input_contract() {
    Image levels(256, 1);
    for (int x = 0; x < levels.width; ++x) levels.at(x, 0) = {x / 255.0F, 0, 1, (255 - x) / 255.0F};
    require(to_rgba8(blit_resize({levels, 256, 1})) == to_rgba8(levels), "Byte identity, including alpha, changed");
    const Image one(1, 1, {7 / 255.0F, 137 / 255.0F, 1, 0});
    for (auto size : {std::array<int, 2>{16384, 1}, {1, 16384}, {7, 13}}) {
        for (const auto& pixel : blit_resize({one, size[0], size[1]}).pixels)
            require(pixel == one.pixels[0], "Constant/tiny image changed");
    }
    for (auto size : {std::array<int, 2>{0, 1}, {-1, 1}, {1, 0}, {16385, 1}, {16384, 16384}})
        rejects([&] { blit_resize({one, size[0], size[1]}); });
    rejects([&] { blit_resize({one, 1, 1, static_cast<BlitTarget>(99)}); });
    Image malformed = one;
    malformed.pixels.clear();
    rejects([&] { blit_resize({malformed, 1, 1}); });
    for (float value : {std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity(), -0.01F, 1.01F}) {
        Image invalid(1, 1, {value, 0, 0, 1});
        rejects([&] { blit_resize({invalid, 1, 1}); });
    }
}
} // namespace

int main() {
    try {
        native_goldens();
        rounding_and_orientation();
        shape_and_input_contract();
        std::cout << checks << " blit checks passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
