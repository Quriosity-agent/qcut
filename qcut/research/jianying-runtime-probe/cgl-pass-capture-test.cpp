#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include "cgl-diagnostic-context.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr GLsizei width = 7;
constexpr GLsizei height = 5;
constexpr GLuint source_unit = 2;
constexpr GLuint idle_unit = 5;

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

GLint integer(GLenum name) {
  GLint value = 0;
  glGetIntegerv(name, &value);
  return value;
}

void no_error(const char* label) {
  const auto error = glGetError();
  require(error == GL_NO_ERROR, std::string(label) + " GL error=" + std::to_string(error));
}

using Context = qcut_diagnostic::CglContext;

bool sampler_supported() {
  const auto major = integer(GL_MAJOR_VERSION), minor = integer(GL_MINOR_VERSION);
  if (major > 3 || (major == 3 && minor >= 3)) return true;
  const auto count = integer(GL_NUM_EXTENSIONS);
  for (GLint index = 0; index < count; ++index) {
    const auto* extension = glGetStringi(GL_EXTENSIONS, static_cast<GLuint>(index));
    if (extension && std::string(reinterpret_cast<const char*>(extension)) == "GL_ARB_sampler_objects") {
      return true;
    }
  }
  return false;
}

GLuint shader(GLenum type, const char* source) {
  const auto result = glCreateShader(type);
  glShaderSource(result, 1, &source, nullptr);
  glCompileShader(result);
  GLint compiled = 0;
  glGetShaderiv(result, GL_COMPILE_STATUS, &compiled);
  if (!compiled) {
    std::array<char, 2048> log{};
    glGetShaderInfoLog(result, static_cast<GLsizei>(log.size()), nullptr, log.data());
    throw std::runtime_error(std::string("Fixture shader: ") + log.data());
  }
  return result;
}

GLuint program() {
  const auto vertex = shader(GL_VERTEX_SHADER, R"(#version 150
void main() {
  vec2 positions[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
  gl_Position = vec4(positions[gl_VertexID], 0, 1);
})");
  const auto fragment = shader(GL_FRAGMENT_SHADER, R"(#version 150
uniform sampler2D sourceTex;
uniform float gain;
out vec4 result;
void main() { result = texelFetch(sourceTex, ivec2(gl_FragCoord.xy), 0) * gain; }
)");
  const auto result = glCreateProgram();
  glAttachShader(result, vertex);
  glAttachShader(result, fragment);
  glBindFragDataLocation(result, 0, "result");
  glLinkProgram(result);
  GLint linked = 0;
  glGetProgramiv(result, GL_LINK_STATUS, &linked);
  require(linked != 0, "Fixture program link failed");
  glDeleteShader(vertex);
  glDeleteShader(fragment);
  return result;
}

std::vector<std::uint8_t> fixture() {
  std::vector<std::uint8_t> pixels(static_cast<std::size_t>(width * height * 4));
  for (GLsizei y = 0; y < height; ++y) {
    for (GLsizei x = 0; x < width; ++x) {
      const auto offset = static_cast<std::size_t>((y * width + x) * 4);
      pixels[offset] = static_cast<std::uint8_t>(x * 17 + y * 3 + 1);
      pixels[offset + 1] = static_cast<std::uint8_t>(y * 47 + x);
      pixels[offset + 2] = static_cast<std::uint8_t>(x * 13 + y * 29);
      pixels[offset + 3] = static_cast<std::uint8_t>(x * 23 + y * 7);
    }
  }
  return pixels;
}

GLuint texture(GLint format, const std::vector<std::uint8_t>& pixels) {
  GLuint name = 0;
  glGenTextures(1, &name);
  glBindTexture(GL_TEXTURE_2D, name);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_MIRRORED_REPEAT);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
  glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
  return name;
}

GLuint framebuffer(GLint format, const std::vector<std::uint8_t>& pixels) {
  GLuint name = 0;
  glGenFramebuffers(1, &name);
  glBindFramebuffer(GL_FRAMEBUFFER, name);
  for (GLuint index = 0; index < 2; ++index) {
    const auto color = texture(format, pixels);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + index, GL_TEXTURE_2D, color, 0);
  }
  glDrawBuffer(GL_COLOR_ATTACHMENT0);
  glReadBuffer(GL_COLOR_ATTACHMENT1);
  require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "Fixture FBO incomplete");
  return name;
}

