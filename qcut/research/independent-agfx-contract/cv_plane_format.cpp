#include "cv_plane_format.hpp"

namespace agfx_contract {
namespace {

// CoreVideo four-character codes, spelled the way the native immediates load
// them. 'L007' is only a binary-search pivot; it is never an accepted source.
constexpr std::uint32_t k420f = 0x34323066U;  // 420YpCbCr8BiPlanarFullRange
constexpr std::uint32_t k420v = 0x34323076U;  // 420YpCbCr8BiPlanarVideoRange
constexpr std::uint32_t k2C08 = 0x32433038U;  // TwoComponent8
constexpr std::uint32_t kBGRA = 0x42475241U;  // 32BGRA
constexpr std::uint32_t kL007 = 0x4c303037U;  // pivot only
constexpr std::uint32_t kL008 = 0x4c303038U;  // OneComponent8
constexpr std::uint32_t kRGhA = 0x52476841U;  // 64RGBAHalf
constexpr std::uint32_t kfdep = 0x66646570U;  // DepthFloat32

// Codes only the CoreVideo-buffer entry knows about.
constexpr std::uint32_t kLosslessBGRA = 0x26424741U;  // '&BGA'
constexpr std::uint32_t kLossyBGRA = 0x2d424741U;     // '-BGA'
constexpr std::uint32_t khdis = 0x68646973U;          // DisparityFloat16
constexpr std::uint32_t kl64r = 0x6c363472U;          // 64RGBALE

// GL enumerators, named against the system OpenGL headers.
constexpr std::uint32_t kGlRed = 0x1903U;
constexpr std::uint32_t kGlRg = 0x8227U;
constexpr std::uint32_t kGlRgba = 0x1908U;
constexpr std::uint32_t kGlBgra = 0x80e1U;
constexpr std::uint32_t kGlUnsignedByte = 0x1401U;
constexpr std::uint32_t kGlFloat = 0x1406U;
constexpr std::uint32_t kGlHalfFloat = 0x140bU;
constexpr std::uint32_t kGlR8 = 0x8229U;
constexpr std::uint32_t kGlRg8 = 0x822bU;
constexpr std::uint32_t kGlR32f = 0x822eU;
constexpr std::uint32_t kGlRgba16f = 0x881aU;

// The fourth GLES output. Only the single- and two-component branches write it
// and the meaning of the two values has not been recovered, so they are carried
// as opaque observations rather than mapped onto any named constant.
constexpr std::uint32_t kSingleComponentFlag = 0x4000U;
constexpr std::uint32_t kTwoComponentFlag = 0x1000U;

// MTLPixelFormat values, named against the system Metal headers.
constexpr std::uint64_t kMtlInvalid = 0U;
constexpr std::uint64_t kMtlA8Unorm = 1U;
constexpr std::uint64_t kMtlR8Unorm = 10U;
constexpr std::uint64_t kMtlRg8Unorm = 30U;
constexpr std::uint64_t kMtlRgba8Unorm = 70U;
constexpr std::uint64_t kMtlBgra8Unorm = 80U;
constexpr std::uint64_t kMtlR32Float = 55U;
constexpr std::uint64_t kMtlRgba16Float = 115U;

// AMGPixelFormat values. The plane entry and the buffer entry disagree for
// 'L008' (2 against 15); both are reproduced as observed.
constexpr std::uint32_t kAmgSingleComponent8 = 2U;
constexpr std::uint32_t kAmgTwoComponent8 = 22U;
constexpr std::uint32_t kAmgBgra8 = 43U;
constexpr std::uint32_t kAmgBgraSwapped8 = 50U;
constexpr std::uint32_t kAmgBufferSingleComponent8 = 15U;
constexpr std::uint32_t kAmgRgba16Half = 103U;
constexpr std::uint32_t kAmgDepth32 = 106U;
constexpr std::uint32_t kAmgDisparity16 = 82U;
constexpr std::uint32_t kAmgRgba16Le = 97U;
constexpr std::uint32_t kAmgUnrecognized = 0U;

// Every pivot below is a signed compare in the instruction stream. All the
// constants are under 2^31, so a source with the sign bit set is rejected on
// either side of any pivot and no input separates the signed form from an
// unsigned one; the signed form is what is encoded and what is reproduced.
constexpr bool above(std::uint32_t value, std::uint32_t pivot) noexcept {
  return static_cast<std::int32_t>(value) > static_cast<std::int32_t>(pivot);
}

// '420f' and '420v' differ only in bit 0x10, which the plane entries clear
// before a single folded comparison. A source that matches is replaced by a
// per-plane key; every other source falls back to the *unmasked* original.
constexpr std::uint32_t plane_key(std::uint32_t source, std::uint64_t plane) noexcept {
  if ((source & 0xffffffefU) != k420f) return source;
  return plane == 0 ? kL008 : k2C08;
}

}  // namespace

bool resolve_gles_plane_format(const PlaneFormatRequest& request,
                               GlesPlaneFormat& output) noexcept {
  const auto key = plane_key(request.source_format, request.plane_index);
  if (above(key, kL007)) {
    if (key == kL008) {
      output.format = kGlRed;
      output.type = kGlUnsignedByte;
      output.internal_format = kGlR8;
      output.flag = kSingleComponentFlag;
      return true;
    }
    // The half-float and depth branches share the tail that writes only the
    // first three fields; `flag` stays at whatever the caller supplied.
    if (key == kRGhA) {
      output.format = kGlRgba;
      output.type = kGlHalfFloat;
      output.internal_format = kGlRgba16f;
      return true;
    }
    if (key == kfdep) {
      output.format = kGlRed;
      output.type = kGlFloat;
      output.internal_format = kGlR32f;
      return true;
    }
    return false;
  }
  if (key == k2C08) {
    output.format = kGlRg;
    output.type = kGlUnsignedByte;
    output.internal_format = kGlRg8;
    output.flag = kTwoComponentFlag;
    return true;
  }
  if (key == kBGRA) {
    // Only the sampled order follows prefer_bgra. The internal format is the
    // same RGBA constant on both sides, and `flag` is not written.
    output.format = request.prefer_bgra ? kGlBgra : kGlRgba;
    output.type = kGlUnsignedByte;
    output.internal_format = kGlRgba;
    return true;
  }
  return false;
}

bool resolve_amg_plane_format(const PlaneFormatRequest& request,
                              std::uint32_t& output) noexcept {
  const auto key = plane_key(request.source_format, request.plane_index);
  if (above(key, kL007)) {
    if (key == kL008) {
      output = kAmgSingleComponent8;
      return true;
    }
    if (key == kRGhA) {
      output = kAmgRgba16Half;
      return true;
    }
    if (key == kfdep) {
      output = kAmgDepth32;
      return true;
    }
    return false;
  }
  if (key == k2C08) {
    output = kAmgTwoComponent8;
    return true;
  }
  if (key == kBGRA) {
    output = kAmgBgra8;
    return true;
  }
  return false;
}

std::uint64_t resolve_metal_plane_format(const PlaneFormatRequest& request) noexcept {
  const auto source = request.source_format;
  if (above(source, kL007)) {
    // 'L008' answers A8Unorm here while the AMGPixelFormat route reaches
    // R8Unorm through code 2. Both are reproduced unchanged.
    if (source == kL008) return kMtlA8Unorm;
    if (source == kRGhA) return kMtlRgba16Float;
    if (source == kfdep) return kMtlR32Float;
    return kMtlInvalid;
  }
  // The biplanar codes are two separate equality tests here, not a folded mask,
  // and the per-plane key substitution of the GLES tree has no counterpart.
  if (source == k420f || source == k420v) {
    return request.plane_index == 0 ? kMtlR8Unorm : kMtlRg8Unorm;
  }
  if (source == kBGRA) {
    return request.prefer_bgra ? kMtlBgra8Unorm : kMtlRgba8Unorm;
  }
  return kMtlInvalid;  // '2C08' has no Metal branch at all.
}

std::uint32_t resolve_buffer_pixel_format(std::uint32_t source_format,
                                          bool prefer_bgra) noexcept {
  // Three nested signed pivots, reproduced in the order the instructions test
  // them. The four BGRA spellings share one endpoint that follows prefer_bgra.
  const auto bgra_result = prefer_bgra ? kAmgBgraSwapped8 : kAmgBgra8;
  if (above(source_format, kRGhA - 1U)) {
    if (above(source_format, khdis - 1U)) {
      if (source_format == khdis) return kAmgDisparity16;
      if (source_format == kl64r) return kAmgRgba16Le;
      return kAmgUnrecognized;
    }
    if (source_format == kRGhA) return kAmgRgba16Half;
    if (source_format == kfdep) return kAmgDepth32;
    return kAmgUnrecognized;
  }
  if (above(source_format, kBGRA - 1U)) {
    if (source_format == kBGRA) return bgra_result;
    if (source_format == kL008) return kAmgBufferSingleComponent8;
    return kAmgUnrecognized;
  }
  if (source_format == kLosslessBGRA || source_format == kLossyBGRA) return bgra_result;
  return kAmgUnrecognized;
}

}  // namespace agfx_contract
