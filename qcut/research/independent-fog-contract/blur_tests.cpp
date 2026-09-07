#include "blur.hpp"
#include "test_support.hpp"

#include <array>
#include <iostream>
#include <limits>

namespace {
using namespace fog_contract;
using namespace fog_test;
using softglow::Image;

void constants() {
    for (auto color : {softglow::Pixel{0, 0, 0, 0}, {1, 1, 1, 1}, {1, 0, 0, 1}, {0, 1, 0, 0}}) {
        const float mask = color[1] == 1 ? 0.0F : 1.0F;
        for (float size : {0.0F, 0.25F, 1.332F, 3.6F, 4.0F}) {
            const Image input(3, 7, color);
            const auto horizontal = weighted_blur({input, size, BlurAxis::horizontal});
            const auto vertical = weighted_blur({input, size, BlurAxis::vertical});
            for (const auto& pixel : horizontal.pixels) {
                require(pixel[0] == color[0] && pixel[1] == color[1] && pixel[2] == color[2], "Constant color changed");
                require(pixel[3] == mask, "Horizontal tap did not generate the threshold mask");
            }
            for (const auto& pixel : vertical.pixels) require(pixel == color, "Vertical pass regenerated alpha instead of filtering it");
        }
    }
    const auto equal = weighted_blur({Image(1, 1, {0.5F, 0.5F, 0.5F, 0}), 0, BlurAxis::horizontal});
    require(equal.pixels[0][3] == 1, "Threshold must be strict: luminance 0.5 retains mask 1");
}

void impulse() {
    // size 0.8 gives one-pixel tap spacing at this width; integer-centered impulse is analytic.
    Image input(33, 1, {0, 0, 0, 1});
    input.at(16, 0) = {1, 1, 1, 1};
    const auto result = softglow::to_rgba8(weighted_blur({input, 0.8F, BlurAxis::horizontal}));
    constexpr std::array<unsigned, 9> expected{26, 24, 22, 19, 17, 14, 10, 6, 3};
    for (std::size_t offset = 0; offset < expected.size(); ++offset) {
        for (int sign : {-1, 1}) {
            const auto index = static_cast<std::size_t>(16 + sign * static_cast<int>(offset)) * 4;
            require(result[index] == expected[offset], "Impulse weight or normalization changed");
            require(result[index + 3] == 255 - expected[offset], "Mask was derived after averaging instead of at each tap");
        }
    }
    require(result[7 * 4] == 0 && result[25 * 4] == 0, "Tap support extends beyond radius eight");
    Image column(1, 33, {0, 0, 0, 1});
    column.at(0, 16) = {1, 1, 1, 1};
    const auto vertical = softglow::to_rgba8(weighted_blur({column, 0.8F, BlurAxis::vertical}));
    for (std::size_t offset = 0; offset < expected.size(); ++offset) {
        require(vertical[(16 + offset) * 4] == expected[offset], "Vertical tap axis changed");
        require(vertical[(16 + offset) * 4 + 3] == 255, "Vertical alpha accumulation changed");
    }
}

void threshold_after_sampling() {
    Image input(2, 1, {0, 0, 0, 1});
    input.at(1, 0) = {1, 1, 1, 1};
    // Half-pixel taps encounter luminance exactly 0.5; classify the interpolated color.
    const auto output = softglow::to_rgba8(weighted_blur({input, 0.4F, BlurAxis::horizontal}));
    require(output[3] == 164 && output[7] == 115, "Threshold was applied before bilinear sampling");
}

void invalid() {
    const Image one(1, 1);
    for (float size : {-1.0F, 4.1F, std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()})
        rejects([&] { weighted_blur({one, size, BlurAxis::horizontal}); });
    rejects([&] { weighted_blur({one, 1, static_cast<BlurAxis>(99)}); });
    Image bad = one;
    bad.pixels.clear();
    rejects([&] { weighted_blur({bad, 1, BlurAxis::vertical}); });
}
} // namespace

int main() {
    try {
        constants(); impulse(); threshold_after_sampling(); invalid();
        std::cout << fog_test::checks << " fog blur checks passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
