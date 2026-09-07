#include "image.hpp"
#include "../jianying-runtime-probe/cgl-diagnostic-context.hpp"

#include <OpenGL/gl3.h>
#include <OpenGL/CGLRenderers.h>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

std::vector<float> inputs() {
    std::vector<float> values;
    for (unsigned channel = 0; channel < 255; ++channel) {
        const float threshold = static_cast<float>((channel + 0.5) / 255.0);
        const auto center = std::bit_cast<std::uint32_t>(threshold);
        for (int offset = -32; offset <= 32; ++offset) {
            values.push_back(std::bit_cast<float>(static_cast<std::uint32_t>(static_cast<std::int64_t>(center) + offset)));
        }
    }
    for (std::uint32_t bits = 0; bits <= 0x3f800000U; bits += 2053U) {
        values.push_back(std::bit_cast<float>(bits));
    }
    std::uint32_t seed = 765421;
    for (unsigned index = 0; index < 131072; ++index) {
        seed = seed * 1664525U + 1013904223U;
        values.push_back(static_cast<float>(seed) / 4294967295.0F);
    }
    for (float value : {0.0F, 1.0F, -0.0F, -1.0F, 2.0F, -1e30F, 1e30F}) values.push_back(value);
    return values;
}

struct Targets {
    std::array<GLuint, 2> textures{};
    std::array<GLuint, 2> framebuffers{};
    Targets() {
        glGenTextures(2, textures.data());
        glGenFramebuffers(2, framebuffers.data());
    }
    ~Targets() {
        glDeleteFramebuffers(2, framebuffers.data());
        glDeleteTextures(2, textures.data());
    }
    Targets(const Targets&) = delete;
    Targets& operator=(const Targets&) = delete;
};

std::vector<std::uint8_t> native_conversion(const std::vector<float>& values, GLsizei width, GLsizei height) {
    Targets targets;
    for (std::size_t index = 0; index < 2; ++index) {
        glBindTexture(GL_TEXTURE_2D, targets.textures[index]);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexImage2D(GL_TEXTURE_2D, 0, index == 0 ? GL_RGBA32F : GL_RGBA8,
            width, height, 0, GL_RGBA, GL_FLOAT, index == 0 ? values.data() : nullptr);
        for (GLenum channel : {GL_TEXTURE_RED_SIZE, GL_TEXTURE_GREEN_SIZE, GL_TEXTURE_BLUE_SIZE, GL_TEXTURE_ALPHA_SIZE}) {
            GLint bits = 0;
            glGetTexLevelParameteriv(GL_TEXTURE_2D, 0, channel, &bits);
            require(bits == (index == 0 ? 32 : 8), "Unexpected native texture channel precision");
        }
        glBindFramebuffer(GL_FRAMEBUFFER, targets.framebuffers[index]);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, targets.textures[index], 0);
        require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "Incomplete quantization framebuffer");
    }
    glDisable(GL_DITHER);
    glDisable(GL_BLEND);
    glDisable(GL_FRAMEBUFFER_SRGB);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, targets.framebuffers[0]);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    std::vector<float> uploaded(values.size());
    glReadPixels(0, 0, width, height, GL_RGBA, GL_FLOAT, uploaded.data());
    for (std::size_t index = 0; index < values.size(); ++index) {
        require(std::bit_cast<std::uint32_t>(uploaded[index]) == std::bit_cast<std::uint32_t>(values[index]),
            "RGBA32F upload/readback changed input bits");
    }
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, targets.framebuffers[1]);
    glDrawBuffer(GL_COLOR_ATTACHMENT0);
    glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_NEAREST);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, targets.framebuffers[1]);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    std::vector<std::uint8_t> pixels(values.size());
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
    require(glGetError() == GL_NO_ERROR, "CGL quantization or readback failed");
    std::vector<std::uint8_t> pattern(values.size()), roundtrip(values.size());
    for (std::size_t index = 0; index < pattern.size(); ++index) pattern[index] = static_cast<std::uint8_t>(index % 256);
    glBindTexture(GL_TEXTURE_2D, targets.textures[1]);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pattern.data());
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, roundtrip.data());
    require(glGetError() == GL_NO_ERROR && pattern == roundtrip, "RGBA8 upload/readback changed known bytes");
    return pixels;
}

