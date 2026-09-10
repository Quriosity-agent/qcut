#pragma once

#include "../jianying-runtime-probe/cgl-diagnostic-context.hpp"

#include <OpenGL/gl3.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace agfx_test::fragment {

inline void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

// This profile is a measurement of one renderer and one driver build. Both
// strings are part of the identity, not decoration: the same source compiled
// for a different Metal translation layer is a different measurement, and this
// oracle must refuse to relabel it. Refusal is exit code 2 at the call site.
inline constexpr std::string_view kVerifiedRenderer = "Apple M4 Pro";
inline constexpr std::string_view kVerifiedVersion = "4.1 Metal - 90.5";
inline constexpr std::string_view kVerifiedShadingLanguage = "4.10";

struct RendererIdentity {
  std::string renderer;
  std::string version;
  std::string shading_language;
  std::string vendor;

  [[nodiscard]] bool verified() const {
    return renderer == kVerifiedRenderer && version == kVerifiedVersion &&
           shading_language == kVerifiedShadingLanguage;
  }
};

inline RendererIdentity read_identity() {
  const auto read = [](GLenum name) {
    const auto* text = glGetString(name);
    require(text != nullptr, "The diagnostic context reported no renderer identity");
    return std::string(reinterpret_cast<const char*>(text));
  };
  return {read(GL_RENDERER), read(GL_VERSION), read(GL_SHADING_LANGUAGE_VERSION), read(GL_VENDOR)};
}

// A float lane: N by 1 RGBA32F in, N by 1 RGBA32F out, one fragment per input.
// Inputs arrive through a texel fetch rather than a uniform or a literal so
// that the shader compiler cannot fold the call being measured. The folded form
// is measured separately, as a control.
class FragmentLane {
 public:
  FragmentLane() {
    glGenVertexArrays(1, &vertex_array_);
    glBindVertexArray(vertex_array_);
    glDisable(GL_BLEND);
    glDisable(GL_DITHER);
    glDisable(GL_FRAMEBUFFER_SRGB);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  }
  ~FragmentLane() { glDeleteVertexArrays(1, &vertex_array_); }
  FragmentLane(const FragmentLane&) = delete;
  FragmentLane& operator=(const FragmentLane&) = delete;

  // `body` is the statement list of a main() whose inputs are `vec4 a` (the
  // primary lane), `vec4 b` (the secondary lane) and the mediump sampler
  // `u_source`, and whose output is `o`.
  std::vector<float> evaluate(const std::string& body, GLsizei width, GLsizei height,
                              const std::vector<float>& primary,
                              const std::vector<float>& secondary = {},
                              GLuint byte_source = 0) const {
    const auto texels = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    require(primary.size() == texels * 4, "Primary lane must carry four floats per fragment");
    require(secondary.empty() || secondary.size() == texels * 4,
            "Secondary lane must carry four floats per fragment");
    const GLuint first = float_texture(width, height, primary.data());
    const GLuint second = secondary.empty() ? 0 : float_texture(width, height, secondary.data());
    const GLuint target = float_texture(width, height, nullptr);
    GLuint framebuffer = 0;
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target, 0);
    require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE,
            "The RGBA32F measurement target is incomplete");
    const GLuint program = link(body);
    glUseProgram(program);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, first);
    glUniform1i(glGetUniformLocation(program, "u_primary"), 0);
    glActiveTexture(GL_TEXTURE1);
    glBindTexture(GL_TEXTURE_2D, second ? second : first);
    glUniform1i(glGetUniformLocation(program, "u_secondary"), 1);
    glActiveTexture(GL_TEXTURE2);
    glBindTexture(GL_TEXTURE_2D, byte_source ? byte_source : first);
    glUniform1i(glGetUniformLocation(program, "u_source"), 2);
    glViewport(0, 0, width, height);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    std::vector<float> output(texels * 4);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_FLOAT, output.data());
    const auto error = glGetError();
    glDeleteProgram(program);
    glDeleteFramebuffers(1, &framebuffer);
    glDeleteTextures(1, &target);
    if (second) glDeleteTextures(1, &second);
    glDeleteTextures(1, &first);
    require(error == GL_NO_ERROR, "The measurement draw or readback failed");
    return output;
  }

 private:
  static GLuint float_texture(GLsizei width, GLsizei height, const float* data) {
    GLuint texture = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, width, height, 0, GL_RGBA, GL_FLOAT, data);
    require(glGetError() == GL_NO_ERROR, "Cannot allocate an RGBA32F measurement texture");
    return texture;
  }

  static GLuint compile(GLenum stage, const std::string& source) {
    const GLuint shader = glCreateShader(stage);
    const char* text = source.c_str();
    glShaderSource(shader, 1, &text, nullptr);
    glCompileShader(shader);
    GLint compiled = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
    if (!compiled) {
      std::array<char, 4096> log{};
      GLsizei length = 0;
      glGetShaderInfoLog(shader, static_cast<GLsizei>(log.size() - 1), &length, log.data());
      glDeleteShader(shader);
      throw std::runtime_error(std::string("Measurement shader rejected: ") + log.data());
    }
    return shader;
  }

  static GLuint link(const std::string& body) {
    const std::string vertex =
        "#version 410 core\n"
        "void main() {\n"
        "  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);\n"
        "  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);\n"
        "}\n";
    const std::string fragment =
        "#version 410 core\n"
        "precision highp float;\n"
        "precision highp int;\n"
        "uniform highp sampler2D u_primary;\n"
        "uniform highp sampler2D u_secondary;\n"
        "uniform mediump sampler2D u_source;\n"
        "out highp vec4 o;\n"
        "void main() {\n"
        "  ivec2 lane = ivec2(gl_FragCoord.xy);\n"
        "  vec4 a = texelFetch(u_primary, lane, 0);\n"
        "  vec4 b = texelFetch(u_secondary, lane, 0);\n" +
        body + "}\n";
    const GLuint program = glCreateProgram();
    const GLuint vertex_shader = compile(GL_VERTEX_SHADER, vertex);
    const GLuint fragment_shader = compile(GL_FRAGMENT_SHADER, fragment);
    glAttachShader(program, vertex_shader);
    glAttachShader(program, fragment_shader);
    glLinkProgram(program);
    GLint linked = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    if (!linked) {
      std::array<char, 4096> log{};
      GLsizei length = 0;
      glGetProgramInfoLog(program, static_cast<GLsizei>(log.size() - 1), &length, log.data());
      glDeleteProgram(program);
      throw std::runtime_error(std::string("Measurement program rejected: ") + log.data());
    }
    return program;
  }

  GLuint vertex_array_ = 0;
};

// A bilinear RGBA8 source bound through a mediump sampler, which is how the
// recovered pass declares its input. The declaration is kept even though the
// desktop translation ignores precision qualifiers, because whether it ignores
// them is exactly what the sampler comparison measures.
class ByteSource {
 public:
  ByteSource(GLsizei width, GLsizei height, const std::uint8_t* bytes) {
    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, bytes);
    require(glGetError() == GL_NO_ERROR, "Cannot allocate the RGBA8 sampler source");
  }
  ~ByteSource() { glDeleteTextures(1, &texture_); }
  ByteSource(const ByteSource&) = delete;
  ByteSource& operator=(const ByteSource&) = delete;

  [[nodiscard]] GLuint texture() const { return texture_; }

 private:
  GLuint texture_ = 0;
};

}  // namespace agfx_test::fragment
