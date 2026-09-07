#include "blit.hpp"
#include "blit_fixtures.hpp"
#include "../jianying-runtime-probe/cgl-diagnostic-context.hpp"
#include "../jianying-runtime-probe/cgl-image-target.hpp"

#include <algorithm>
#include <bit>
#include <iomanip>
#include <iostream>
#include <string_view>

namespace {
using namespace softglow;

void require(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

Image native_resize(const BlitResizeRequest& request, bool flip_source) {
    auto input = to_rgba8(request.source);
    const int sw = request.source.width, sh = request.source.height;
    if (flip_source) {
        const auto stride = static_cast<std::size_t>(sw) * 4;
        for (int y = 0; y < sh / 2; ++y) {
            const auto begin = input.begin() + static_cast<std::ptrdiff_t>(y) * static_cast<std::ptrdiff_t>(stride);
            std::swap_ranges(begin, begin + static_cast<std::ptrdiff_t>(stride),
                input.begin() + static_cast<std::ptrdiff_t>(sh - 1 - y) * static_cast<std::ptrdiff_t>(stride));
        }
    }
    const qcut_diagnostic::CglImageTarget source(sw, sh, GL_RGBA8, GL_UNSIGNED_BYTE, input.data());
    const bool floating = request.target == BlitTarget::rgba32f;
    const qcut_diagnostic::CglImageTarget target(request.width, request.height,
        floating ? GL_RGBA32F : GL_RGBA8, GL_FLOAT, nullptr);
    glDisable(GL_DITHER);
    glDisable(GL_BLEND);
    glDisable(GL_FRAMEBUFFER_SRGB);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, source.framebuffer);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    std::vector<std::uint8_t> uploaded(input.size());
    glReadPixels(0, 0, sw, sh, GL_RGBA, GL_UNSIGNED_BYTE, uploaded.data());
    require(uploaded == input, "Blit source byte upload/readback differs");
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, target.framebuffer);
    glDrawBuffer(GL_COLOR_ATTACHMENT0);
    glBlitFramebuffer(0, flip_source ? sh : 0, sw, flip_source ? 0 : sh,
        0, 0, request.width, request.height, GL_COLOR_BUFFER_BIT, GL_LINEAR);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, target.framebuffer);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    Image result(request.width, request.height);
    if (floating) {
        std::vector<float> values(result.pixels.size() * 4);
        glReadPixels(0, 0, request.width, request.height, GL_RGBA, GL_FLOAT, values.data());
        for (std::size_t index = 0; index < values.size(); ++index) result.pixels[index / 4][index % 4] = values[index];
    } else {
        std::vector<std::uint8_t> values(result.pixels.size() * 4);
        glReadPixels(0, 0, request.width, request.height, GL_RGBA, GL_UNSIGNED_BYTE, values.data());
        result = from_rgba8(values, request.width, request.height);
    }
    require(glGetError() == GL_NO_ERROR, "Native blit or readback failed");
    return result;
}

std::vector<blit_fixtures::Dimensions> cases() {
    std::vector<blit_fixtures::Dimensions> result(blit_fixtures::goldens.begin(), blit_fixtures::goldens.end());
    for (auto dimensions : {blit_fixtures::Dimensions{3, 3, 768, 768}, {7, 5, 1792, 1280},
                            {5, 7, 1280, 1792}, {256, 1, 255, 1}, {1, 256, 1, 255},
                            {321, 181, 160, 90}, {128, 72, 257, 145}, {1, 1, 257, 131},
                            {129, 73, 1, 1}, {17, 23, 4096, 1}, {31, 29, 1, 4096}}) result.push_back(dimensions);
    std::uint32_t seed = 732198;
    for (unsigned i = 0; i < 96; ++i) {
        std::array<int, 4> dimensions{};
        for (auto& dimension : dimensions) dimension = 1 + static_cast<int>(blit_fixtures::next(seed) % 257);
        result.push_back({dimensions[0], dimensions[1], dimensions[2], dimensions[3]});
    }
    return result;
}

} // namespace

int main() {
    try {
        const qcut_diagnostic::CglContext context;
        const std::string_view renderer(reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
        require(renderer == "Apple M4 Pro", "This blit reference profile requires the verified M4 renderer");
        const auto dimensions = cases();
        std::size_t float_channels = 0, byte_channels = 0, old_differences = 0;
        std::vector<std::uint64_t> golden_hashes;
        for (std::size_t index = 0; index < dimensions.size(); ++index) {
            const auto sizes = dimensions[index];
            const auto source = blit_fixtures::input(sizes, 987321U + static_cast<std::uint32_t>(index));
            const auto old = to_rgba8(resize(source, sizes.width, sizes.height));
            for (BlitTarget target : {BlitTarget::rgba32f, BlitTarget::rgba8}) {
                const BlitResizeRequest request{source, sizes.width, sizes.height, target};
                for (bool flip : {false, true}) {
                    Image oriented = source;
                    if (flip) {
                        for (int y = 0; y < source.height; ++y)
                            for (int x = 0; x < source.width; ++x) oriented.at(x, y) = source.at(x, source.height - 1 - y);
                    }
                    const auto expected = blit_resize({oriented, sizes.width, sizes.height, target, flip});
                    const auto actual = native_resize(request, flip);
                    for (std::size_t pixel = 0; pixel < actual.pixels.size(); ++pixel) {
                        for (std::size_t channel = 0; channel < 4; ++channel) {
                            if (std::bit_cast<std::uint32_t>(actual.pixels[pixel][channel]) !=
                                std::bit_cast<std::uint32_t>(expected.pixels[pixel][channel])) {
                                std::cerr << "case=" << index << " float=" << (target == BlitTarget::rgba32f)
                                    << " flip=" << flip << " pixel=" << pixel << " channel=" << channel
                                    << " expected=" << std::hexfloat << expected.pixels[pixel][channel]
                                    << " actual=" << actual.pixels[pixel][channel] << '\n';
                                throw std::runtime_error("Native blit float/byte mismatch");
                            }
                        }
                    }
                    if (target == BlitTarget::rgba32f) {
                        float_channels += actual.pixels.size() * 4;
                        if (!flip && index < blit_fixtures::goldens.size()) golden_hashes.push_back(blit_fixtures::float_hash(actual));
                    } else {
                        const auto bytes = to_rgba8(actual);
                        byte_channels += bytes.size();
                        if (!flip) {
                            for (std::size_t byte = 0; byte < bytes.size(); ++byte) old_differences += old[byte] != bytes[byte];
                        }
                    }
                }
            }
        }
        require(old_differences > 0, "Generic floating-point resize did not distinguish the native profile");
        std::cout << "{\"cases\":" << dimensions.size() << ",\"native_blits\":" << dimensions.size() * 4
            << ",\"float_channels\":" << float_channels << ",\"byte_channels\":" << byte_channels
            << ",\"mismatches\":0,\"generic_resize_differences\":" << old_differences << ",\"golden_fnv1a64\":[";
        for (std::size_t i = 0; i < golden_hashes.size(); ++i) {
            if (i != 0) std::cout << ',';
            std::cout << '"' << std::hex << golden_hashes[i] << std::dec << '"';
        }
        std::cout << "],\"gl_renderer\":" << std::quoted(renderer.data())
            << ",\"gl_version\":" << std::quoted(reinterpret_cast<const char*>(glGetString(GL_VERSION))) << "}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
