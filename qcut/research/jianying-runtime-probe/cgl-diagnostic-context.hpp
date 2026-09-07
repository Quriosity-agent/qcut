#pragma once

#include <OpenGL/OpenGL.h>
#include <stdexcept>

namespace qcut_diagnostic {

class CglContext {
 public:
  CglContext() {
    const CGLPixelFormatAttribute attributes[]{
        kCGLPFAOpenGLProfile, static_cast<CGLPixelFormatAttribute>(kCGLOGLPVersion_3_2_Core),
        kCGLPFAAllowOfflineRenderers, static_cast<CGLPixelFormatAttribute>(0)};
    CGLPixelFormatObj format = nullptr;
    GLint count = 0;
    const auto chosen = CGLChoosePixelFormat(attributes, &format, &count);
    if (chosen != kCGLNoError || !format) {
      if (format) CGLDestroyPixelFormat(format);
      throw std::runtime_error("Cannot choose diagnostic CGL format");
    }
    const auto created = CGLCreateContext(format, nullptr, &context_);
    CGLDestroyPixelFormat(format);
    if (created != kCGLNoError || !context_) {
      if (context_) CGLReleaseContext(context_);
      throw std::runtime_error("Cannot create diagnostic CGL context");
    }
    previous_ = CGLGetCurrentContext();
    if (CGLSetCurrentContext(context_) != kCGLNoError) {
      CGLReleaseContext(context_);
      throw std::runtime_error("Cannot activate diagnostic CGL context");
    }
  }
  ~CglContext() {
    CGLSetCurrentContext(previous_);
    CGLReleaseContext(context_);
  }
  CglContext(const CglContext&) = delete;
  CglContext& operator=(const CglContext&) = delete;

 private:
  CGLContextObj context_ = nullptr;
  CGLContextObj previous_ = nullptr;
};

} // namespace qcut_diagnostic