struct State {
  std::vector<GLint> values;
  bool operator==(const State&) const = default;
};

State state(bool samplers, GLuint destination) {
  State result;
  for (GLenum field : {GL_DRAW_FRAMEBUFFER_BINDING, GL_READ_FRAMEBUFFER_BINDING,
                       GL_READ_BUFFER, GL_PIXEL_PACK_BUFFER_BINDING, GL_PIXEL_UNPACK_BUFFER_BINDING,
                       GL_CURRENT_PROGRAM, GL_ACTIVE_TEXTURE, GL_VERTEX_ARRAY_BINDING,
                       GL_ELEMENT_ARRAY_BUFFER_BINDING, GL_PACK_ALIGNMENT, GL_PACK_ROW_LENGTH,
                       GL_PACK_SKIP_ROWS, GL_PACK_SKIP_PIXELS, GL_UNPACK_ALIGNMENT,
                       GL_UNPACK_ROW_LENGTH, GL_UNPACK_SKIP_ROWS, GL_UNPACK_SKIP_PIXELS}) {
    result.values.push_back(integer(field));
  }
  std::array<GLint, 4> viewport{};
  glGetIntegerv(GL_VIEWPORT, viewport.data());
  result.values.insert(result.values.end(), viewport.begin(), viewport.end());
  const auto active = integer(GL_ACTIVE_TEXTURE);
  for (GLuint unit = 0; unit < 8; ++unit) {
    glActiveTexture(GL_TEXTURE0 + unit);
    result.values.push_back(integer(GL_TEXTURE_BINDING_2D));
    if (samplers) result.values.push_back(integer(GL_SAMPLER_BINDING));
  }
  glActiveTexture(static_cast<GLenum>(active));
  const auto read = integer(GL_READ_FRAMEBUFFER_BINDING);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, destination);
  result.values.push_back(integer(GL_READ_BUFFER));
  glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(read));
  no_error("State snapshot");
  return result;
}

std::vector<std::uint8_t> read_pixels(GLuint framebuffer_name) {
  glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glPixelStorei(GL_PACK_ROW_LENGTH, 0);
  glPixelStorei(GL_PACK_SKIP_ROWS, 0);
  glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, framebuffer_name);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  std::vector<std::uint8_t> result(static_cast<std::size_t>(width * height * 4));
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, result.data());
  no_error("Fixture readback");
  return result;
}

void gate(bool enabled) {
  const char* path = std::getenv("QCUT_CGL_CAPTURE_GATE");
  require(path && path[0] == '/', "Fixture requires absolute capture gate path");
  if (enabled) {
    std::ofstream stream(path);
    stream << "self-test\n";
    stream.close();
    require(static_cast<bool>(stream), "Cannot enable capture gate");
    return;
  }
  std::filesystem::remove(path);
}

