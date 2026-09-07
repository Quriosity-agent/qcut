#include <OpenGL/gl3.h>

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct Blit {
  std::array<GLint, 8> coordinates;
  GLbitfield mask;
  GLenum filter;
};

bool supports_sampler_objects() {
  GLint major = 0, minor = 0, count = 0;
  glGetIntegerv(GL_MAJOR_VERSION, &major);
  glGetIntegerv(GL_MINOR_VERSION, &minor);
  if (major > 3 || (major == 3 && minor >= 3)) return true;
  glGetIntegerv(GL_NUM_EXTENSIONS, &count);
  for (GLint index = 0; index < count; ++index) {
    const auto* extension = glGetStringi(GL_EXTENSIONS, static_cast<GLuint>(index));
    if (extension && std::string_view(reinterpret_cast<const char*>(extension)) == "GL_ARB_sampler_objects") return true;
  }
  return false;
}

void capture(const Blit* blit = nullptr) {
  const char* directory = std::getenv("QCUT_CGL_CAPTURE_DIRECTORY");
  if (!directory || directory[0] != '/') return;
  const char* gate = std::getenv("QCUT_CGL_CAPTURE_GATE");
  if (!gate || gate[0] != '/' || !std::filesystem::is_regular_file(gate)) return;
  static std::mutex lock;
  const std::lock_guard guard(lock);
  static unsigned sequence = 0;
  if (sequence >= 256) throw std::runtime_error("CGL capture draw limit exceeded");
  if (glGetError() != GL_NO_ERROR) throw std::runtime_error("Native draw has a GL error");

  GLint framebuffer = 0;
  GLint program = 0;
  GLint active_texture = 0;
  std::array<GLint, 4> viewport{};
  glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &framebuffer);
  glGetIntegerv(GL_CURRENT_PROGRAM, &program);
  glGetIntegerv(GL_ACTIVE_TEXTURE, &active_texture);
  const bool sampler_objects = supports_sampler_objects();
  glGetIntegerv(GL_VIEWPORT, viewport.data());
  if (blit) {
    const auto& coordinates = blit->coordinates;
    const auto width = std::abs(static_cast<std::int64_t>(coordinates[6]) - coordinates[4]);
    const auto height = std::abs(static_cast<std::int64_t>(coordinates[7]) - coordinates[5]);
    if (width > 2048 || height > 2048 || coordinates[4] != 0 || coordinates[5] != 0 ||
        blit->mask != GL_COLOR_BUFFER_BIT || blit->filter != GL_LINEAR) {
      throw std::runtime_error("Unsupported diagnostic blit rectangle, mask or filter");
    }
    viewport = {0, 0, static_cast<GLint>(width), static_cast<GLint>(height)};
  }
  if (!framebuffer || viewport[0] != 0 || viewport[1] != 0 || viewport[2] < 1 || viewport[3] < 1 ||
      viewport[2] > 2048 || viewport[3] > 2048) {
    throw std::runtime_error("Unsupported diagnostic framebuffer or viewport");
  }
  GLint draw_buffers = 0;
  glGetIntegerv(GL_MAX_DRAW_BUFFERS, &draw_buffers);
  for (GLint index = 0; index < draw_buffers; ++index) {
    GLint buffer = 0;
    glGetIntegerv(GL_DRAW_BUFFER0 + static_cast<GLenum>(index), &buffer);
    if (buffer != (index == 0 ? GL_COLOR_ATTACHMENT0 : GL_NONE)) {
      throw std::runtime_error("Capture requires a single COLOR_ATTACHMENT0 draw target");
    }
  }
  GLint attachment_type = 0;
  GLint texture = 0;
  GLint level = 0;
  glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
      GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, &attachment_type);
  glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
      GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME, &texture);
  glGetFramebufferAttachmentParameteriv(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
      GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL, &level);
  if (attachment_type != GL_TEXTURE || !texture) throw std::runtime_error("Capture requires a texture attachment");

  GLint previous_texture = 0;
  glGetIntegerv(GL_TEXTURE_BINDING_2D, &previous_texture);
  glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture));
  GLint width = 0, height = 0, format = 0;
  glGetTexLevelParameteriv(GL_TEXTURE_2D, level, GL_TEXTURE_WIDTH, &width);
  glGetTexLevelParameteriv(GL_TEXTURE_2D, level, GL_TEXTURE_HEIGHT, &height);
  glGetTexLevelParameteriv(GL_TEXTURE_2D, level, GL_TEXTURE_INTERNAL_FORMAT, &format);
  glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(previous_texture));
  if (width != viewport[2] || height != viewport[3]) throw std::runtime_error("Capture viewport differs from attachment");
  if (format != GL_RGBA8) throw std::runtime_error("This byte capture profile requires RGBA8 targets");

  std::ostringstream metadata;
  metadata << "{\"draw\":" << sequence << ",\"kind\":\"" << (blit ? "blit" : "draw")
      << "\",\"framebuffer\":" << framebuffer
      << ",\"texture\":" << texture << ",\"program\":" << program
      << ",\"width\":" << width << ",\"height\":" << height
      << ",\"internalFormat\":" << format;
  if (blit) {
    metadata << ",\"blitCoordinates\":[";
    for (std::size_t i = 0; i < blit->coordinates.size(); ++i) metadata << (i ? "," : "") << blit->coordinates[i];
    metadata << "],\"blitMask\":" << blit->mask << ",\"blitFilter\":" << blit->filter;
  }
  metadata << ",\"uniforms\":[";
  GLint uniforms = 0;
  if (!blit) glGetProgramiv(static_cast<GLuint>(program), GL_ACTIVE_UNIFORMS, &uniforms);
  if (uniforms < 0 || uniforms > 256) throw std::runtime_error("Too many diagnostic uniforms");
  for (GLint index = 0; index < uniforms; ++index) {
    std::array<char, 512> name{};
    GLsizei length = 0;
    GLint size = 0;
    GLenum type = 0;
    glGetActiveUniform(static_cast<GLuint>(program), static_cast<GLuint>(index), name.size(),
        &length, &size, &type, name.data());
    const GLint location = glGetUniformLocation(static_cast<GLuint>(program), name.data());
    if (index) metadata << ',';
    metadata << "{\"name\":" << std::quoted(name.data()) << ",\"type\":" << type << ",\"size\":" << size;
    if (type == GL_SAMPLER_2D && size == 1) {
      GLint unit = 0, binding = 0;
      glGetUniformiv(static_cast<GLuint>(program), location, &unit);
      if (unit < 0 || unit > 31) throw std::runtime_error("Unsupported sampler unit");
      glActiveTexture(GL_TEXTURE0 + static_cast<GLenum>(unit));
      GLint sampler = 0;
      if (sampler_objects) glGetIntegerv(GL_SAMPLER_BINDING, &sampler);
      glGetIntegerv(GL_TEXTURE_BINDING_2D, &binding);
      metadata << ",\"unit\":" << unit << ",\"sampler\":" << sampler << ",\"texture\":" << binding;
      if (binding) {
        for (const auto& field : std::array<std::pair<GLenum, const char*>, 4>{{
                 {GL_TEXTURE_MIN_FILTER, "min"}, {GL_TEXTURE_MAG_FILTER, "mag"},
                 {GL_TEXTURE_WRAP_S, "wrapS"}, {GL_TEXTURE_WRAP_T, "wrapT"}}}) {
          GLint value = 0;
          if (sampler) glGetSamplerParameteriv(static_cast<GLuint>(sampler), field.first, &value);
          else glGetTexParameteriv(GL_TEXTURE_2D, field.first, &value);
          metadata << ",\"" << field.second << "\":" << value;
        }
      }
    } else if (size == 1 && (type == GL_INT || type == GL_BOOL)) {
      GLint value = 0;
      glGetUniformiv(static_cast<GLuint>(program), location, &value);
      metadata << ",\"values\":[" << value << ']';
    } else if (size == 1 && (type == GL_FLOAT || type == GL_FLOAT_VEC2 || type == GL_FLOAT_VEC3 || type == GL_FLOAT_VEC4 || type == GL_FLOAT_MAT4)) {
      std::array<GLfloat, 16> values{};
      glGetUniformfv(static_cast<GLuint>(program), location, values.data());
      const int count = type == GL_FLOAT ? 1 : type == GL_FLOAT_MAT4 ? 16 : static_cast<int>(type - GL_FLOAT_VEC2) + 2;
      metadata << ",\"values\":[";
      for (int c = 0; c < count; ++c) metadata << (c ? "," : "") << std::setprecision(9) << values[static_cast<std::size_t>(c)];
      metadata << ']';
    }
    metadata << '}';
  }
  glActiveTexture(static_cast<GLenum>(active_texture));
  metadata << "]}";

  GLint read_framebuffer = 0, read_buffer = 0, pack_buffer = 0;
  glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read_framebuffer);
  glGetIntegerv(GL_READ_BUFFER, &read_buffer);
  glGetIntegerv(GL_PIXEL_PACK_BUFFER_BINDING, &pack_buffer);
  constexpr std::array<GLenum, 4> pack_fields{{GL_PACK_ALIGNMENT, GL_PACK_ROW_LENGTH, GL_PACK_SKIP_ROWS, GL_PACK_SKIP_PIXELS}};
  std::array<GLint, 4> pack_values{};
  for (std::size_t i = 0; i < pack_fields.size(); ++i) {
    glGetIntegerv(pack_fields[i], &pack_values[i]);
    glPixelStorei(pack_fields[i], i == 0 ? 1 : 0);
  }
  glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(framebuffer));
  GLint attachment_read_buffer = 0;
  glGetIntegerv(GL_READ_BUFFER, &attachment_read_buffer);
  glReadBuffer(GL_COLOR_ATTACHMENT0);
  std::vector<unsigned char> pixels(static_cast<std::size_t>(width) * height * 4);
  static std::size_t captured_bytes = 0;
  captured_bytes += pixels.size();
  if (captured_bytes > 512 * 1024 * 1024) throw std::runtime_error("Capture byte budget exceeded");
  glFinish();
  glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
  glReadBuffer(static_cast<GLenum>(attachment_read_buffer));
  glBindFramebuffer(GL_READ_FRAMEBUFFER, static_cast<GLuint>(read_framebuffer));
  glReadBuffer(static_cast<GLenum>(read_buffer));
  glBindBuffer(GL_PIXEL_PACK_BUFFER, static_cast<GLuint>(pack_buffer));
  for (std::size_t i = 0; i < pack_fields.size(); ++i) glPixelStorei(pack_fields[i], pack_values[i]);
  if (glGetError() != GL_NO_ERROR) throw std::runtime_error("CGL capture state/readback failed");

  const std::filesystem::path root(directory);
  std::ofstream output(root / (std::to_string(sequence) + ".rgba"), std::ios::binary);
  output.write(reinterpret_cast<const char*>(pixels.data()), static_cast<std::streamsize>(pixels.size()));
  std::ofstream manifest(root / "draws.ndjson", std::ios::app);
  manifest << metadata.str() << '\n';
  output.close();
  manifest.close();
  if (!output || !manifest) throw std::runtime_error("CGL capture write failed");
  ++sequence;
}

