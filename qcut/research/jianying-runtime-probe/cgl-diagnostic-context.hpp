#pragma once

#include <OpenGL/OpenGL.h>
#include <stdexcept>
#include <type_traits>
#include <vector>

namespace qcut_diagnostic {

class CglContext {
 public:
  explicit CglContext(GLint renderer_id = 0) {
    // CGL interleaves enum keys and integer payloads; payloads are not valid C++ enum values.
    using AttributeWord = std::underlying_type_t<CGLPixelFormatAttribute>;
    std::vector<AttributeWord> attributes{
        kCGLPFAOpenGLProfile, kCGLOGLPVersion_3_2_Core,
        kCGLPFAAllowOfflineRenderers};
    if (renderer_id != 0) {
      attributes.push_back(kCGLPFARendererID);
      attributes.push_back(static_cast<AttributeWord>(renderer_id));
    }
    attributes.push_back(0);
    CGLPixelFormatObj format = nullptr;
    GLint count = 0;
    const auto chosen = CGLChoosePixelFormat(
        reinterpret_cast<const CGLPixelFormatAttribute*>(attributes.data()), &format, &count);
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