std::uint8_t software_quantization(float value) {
    const float scaled = softglow::saturate(value) * 255.0F;
    const float biased = scaled + 0.5F;
    return static_cast<std::uint8_t>(std::floor(biased));
}

} // namespace

int main(int argc, char** argv) {
    try {
        require(argc == 1 || (argc == 2 && std::string_view(argv[1]) == "--software"),
            "Usage: soft-glow-native-quantization [--software]");
        const qcut_diagnostic::CglContext context(argc == 2 ? kCGLRendererGenericFloatID : 0);
        const std::string_view renderer(reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
        const bool software = renderer == "Apple Software Renderer";
        require(argc == 1 || software, "Requested software renderer was not selected");
        require(software || renderer == "Apple M4 Pro", "CGL renderer has no verified conversion profile");
        auto values = inputs();
        const auto tested = values.size();
        constexpr GLsizei width = 1024;
        const auto height = static_cast<GLsizei>((values.size() + width * 4 - 1) / (width * 4));
        values.resize(static_cast<std::size_t>(width * height * 4), 0.5F);
        const auto pixels = native_conversion(values, width, height);
        const auto repeated = native_conversion(values, width, height);
        require(pixels == repeated, "Repeated native conversion changed");
        std::size_t mismatches = 0, old_mismatches = 0;
        std::size_t software_mismatches = 0;
        std::vector<std::size_t> mismatch_samples;
        std::uint64_t fingerprint = 14695981039346656037ULL;
        for (std::size_t index = 0; index < tested; ++index) {
            mismatches += softglow::quantize_unorm8(values[index]) != pixels[index];
            if (softglow::quantize_unorm8(values[index]) != pixels[index] && mismatch_samples.size() < 16) {
                mismatch_samples.push_back(index);
            }
            const auto old = static_cast<std::uint8_t>(std::round(softglow::saturate(values[index]) * 255.0F));
            old_mismatches += old != pixels[index];
            software_mismatches += software_quantization(values[index]) != pixels[index];
            fingerprint = (fingerprint ^ pixels[index]) * 1099511628211ULL;
        }
        std::cout << "{\"tested_channels\":" << tested << ",\"padded_channels\":" << values.size()
            << ",\"mismatches\":" << mismatches << ",\"old_mismatches\":" << old_mismatches
            << ",\"software_profile_mismatches\":" << software_mismatches
            << ",\"reference_profile\":\"" << (software ? "apple-software-f32-biased" : "exact-f32-to-unorm8")
            << "\",\"profile_mismatches\":" << (software ? software_mismatches : mismatches)
            << ",\"rgba32f_upload_bits_preserved\":true,\"rgba8_byte_roundtrip\":true"
            << ",\"repeat_identical\":true,\"output_fnv1a64\":\"" << std::hex << fingerprint << std::dec
            << "\",\"gl_version\":" << std::quoted(reinterpret_cast<const char*>(glGetString(GL_VERSION)))
            << ",\"gl_renderer\":" << std::quoted(reinterpret_cast<const char*>(glGetString(GL_RENDERER)))
            << ",\"gl_vendor\":" << std::quoted(reinterpret_cast<const char*>(glGetString(GL_VENDOR)))
            << ",\"source_channel_bits\":32,\"target_channel_bits\":8"
            << ",\"mismatch_samples\":[";
        for (std::size_t sample = 0; sample < mismatch_samples.size(); ++sample) {
            const auto index = mismatch_samples[sample];
            if (sample != 0) std::cout << ',';
            std::cout << "{\"index\":" << index << ",\"float_bits\":" << std::bit_cast<std::uint32_t>(values[index])
                << ",\"expected\":" << static_cast<unsigned>(softglow::quantize_unorm8(values[index]))
                << ",\"actual\":" << static_cast<unsigned>(pixels[index]) << '}';
        }
        std::cout << "]}" << std::endl;
        require((software ? software_mismatches : mismatches) == 0, "Native conversion differs from its explicit renderer profile");
        require(mismatches == (software ? 128U : 0U) && old_mismatches == (software ? 1U : 127U),
            "Expected conversion negative controls differ");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
