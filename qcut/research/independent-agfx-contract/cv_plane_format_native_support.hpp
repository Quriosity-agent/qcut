#pragma once

#include "../jianying-runtime-probe/agfx-library.hpp"
#include "cv_plane_format_fixtures.hpp"

#include <CoreVideo/CoreVideo.h>
#include <fcntl.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace agfx_test::diagnostic {

// Load addresses pinned against the arm64 slice of the SHA-256 and UUID that
// agfx-library.hpp already verifies. Every symbol below must resolve to
// base + offset or the oracle refuses to call anything.
struct PinnedSymbol {
  const char* name;
  std::uintptr_t offset;
};

inline constexpr PinnedSymbol kGlesSymbol{
    "_ZN13AmazingEngine23getPlanePixelFormatGLESEjmRjS0_S0_S0_b", 0xc03c4};
inline constexpr PinnedSymbol kMetalSymbol{
    "_ZN13AmazingEngine24getPlanePixelFormatMetalEjmb", 0xc02dc};
inline constexpr PinnedSymbol kAmgSymbol{
    "_ZN13AmazingEngine9AGFXUtils8Internal23getPlanePixelFormatGLESEjmRNS_14AMGPixelFormatE",
    0x160e0};
inline constexpr PinnedSymbol kBufferSymbol{
    "_ZN13AmazingEngine14getPixelFormatEP10__CVBufferb", 0x85a9c};
inline constexpr PinnedSymbol kLogInstanceSymbol{
    "_ZN13AmazingEngine11AELogSystem8instanceEv", 0xc623c};
inline constexpr PinnedSymbol kLogLevelSymbol{
    "_ZN13AmazingEngine11AELogSystem11SetLogLevelEii", 0xc74c8};

inline void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

// Redirects both standard descriptors into one temporary file so the oracle can
// prove the silenced log system emits nothing. The vendor writes its rejection
// lines to descriptor 1, so watching descriptor 2 alone would report a vacuous
// zero. Without the silencing every rejected source formats a line, which is
// both a throughput problem and a signal that the singleton was not configured.
class OutputCapture {
 public:
  OutputCapture() {
    std::strcpy(path_.data(), "/tmp/agfx-cv-plane-output.XXXXXX");
    file_ = mkstemp(path_.data());
    require(file_ >= 0, "Cannot open the output capture file");
    std::fflush(stdout);
    std::fflush(stderr);
    for (std::size_t index = 0; index < descriptors_.size(); ++index) {
      saved_[index] = dup(descriptors_[index]);
      require(saved_[index] >= 0, "Cannot duplicate a standard descriptor");
      require(dup2(file_, descriptors_[index]) >= 0, "Cannot redirect a standard descriptor");
    }
  }
  ~OutputCapture() { restore(); }
  OutputCapture(const OutputCapture&) = delete;
  OutputCapture& operator=(const OutputCapture&) = delete;

  // Returns the bytes the vendor library wrote while the capture was active.
  std::size_t restore() {
    if (file_ < 0) return bytes_;
    std::fflush(stdout);
    std::fflush(stderr);
    for (std::size_t index = 0; index < descriptors_.size(); ++index) {
      if (saved_[index] < 0) continue;
      dup2(saved_[index], descriptors_[index]);
      close(saved_[index]);
      saved_[index] = -1;
    }
    const auto end = lseek(file_, 0, SEEK_END);
    bytes_ = end > 0 ? static_cast<std::size_t>(end) : 0;
    close(file_);
    file_ = -1;
    unlink(path_.data());
    return bytes_;
  }

 private:
  static constexpr std::array<int, 2> descriptors_{STDOUT_FILENO, STDERR_FILENO};
  std::array<char, 64> path_{};
  std::array<int, 2> saved_{-1, -1};
  int file_ = -1;
  std::size_t bytes_ = 0;
};