void checked_capture(const Blit* blit = nullptr) noexcept {
  try { capture(blit); }
  catch (const std::exception& error) {
    fprintf(stderr, "QCut CGL capture failed: %s\n", error.what());
    std::abort();
  }
}

void draw_arrays(GLenum mode, GLint first, GLsizei count) {
  glDrawArrays(mode, first, count);
  checked_capture();
}

void draw_elements(GLenum mode, GLsizei count, GLenum type, const void* indices) {
  glDrawElements(mode, count, type, indices);
  checked_capture();
}

void blit_framebuffer(GLint sx0, GLint sy0, GLint sx1, GLint sy1,
                      GLint dx0, GLint dy0, GLint dx1, GLint dy1,
                      GLbitfield mask, GLenum filter) {
  glBlitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter);
  const Blit blit{{sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1}, mask, filter};
  checked_capture(&blit);
}

struct Interpose { const void* replacement; const void* original; };
__attribute__((used, section("__DATA,__interpose"))) const Interpose interpositions[] = {
    {reinterpret_cast<const void*>(&draw_arrays), reinterpret_cast<const void*>(&glDrawArrays)},
    {reinterpret_cast<const void*>(&draw_elements), reinterpret_cast<const void*>(&glDrawElements)},
    {reinterpret_cast<const void*>(&blit_framebuffer), reinterpret_cast<const void*>(&glBlitFramebuffer)},
};

} // namespace
