#pragma once

#include <OpenGL/gl3.h>
#include <initializer_list>
#include <stdexcept>

namespace qcut_diagnostic {

class CglImageTarget {
 public:
  CglImageTarget(GLsizei width, GLsizei height, GLint format, GLenum input_type, const void* data) {
    if (width <= 0 || height <= 0 || (format != GL_RGBA8 && format != GL_RGBA32F)) {
      throw std::invalid_argument("Diagnostic target requires positive RGBA8/RGBA32F dimensions");
    }
    glGenTextures(1, &texture);
    glGenFramebuffers(1, &framebuffer);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, GL_RGBA, input_type, data);
    bool valid = true;
    for (GLenum channel : {GL_TEXTURE_RED_SIZE, GL_TEXTURE_GREEN_SIZE, GL_TEXTURE_BLUE_SIZE, GL_TEXTURE_ALPHA_SIZE}) {
      GLint bits = 0;
      glGetTexLevelParameteriv(GL_TEXTURE_2D, 0, channel, &bits);
      valid = valid && bits == (format == GL_RGBA32F ? 32 : 8);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    valid = valid && glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    if (!valid || glGetError() != GL_NO_ERROR) {
      release();
      throw std::runtime_error("Diagnostic target allocation or channel precision failed");
    }
  }
  ~CglImageTarget() { release(); }
  CglImageTarget(const CglImageTarget&) = delete;
  CglImageTarget& operator=(const CglImageTarget&) = delete;

  GLuint texture = 0;
  GLuint framebuffer = 0;

 private:
  void release() {
    glDeleteFramebuffers(1, &framebuffer);
    glDeleteTextures(1, &texture);
  }
};

} // namespace qcut_diagnostic