void run(const std::string& mode) {
  Context context;
  const bool samplers = sampler_supported();
  std::cout << "{\"glVersion\":\"" << glGetString(GL_VERSION)
            << "\",\"samplerSupported\":" << (samplers ? "true" : "false") << "}\n" << std::flush;
  if (mode == "capabilities") return;
  require(mode == "positive" || mode == "sampler" || mode == "mrt" || mode == "format",
          "Unknown fixture mode");
  require(mode != "sampler" || samplers, "Sampler negative requires actual sampler support");
  gate(false);
  glDisable(GL_DITHER);
  glDisable(GL_BLEND);
  glDisable(GL_FRAMEBUFFER_SRGB);
  const auto pixels = fixture();
  const auto destination = framebuffer(mode == "format" ? GL_RGBA16F : GL_RGBA8, pixels);
  const auto spare_read = framebuffer(GL_RGBA8, pixels);
  const auto blit_destination = framebuffer(GL_RGBA8, std::vector<std::uint8_t>(pixels.size()));
  glActiveTexture(GL_TEXTURE0 + source_unit);
  const auto source_texture = texture(GL_RGBA8, pixels);
  require(source_texture != 0, "Cannot create source texture");
  glActiveTexture(GL_TEXTURE0 + idle_unit);
  texture(GL_RGBA8, pixels);
  const auto shader_program = program();
  glUseProgram(shader_program);
  glUniform1i(glGetUniformLocation(shader_program, "sourceTex"), source_unit);
  glUniform1f(glGetUniformLocation(shader_program, "gain"), 1);
  GLuint vao = 0, indices = 0, pack = 0, unpack = 0;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &indices);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, indices);
  const std::array<GLuint, 3> triangle{0, 1, 2};
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(triangle), triangle.data(), GL_STATIC_DRAW);
  const std::array<std::uint8_t, 4096> pbo_sentinel = [] {
    std::array<std::uint8_t, 4096> value{}; value.fill(0x3c); return value;
  }();
  glGenBuffers(1, &pack);
  glBindBuffer(GL_PIXEL_PACK_BUFFER, pack);
  glBufferData(GL_PIXEL_PACK_BUFFER, pbo_sentinel.size(), pbo_sentinel.data(), GL_STREAM_READ);
  glGenBuffers(1, &unpack);
  glBindBuffer(GL_PIXEL_UNPACK_BUFFER, unpack);
  glBufferData(GL_PIXEL_UNPACK_BUFFER, pbo_sentinel.size(), pbo_sentinel.data(), GL_STREAM_DRAW);
  glPixelStorei(GL_PACK_ALIGNMENT, 8);
  glPixelStorei(GL_PACK_ROW_LENGTH, 23);
  glPixelStorei(GL_PACK_SKIP_ROWS, 2);
  glPixelStorei(GL_PACK_SKIP_PIXELS, 3);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 8);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 19);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 1);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 2);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, destination);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, spare_read);
  glViewport(0, 0, width, height);
  if (mode == "mrt") {
    const std::array<GLenum, 2> outputs{GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1};
    glDrawBuffers(static_cast<GLsizei>(outputs.size()), outputs.data());
  }
  if (mode == "sampler") {
    GLuint sampler = 0;
    glGenSamplers(1, &sampler);
    glSamplerParameteri(sampler, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glSamplerParameteri(sampler, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glSamplerParameteri(sampler, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glSamplerParameteri(sampler, GL_TEXTURE_WRAP_T, GL_MIRRORED_REPEAT);
    glBindSampler(source_unit, sampler);
  }
  no_error("Fixture setup");
  const auto original = state(samplers, destination);
  gate(true);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  require(mode == "positive" || mode == "sampler", "Negative control returned from observed draw");
  require(state(samplers, destination) == original, "Observer changed drawArrays GL state");
  glDrawElements(GL_TRIANGLES, 3, GL_UNSIGNED_INT, nullptr);
  require(state(samplers, destination) == original, "Observer changed drawElements GL state");
  std::array<std::uint8_t, 4096> pbo_after{};
  glGetBufferSubData(GL_PIXEL_PACK_BUFFER, 0, pbo_after.size(), pbo_after.data());
  require(pbo_after == pbo_sentinel, "Observer wrote into the caller's pack PBO");

  glBindFramebuffer(GL_READ_FRAMEBUFFER, destination);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, blit_destination);
  const auto before_blit = state(samplers, blit_destination);
  glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_LINEAR);
  require(state(samplers, blit_destination) == before_blit, "Observer changed blit GL state");
  glGetBufferSubData(GL_PIXEL_PACK_BUFFER, 0, pbo_after.size(), pbo_after.data());
  require(pbo_after == pbo_sentinel, "Blit observer wrote into the caller's pack PBO");
  gate(false);
  require(read_pixels(destination) == pixels, "Observer changed rendered RGBA output");
  require(read_pixels(blit_destination) == pixels, "Observer changed blit RGBA output");
  const char* directory = std::getenv("QCUT_CGL_CAPTURE_DIRECTORY");
  require(directory && directory[0] == '/', "Fixture requires absolute output directory");
  std::ofstream expected(std::filesystem::path(directory) / "expected.rgba", std::ios::binary);
  expected.write(reinterpret_cast<const char*>(pixels.data()), static_cast<std::streamsize>(pixels.size()));
  expected.close();
  require(static_cast<bool>(expected), "Cannot save expected pixels");
  std::cout << "{\"passed\":true,\"stateComparisons\":3,\"pboComparisons\":2,\"pixelComparisons\":2}\n";
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: cgl-pass-capture-test positive|sampler|mrt|format|capabilities");
    run(argv[1]);
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