// The three plane entries plus the CoreVideo-buffer entry, bound through the
// verified image. Nothing here fabricates an object: all four are free
// functions and the only pointer arguments are the caller's own stack slots.
class NativePlaneResolver {
 public:
  explicit NativePlaneResolver(const char* path)
      : library_(agfx_probe::loadVerifiedLibrary({path})),
        gles_(pinned<GlesFunction>(kGlesSymbol)),
        metal_(pinned<MetalFunction>(kMetalSymbol)),
        amg_(pinned<AmgFunction>(kAmgSymbol)),
        buffer_(pinned<BufferFunction>(kBufferSymbol)) {
    static_assert(sizeof(std::size_t) == 8, "The plane index must reach the callee as 64 bits");
  }
  ~NativePlaneResolver() {
    if (library_.handle) dlclose(library_.handle);
  }
  NativePlaneResolver(const NativePlaneResolver&) = delete;
  NativePlaneResolver& operator=(const NativePlaneResolver&) = delete;

  // Real singleton from the library's own factory, then the library's own
  // setter. This is the vendor log system, not a stand-in for it.
  void silence_logs() const {
    const auto instance = pinned<void* (*)()>(kLogInstanceSymbol);
    const auto set_level = pinned<void (*)(void*, int, int)>(kLogLevelSymbol);
    void* log_system = instance();
    require(log_system != nullptr, "AELogSystem::instance() returned null");
    set_level(log_system, 0, 0);
  }

  PlaneObservation observe(const agfx_contract::PlaneFormatRequest& request) const {
    auto observation = seeded_observation();
    const auto plane = static_cast<std::size_t>(request.plane_index);
    observation.gles_recognized =
        gles_(request.source_format, plane, observation.gles.format, observation.gles.type,
              observation.gles.internal_format, observation.gles.flag, request.prefer_bgra);
    observation.amg_recognized = amg_(request.source_format, plane, observation.amg);
    observation.metal = metal_(request.source_format, plane, request.prefer_bgra);
    return observation;
  }

  std::uint32_t buffer_format(CVPixelBufferRef buffer, bool prefer_bgra) const {
    return buffer_(buffer, prefer_bgra);
  }

  const agfx_probe::LibraryIdentity& library() const { return library_; }

 private:
  using GlesFunction = bool (*)(std::uint32_t, std::size_t, std::uint32_t&, std::uint32_t&,
                                std::uint32_t&, std::uint32_t&, bool);
  using MetalFunction = std::uint64_t (*)(std::uint32_t, std::size_t, bool);
  using AmgFunction = bool (*)(std::uint32_t, std::size_t, std::uint32_t&);
  using BufferFunction = std::uint32_t (*)(CVPixelBufferRef, bool);

  template <typename Function>
  Function pinned(const PinnedSymbol& symbol) const {
    const auto resolved = agfx_probe::resolve<Function>(library_, symbol.name);
    const auto address = reinterpret_cast<std::uintptr_t>(resolved);
    const auto expected = reinterpret_cast<std::uintptr_t>(library_.base) + symbol.offset;
    require(address == expected,
            std::string("Symbol is not at its pinned offset: ") + symbol.name);
    return resolved;
  }

  agfx_probe::LibraryIdentity library_;
  GlesFunction gles_;
  MetalFunction metal_;
  AmgFunction amg_;
  BufferFunction buffer_;
};

// Four-character codes the CoreVideo-buffer entry is asked about. Creation is
// left to CVPixelBufferCreate: whatever CoreVideo declines simply does not
// enter the comparison, and that gap is reported rather than filled in.
inline constexpr std::array<std::uint32_t, 16> buffer_probe_sources{
    0x26424741U,  // '&BGA' lossless 32BGRA
    0x2d424741U,  // '-BGA' lossy 32BGRA
    0x42475241U,  // 'BGRA'
    0x4c303038U,  // 'L008'
    0x52476841U,  // 'RGhA'
    0x66646570U,  // 'fdep'
    0x68646973U,  // 'hdis'
    0x6c363472U,  // 'l64r'
    0x34323066U,  // '420f' - rejected by this entry
    0x34323076U,  // '420v' - rejected by this entry
    0x32433038U,  // '2C08' - rejected by this entry
    0x41524742U,  // 'ARGB' - kCVPixelFormatType_32ARGB, rejected
    0x52476641U,  // 'RGfA' 128RGBAFloat, rejected
    0x4c303136U,  // 'L016' OneComponent16, rejected
    0x76303038U,  // 'v008' 8-bit 4:4:4, rejected
    0x79343230U,  // 'y420' 420YpCbCr8Planar, rejected
};

}  // namespace agfx_test::diagnostic
